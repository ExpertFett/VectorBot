import { EmbedBuilder } from 'discord.js';

const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

function normalizeColor(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (typeof c === 'string') {
    const n = parseInt(c.replace(/^#/, ''), 16);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function hasContent(o) {
  return Boolean(
    o.title || o.description || o.image || o.thumbnail ||
    o.author?.name || o.footer?.text || (Array.isArray(o.fields) && o.fields.length)
  );
}

// Build a discord.js EmbedBuilder from stored embed data (object or JSON string).
// `transform` rewrites user-facing strings (used for {placeholder} substitution).
// Returns null when there's no renderable content (Discord rejects empty embeds).
export function buildEmbed(data, transform = (s) => s) {
  let o = data;
  if (typeof data === 'string') {
    try { o = JSON.parse(data); } catch { return null; }
  }
  if (!o || typeof o !== 'object' || !hasContent(o)) return null;

  const embed = new EmbedBuilder();
  if (o.title) embed.setTitle(transform(String(o.title)).slice(0, 256));
  if (o.description) embed.setDescription(transform(String(o.description)).slice(0, 4096));
  if (isHttpUrl(o.url)) embed.setURL(o.url);

  const color = normalizeColor(o.color);
  if (color != null) embed.setColor(color);

  if (isHttpUrl(o.thumbnail)) embed.setThumbnail(o.thumbnail);
  if (isHttpUrl(o.image)) embed.setImage(o.image);

  if (o.author?.name) {
    embed.setAuthor({
      name: transform(String(o.author.name)).slice(0, 256),
      iconURL: isHttpUrl(o.author.icon_url) ? o.author.icon_url : undefined,
      url: isHttpUrl(o.author.url) ? o.author.url : undefined,
    });
  }
  if (o.footer?.text) {
    embed.setFooter({
      text: transform(String(o.footer.text)).slice(0, 2048),
      iconURL: isHttpUrl(o.footer.icon_url) ? o.footer.icon_url : undefined,
    });
  }
  if (o.timestamp) embed.setTimestamp(o.timestamp === true ? Date.now() : new Date(o.timestamp));

  if (Array.isArray(o.fields)) {
    const fields = o.fields
      .filter((f) => f && f.name && f.value)
      .slice(0, 25)
      .map((f) => ({
        name: transform(String(f.name)).slice(0, 256),
        value: transform(String(f.value)).slice(0, 1024),
        inline: Boolean(f.inline),
      }));
    if (fields.length) embed.addFields(fields);
  }

  return embed;
}
