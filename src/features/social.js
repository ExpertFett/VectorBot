import { getAllSocialSubs, setSocialLastSeen } from '../db/index.js';

const UA = 'VectorBot/1.0 (+https://github.com/ExpertFett/VectorBot)';

const decode = (s) => String(s)
  .replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

async function fetchReddit(sub) {
  const r = await fetch(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=5`, { headers: { 'User-Agent': UA } }).catch(() => null);
  if (!r || !r.ok) return null;
  const json = await r.json().catch(() => null);
  const post = json?.data?.children?.[0]?.data;
  if (!post) return null;
  return { id: post.id, title: decode(post.title), url: `https://www.reddit.com${post.permalink}`, label: `New post in r/${post.subreddit}` };
}

async function fetchRss(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null);
  if (!r || !r.ok) return null;
  const xml = await r.text();
  const block = xml.split(/<item[\s>]/)[1] || xml.split(/<entry[\s>]/)[1];
  if (!block) return null;
  const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || 'New post';
  const link = block.match(/<link[^>]*href=["']([^"']+)["']/)?.[1] || block.match(/<link>([^<]+)<\/link>/)?.[1] || '';
  const id = block.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1] || block.match(/<id>([^<]+)<\/id>/)?.[1] || link || title;
  return { id, title: decode(title), url: link, label: 'New post' };
}

let twitchToken = { value: null, exp: 0 };
async function getTwitchToken() {
  if (twitchToken.value && Date.now() < twitchToken.exp) return twitchToken.value;
  const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return null;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' }).catch(() => null);
  if (!r || !r.ok) return null;
  const json = await r.json();
  twitchToken = { value: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 };
  return twitchToken.value;
}

async function fetchTwitch(login) {
  const token = await getTwitchToken();
  if (!token) return null;
  const r = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const stream = (await r.json())?.data?.[0];
  return { live: !!stream, title: stream?.title || '', url: `https://twitch.tv/${login}` };
}

async function fetchKick(slug) {
  const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const json = await r.json().catch(() => null);
  if (!json) return null;
  return { live: !!json.livestream, title: json.livestream?.session_title || '', url: `https://kick.com/${slug}` };
}

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
}

export async function pollSocial(client) {
  for (const sub of getAllSocialSubs()) {
    try {
      const channel = await resolveChannel(client, sub.discord_channel_id);
      if (!channel?.isTextBased()) continue;
      const mention = sub.mention_role_id ? `<@&${sub.mention_role_id}> ` : '';

      if (sub.platform === 'reddit' || sub.platform === 'rss') {
        const item = sub.platform === 'reddit' ? await fetchReddit(sub.query) : await fetchRss(sub.query);
        if (!item) continue;
        if (!sub.last_seen) { setSocialLastSeen(sub.id, item.id); continue; } // baseline
        if (item.id === sub.last_seen) continue;
        setSocialLastSeen(sub.id, item.id);
        await channel.send(`${mention}📰 ${item.label}: **${item.title}**\n${item.url}`).catch(() => {});
      } else if (sub.platform === 'twitch' || sub.platform === 'kick') {
        const data = sub.platform === 'twitch' ? await fetchTwitch(sub.query) : await fetchKick(sub.query);
        if (!data) continue;
        const state = data.live ? 'live' : 'offline';
        if (!sub.last_seen) { setSocialLastSeen(sub.id, state); continue; } // baseline
        if (sub.last_seen === state) continue;
        setSocialLastSeen(sub.id, state);
        if (data.live) {
          const plat = sub.platform === 'twitch' ? 'Twitch' : 'Kick';
          await channel.send(`${mention}🔴 **${sub.query}** is now LIVE on ${plat}!${data.title ? ` — ${data.title}` : ''}\n${data.url}`).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`Social poll error (${sub.platform}):`, err.message);
    }
  }
}
