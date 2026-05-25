import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  getGiveaway, getGiveawayEntries, getGiveawayEntryCount,
  setGiveawayMessage, endGiveaway, toggleGiveawayEntry, getPersonalization,
} from '../db/index.js';

export function buildGiveawayMessage(g, count = 0, ended = false, winners = []) {
  const accent = getPersonalization(g.guild_id).embed_color ?? 0x5865f2;
  const embed = new EmbedBuilder()
    .setTitle(`🎉 Giveaway: ${g.prize}`)
    .setColor(ended ? 0x57606a : accent);
  const intro = g.description ? `${g.description}\n\n` : '';
  if (ended) {
    embed.setDescription(`${intro}${winners.length ? `Winner(s): ${winners.map((id) => `<@${id}>`).join(', ')}` : 'No valid entries — no winner.'}`);
  } else {
    embed.setDescription(`${intro}Click the button to enter!\nEnds <t:${Math.floor(g.ends_at / 1000)}:R>\nWinners: **${g.winners}**`);
    embed.setFooter({ text: `${count} ${count === 1 ? 'entry' : 'entries'}` });
  }
  if (g.image) { try { embed.setImage(g.image); } catch { /* invalid url */ } }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway:${g.id}`).setLabel('Enter 🎉').setStyle(ButtonStyle.Primary).setDisabled(ended)
  );
  return { embeds: [embed], components: ended ? [] : [row] };
}

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
}

export async function postGiveaway(client, g) {
  const channel = await resolveChannel(client, g.channel_id);
  if (!channel?.isTextBased()) throw new Error('invalid_channel');
  const sent = await channel.send(buildGiveawayMessage(g, 0));
  setGiveawayMessage(g.id, sent.id);
  return sent.id;
}

export async function handleGiveawayButton(interaction) {
  const id = Number(interaction.customId.split(':')[1]);
  const g = getGiveaway(id);
  if (!g || g.ended) return interaction.reply({ content: 'This giveaway has ended.', flags: MessageFlags.Ephemeral });

  const joined = toggleGiveawayEntry(id, interaction.user.id);
  const count = getGiveawayEntryCount(id);
  try { await interaction.message.edit(buildGiveawayMessage(g, count)); } catch { /* ignore */ }
  await interaction.reply({ content: joined ? 'You’re entered! 🎉' : 'You left the giveaway.', flags: MessageFlags.Ephemeral });
}

function pickWinners(entries, n) {
  const pool = [...entries];
  const winners = [];
  while (winners.length < n && pool.length) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return winners;
}

export async function endGiveawayAndAnnounce(client, g) {
  const entries = getGiveawayEntries(g.id);
  const winners = pickWinners(entries, g.winners);
  endGiveaway(g.id);

  const channel = await resolveChannel(client, g.channel_id);
  if (channel?.isTextBased()) {
    if (g.message_id) {
      const msg = await channel.messages.fetch(g.message_id).catch(() => null);
      if (msg) await msg.edit(buildGiveawayMessage(g, entries.length, true, winners)).catch(() => {});
    }
    await channel.send(
      winners.length
        ? `🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(', ')} — you won **${g.prize}**!`
        : `No valid entries for **${g.prize}**.`
    ).catch(() => {});
  }
  return winners;
}

export async function rerollGiveaway(client, g) {
  const winners = pickWinners(getGiveawayEntries(g.id), g.winners);
  const channel = await resolveChannel(client, g.channel_id);
  if (channel?.isTextBased()) {
    await channel.send(
      winners.length
        ? `🎉 Reroll — new winner(s) for **${g.prize}**: ${winners.map((id) => `<@${id}>`).join(', ')}!`
        : 'No entries to reroll.'
    ).catch(() => {});
  }
  return winners;
}
