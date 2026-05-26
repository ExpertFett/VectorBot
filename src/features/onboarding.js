import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
} from 'discord.js';
import { getOnboarding, setOnboarding, getPersonalization } from '../db/index.js';
import { buildEmbed } from '../util/embed.js';

const accentOf = (guildId) => getPersonalization(guildId).embed_color ?? 0x5865f2;

// The public panel that lives in a channel — a single "Get Started" button.
export function buildPanelMessage(cfg, accent = 0x5865f2) {
  const embed = (cfg.embed && buildEmbed(cfg.embed, undefined, accent)) || new EmbedBuilder().setColor(accent)
    .setTitle(cfg.title || 'Welcome')
    .setDescription(cfg.description || 'Click below to get started.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('onboard:start').setLabel(cfg.button_label || 'Get Started').setStyle(ButtonStyle.Success).setEmoji('👋')
  );
  return { embeds: [embed], components: [row] };
}

export async function postOnboardPanel(client, guildId) {
  const cfg = getOnboarding(guildId);
  if (!cfg.panel_channel_id) throw new Error('no_channel');
  const channel = client.channels.cache.get(cfg.panel_channel_id)
    || (await client.channels.fetch(cfg.panel_channel_id).catch(() => null));
  if (!channel?.isTextBased()) throw new Error('invalid_channel');

  const accent = accentOf(guildId);
  const payload = buildPanelMessage(cfg, accent);
  if (cfg.panel_message_id) {
    const existing = await channel.messages.fetch(cfg.panel_message_id).catch(() => null);
    if (existing) { await existing.edit(payload); return existing.id; }
  }
  const sent = await channel.send(payload);
  setOnboarding(guildId, { panel_channel_id: channel.id, panel_message_id: sent.id });
  return sent.id;
}

// Render one ephemeral step of the wizard for a given member.
function renderStep(member, cfg, idx) {
  const steps = cfg.steps || [];
  const total = steps.length;
  const step = steps[idx];
  const accent = accentOf(member.guild.id);

  const embed = new EmbedBuilder().setColor(accent)
    .setTitle(step.title || `Step ${idx + 1}`)
    .setDescription(step.description || '​')
    .setFooter({ text: `Step ${idx + 1} of ${total}` });
  if (step.image && /^https?:\/\//i.test(step.image)) embed.setImage(step.image);

  const rows = [];
  const roles = (step.roles || []).filter((r) => r.role_id).slice(0, 20);
  for (let i = 0; i < roles.length; i += 5) {
    const row = new ActionRowBuilder();
    for (let j = i; j < Math.min(i + 5, roles.length); j++) {
      const r = roles[j];
      const owned = member.roles.cache.has(r.role_id);
      const btn = new ButtonBuilder()
        .setCustomId(`onboard:role:${idx}:${j}`)
        .setLabel(r.label || 'Role')
        .setStyle(owned ? ButtonStyle.Success : ButtonStyle.Secondary);
      if (owned) btn.setEmoji('✅');
      else if (r.emoji) { try { btn.setEmoji(r.emoji); } catch { /* invalid emoji */ } }
      row.addComponents(btn);
    }
    rows.push(row);
  }

  // Navigation row.
  const nav = new ActionRowBuilder();
  if (idx > 0) {
    nav.addComponents(new ButtonBuilder().setCustomId(`onboard:nav:${idx - 1}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('◀️'));
  }
  if (idx < total - 1) {
    nav.addComponents(new ButtonBuilder().setCustomId(`onboard:nav:${idx + 1}`).setLabel('Next').setStyle(ButtonStyle.Primary).setEmoji('▶️'));
  } else {
    nav.addComponents(new ButtonBuilder().setCustomId('onboard:finish').setLabel('Finish').setStyle(ButtonStyle.Success).setEmoji('🎉'));
  }
  rows.push(nav);

  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}

export async function handleStart(interaction) {
  const cfg = getOnboarding(interaction.guild.id);
  if (!cfg.enabled) return interaction.reply({ content: 'The welcome tour isn’t available right now.', flags: MessageFlags.Ephemeral });
  if (!cfg.steps?.length) return interaction.reply({ content: 'No onboarding steps are configured yet.', flags: MessageFlags.Ephemeral });
  await interaction.reply(renderStep(interaction.member, cfg, 0));
}

export async function handleNav(interaction) {
  const cfg = getOnboarding(interaction.guild.id);
  const idx = Math.max(0, Math.min(Number(interaction.customId.split(':')[2]) || 0, (cfg.steps?.length || 1) - 1));
  await interaction.update(renderStep(interaction.member, cfg, idx));
}

export async function handleRoleToggle(interaction) {
  const cfg = getOnboarding(interaction.guild.id);
  const [, , idxStr, roleIdxStr] = interaction.customId.split(':');
  const idx = Number(idxStr) || 0;
  const step = (cfg.steps || [])[idx];
  const entry = (step?.roles || []).filter((r) => r.role_id)[Number(roleIdxStr)];
  if (!entry) return interaction.deferUpdate();

  const role = interaction.guild.roles.cache.get(entry.role_id);
  const me = interaction.guild.members.me;
  if (!role) return interaction.reply({ content: 'That role no longer exists.', flags: MessageFlags.Ephemeral });
  if (me && role.position >= me.roles.highest.position) {
    return interaction.reply({ content: `I can’t manage **${role.name}** — my role needs to be above it.`, flags: MessageFlags.Ephemeral });
  }

  try {
    if (interaction.member.roles.cache.has(entry.role_id)) await interaction.member.roles.remove(entry.role_id, 'Onboarding');
    else await interaction.member.roles.add(entry.role_id, 'Onboarding');
  } catch (err) {
    console.error('Onboarding role toggle failed:', err.message);
  }
  // Re-render the same step so the button reflects the new state.
  await interaction.update(renderStep(interaction.member, cfg, idx)).catch(() => {});
}

export async function handleFinish(interaction) {
  const cfg = getOnboarding(interaction.guild.id);
  if (cfg.completion_role_id) {
    const role = interaction.guild.roles.cache.get(cfg.completion_role_id);
    const me = interaction.guild.members.me;
    if (role && (!me || role.position < me.roles.highest.position)) {
      await interaction.member.roles.add(cfg.completion_role_id, 'Onboarding complete').catch(() => {});
    }
  }
  const accent = accentOf(interaction.guild.id);
  const embed = new EmbedBuilder().setColor(accent)
    .setTitle('All done! 🎉')
    .setDescription(cfg.finish_message || 'You’re all set — welcome aboard!');
  await interaction.update({ embeds: [embed], components: [] }).catch(() => {});
}
