import { EmbedBuilder } from 'discord.js';
import { getConfig, getServerStatus, setStatusMessage, getPersonalization } from '../db/index.js';

const STALE_MS = 3 * 60 * 1000; // no update in 3 min => treat as offline/stale

export function buildStatusEmbed(guildId) {
  const status = getServerStatus(guildId);
  const accent = getPersonalization(guildId).embed_color ?? 0x5865f2;
  const embed = new EmbedBuilder().setTitle('🎮 DCS Server Status').setTimestamp();

  if (!status) {
    return embed.setColor(0x57606a).setDescription('No data received yet — install the hook on your DCS server (see the DCS Server page).');
  }
  const online = status.online !== false && Date.now() - (status.updated_at || 0) < STALE_MS;
  embed.setColor(online ? 0x2ecc71 : 0x57606a);
  embed.addFields(
    { name: 'Status', value: online ? '🟢 Online' : '🔴 Offline / stale', inline: true },
    { name: 'Players', value: String(status.players ?? 0), inline: true },
  );
  if (status.mission) embed.addFields({ name: 'Mission', value: status.mission, inline: false });
  if (status.theatre) embed.addFields({ name: 'Theatre', value: status.theatre, inline: true });
  if (Array.isArray(status.names) && status.names.length) {
    embed.addFields({ name: 'Online now', value: status.names.slice(0, 40).join(', ').slice(0, 1024) });
  }
  if (status.updated_at) embed.setFooter({ text: 'Last update' }).setTimestamp(status.updated_at);
  return embed;
}

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
}

// Post or edit the auto-updating status embed in the configured channel.
export async function renderServerStatus(client, guildId) {
  const cfg = getConfig(guildId);
  if (!cfg.status_channel_id) return;
  const channel = await resolveChannel(client, cfg.status_channel_id);
  if (!channel?.isTextBased()) return;

  const embed = buildStatusEmbed(guildId);
  if (cfg.status_message_id) {
    const msg = await channel.messages.fetch(cfg.status_message_id).catch(() => null);
    if (msg) { await msg.edit({ embeds: [embed] }).catch(() => {}); return; }
  }
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) setStatusMessage(guildId, channel.id, sent.id);
}
