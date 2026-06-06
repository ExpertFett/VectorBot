import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} from 'discord.js';
import {
  getRecruitment, setRecruitment, getPersonalization,
  createApplication, getApplication, getPendingApplication, setAppStatus,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';

export function buildPanel(cfg, accent = 0x9119f5) {
  const embed = (cfg.embed && buildEmbed(cfg.embed, undefined, accent)) || new EmbedBuilder().setColor(accent)
    .setTitle(cfg.title || 'Apply').setDescription(cfg.description || 'Click below to apply.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('recruit:apply').setLabel(cfg.button_label || 'Apply').setStyle(ButtonStyle.Success).setEmoji('📝')
  );
  return { embeds: [embed], components: [row] };
}

export async function postRecruitPanel(client, guildId) {
  const cfg = getRecruitment(guildId);
  if (!cfg.panel_channel_id) throw new Error('no_channel');
  const channel = client.channels.cache.get(cfg.panel_channel_id)
    || (await client.channels.fetch(cfg.panel_channel_id).catch(() => null));
  if (!channel?.isTextBased()) throw new Error('invalid_channel');

  const accent = getPersonalization(guildId).embed_color ?? 0x9119f5;
  const payload = buildPanel(cfg, accent);
  if (cfg.panel_message_id) {
    const ex = await channel.messages.fetch(cfg.panel_message_id).catch(() => null);
    if (ex) { await ex.edit(payload); return ex.id; }
  }
  const sent = await channel.send(payload);
  setRecruitment(guildId, { panel_channel_id: channel.id, panel_message_id: sent.id });
  return sent.id;
}

export async function handleApply(interaction) {
  const cfg = getRecruitment(interaction.guild.id);
  if (!cfg.enabled) return interaction.reply({ content: 'Applications are currently closed.', flags: MessageFlags.Ephemeral });
  if (getPendingApplication(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({ content: 'You already have a pending application.', flags: MessageFlags.Ephemeral });
  }
  const questions = (cfg.questions || []).slice(0, 5);
  if (!questions.length) return interaction.reply({ content: 'No application questions are configured.', flags: MessageFlags.Ephemeral });

  const modal = new ModalBuilder().setCustomId('recruit:modal').setTitle((cfg.title || 'Application').slice(0, 45));
  questions.forEach((q, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${i}`).setLabel(String(q.label).slice(0, 45))
      .setStyle(q.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required !== false).setMaxLength(1000);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  await interaction.showModal(modal);
}

export async function handleApplyModal(interaction) {
  const cfg = getRecruitment(interaction.guild.id);
  const questions = (cfg.questions || []).slice(0, 5);
  const answers = questions.map((q, i) => ({ q: q.label, a: interaction.fields.getTextInputValue(`q${i}`) || '—' }));
  const appId = createApplication(interaction.guild.id, interaction.user.id, interaction.user.tag, answers);

  const reviewCh = cfg.review_channel_id ? interaction.guild.channels.cache.get(cfg.review_channel_id) : null;
  if (reviewCh?.isTextBased()) {
    const embed = new EmbedBuilder().setColor(0xf1c40f)
      .setTitle(`Application — ${interaction.user.tag}`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setDescription(`From <@${interaction.user.id}>`)
      .setFooter({ text: `Application #${appId}` })
      .addFields(answers.map((a) => ({ name: a.q.slice(0, 256), value: (a.a || '—').slice(0, 1024) })));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`recruit:approve:${appId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`recruit:deny:${appId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    );
    await reviewCh.send({ embeds: [embed], components: [row] }).catch(() => {});
  }
  await interaction.reply({ content: 'Application submitted — thanks! Staff will review it shortly.', flags: MessageFlags.Ephemeral });
}

export async function handleReview(interaction) {
  const [, action, idStr] = interaction.customId.split(':');
  const app = getApplication(Number(idStr));
  if (!app) return interaction.reply({ content: 'Application not found.', flags: MessageFlags.Ephemeral });
  if (app.status !== 'pending') return interaction.reply({ content: `Already ${app.status}.`, flags: MessageFlags.Ephemeral });

  const cfg = getRecruitment(interaction.guild.id);
  const approve = action === 'approve';
  setAppStatus(app.id, approve ? 'approved' : 'denied');

  if (approve && cfg.approve_role_id) {
    const member = await interaction.guild.members.fetch(app.user_id).catch(() => null);
    if (member) await member.roles.add(cfg.approve_role_id, 'Application approved').catch(() => {});
  }
  interaction.client.users.fetch(app.user_id)
    .then((u) => u.send(approve
      ? `✅ Your application to **${interaction.guild.name}** was approved — welcome aboard!`
      : `Your application to **${interaction.guild.name}** wasn’t accepted this time.`))
    .catch(() => {});

  const base = interaction.message.embeds[0];
  const embed = EmbedBuilder.from(base).setColor(approve ? 0x2ecc71 : 0xf23f43)
    .setTitle(`${base.title} — ${approve ? 'APPROVED' : 'DENIED'} by ${interaction.user.username}`);
  await interaction.update({ embeds: [embed], components: [] });
}
