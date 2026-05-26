import { getSticky, setStickyLastMessage, getPersonalization } from '../db/index.js';
import { buildEmbed } from '../util/embed.js';

const lastRepost = new Map(); // channelId -> timestamp
const THROTTLE_MS = 4000;

export async function maybeRepostSticky(message) {
  const sticky = getSticky(message.channelId);
  if (!sticky || !sticky.enabled || (!sticky.content && !sticky.embed)) return;

  const now = Date.now();
  if (now - (lastRepost.get(message.channelId) || 0) < THROTTLE_MS) return;
  lastRepost.set(message.channelId, now);

  const channel = message.channel;
  if (sticky.last_message_id) {
    const prev = await channel.messages.fetch(sticky.last_message_id).catch(() => null);
    if (prev) await prev.delete().catch(() => {});
  }

  const payload = {};
  if (sticky.content) payload.content = sticky.content;
  const embed = sticky.embed ? buildEmbed(sticky.embed, undefined, getPersonalization(sticky.guild_id).embed_color ?? undefined) : null;
  if (embed) payload.embeds = [embed];
  if (!payload.content && !payload.embeds) return;

  const sent = await channel.send(payload).catch(() => null);
  if (sent) setStickyLastMessage(message.channelId, sent.id);
}
