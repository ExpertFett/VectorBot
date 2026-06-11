// Welcome Channel landing-page renderer.
// Mee6-style: a series of embeds posted in one channel that together make a
// dedicated welcome/info page. Element types: banner, section, columns.
//
// We post ONE embed per Discord message so we can edit/delete individually.
// message_ids are stored 1:1 with elements and rewritten on every publish.
//
// All payloads are produced by buildElementEmbed(); publishWelcomePage() handles
// the diff against the stored message_ids and reuses messages when possible.

import { EmbedBuilder } from 'discord.js';
import { getWelcomePage, setWelcomePage, getPersonalization } from '../db/index.js';

const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

// Returns true if the element has at least one piece of meaningful content.
// Used to skip empty elements at publish time so users don't accidentally
// post a row of blank embeds.
export function isElementEmpty(el) {
  if (!el?.type) return true;
  if (el.type === 'banner')  return !el.title && !isHttpUrl(el.image_url);
  if (el.type === 'section') return !el.title && !el.description && !isHttpUrl(el.image_url);
  if (el.type === 'columns') {
    if (el.title) return false;
    const cols = Array.isArray(el.columns) ? el.columns : [];
    return !cols.some((c) => c && (c.heading || c.content));
  }
  return true;
}

export function buildElementEmbed(el, accent = 0x9119f5) {
  const embed = new EmbedBuilder().setColor(accent);
  if (el.type === 'banner') {
    if (el.title) embed.setTitle(String(el.title).slice(0, 256));
    if (isHttpUrl(el.image_url)) embed.setImage(el.image_url);
    else if (!el.title) embed.setDescription('​'); // need *something* in the embed
    return embed;
  }
  if (el.type === 'section') {
    if (el.title) embed.setTitle(String(el.title).slice(0, 256));
    if (el.description) embed.setDescription(String(el.description).slice(0, 4096));
    if (isHttpUrl(el.image_url)) embed.setImage(el.image_url);
    if (!el.title && !el.description && !el.image_url) embed.setDescription('​');
    return embed;
  }
  if (el.type === 'columns') {
    if (el.title) embed.setTitle(String(el.title).slice(0, 256));
    const cols = Array.isArray(el.columns) ? el.columns.slice(0, 3) : []; // discord lays out up to 3 inline fields per row
    const fields = cols
      .filter((c) => c && (c.heading || c.content))
      .map((c) => ({
        name: String(c.heading || '​').slice(0, 256) || '​',
        value: String(c.content || '​').slice(0, 1024) || '​',
        inline: true,
      }));
    if (fields.length) embed.addFields(fields);
    if (!el.title && !fields.length) embed.setDescription('​');
    return embed;
  }
  // unknown type — render an empty placeholder so the index still lines up
  return embed.setDescription('​');
}

async function resolveChannel(client, channelId) {
  if (!channelId) return null;
  return client.channels.cache.get(channelId)
    || (await client.channels.fetch(channelId).catch(() => null));
}

export async function publishWelcomePage(client, guildId) {
  const page = getWelcomePage(guildId);
  if (!page.channel_id) throw new Error('no_channel');
  const channel = await resolveChannel(client, page.channel_id);
  if (!channel?.isTextBased()) throw new Error('invalid_channel');

  const accent = getPersonalization(guildId).embed_color ?? 0x9119f5;
  // Filter empty elements at publish time — they'd just render as blank
  // embeds in Discord, which looks broken. The user keeps the empty draft
  // in the dashboard; we just don't post it.
  const allElements = Array.isArray(page.elements) ? page.elements : [];
  const elements = allElements.filter((el) => !isElementEmpty(el));
  if (!elements.length) {
    throw new Error('no_publishable_elements');
  }
  const oldIds = Array.isArray(page.message_ids) ? page.message_ids.slice() : [];
  const newIds = [];

  // Walk each element and reuse the existing message id at the same index when present.
  for (let i = 0; i < elements.length; i++) {
    const payload = { embeds: [buildElementEmbed(elements[i], accent)] };
    const existingId = oldIds[i];
    let placed = false;
    if (existingId) {
      const msg = await channel.messages.fetch(existingId).catch(() => null);
      if (msg) {
        await msg.edit(payload).catch(() => { /* fall through to send */ });
        // re-fetch to confirm; if edit failed silently we still record the id (it's the right slot)
        newIds.push(existingId);
        placed = true;
      }
    }
    if (!placed) {
      const sent = await channel.send(payload).catch(() => null);
      newIds.push(sent?.id || null);
    }
  }

  // Delete any leftover messages we no longer need.
  for (let i = elements.length; i < oldIds.length; i++) {
    const id = oldIds[i];
    if (!id) continue;
    const msg = await channel.messages.fetch(id).catch(() => null);
    if (msg) await msg.delete().catch(() => {});
  }

  setWelcomePage(guildId, { message_ids: newIds });
  return { posted: elements.length, channel_id: channel.id };
}

export async function clearWelcomePage(client, guildId) {
  const page = getWelcomePage(guildId);
  const channel = await resolveChannel(client, page.channel_id);
  if (channel?.isTextBased()) {
    for (const id of page.message_ids || []) {
      if (!id) continue;
      const msg = await channel.messages.fetch(id).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
    }
  }
  setWelcomePage(guildId, { message_ids: [] });
}
