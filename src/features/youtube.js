import { getAllYoutubeSubs, setYoutubeLastVideo } from '../db/index.js';

const FEED = (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

function decodeXml(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Fetch the latest upload from a channel's public RSS feed (no API key needed).
export async function fetchLatestVideo(channelId) {
  const res = await fetch(FEED(channelId), { headers: { 'User-Agent': 'VectorBot' } }).catch(() => null);
  if (!res || !res.ok) return null;
  const xml = await res.text();
  const entry = xml.split('<entry>')[1];
  if (!entry) return null;
  const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
  if (!videoId) return null;
  const title = entry.match(/<title>([^<]+)<\/title>/)?.[1] || 'New video';
  const author = xml.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1] || '';
  return { videoId, title: decodeXml(title), author: decodeXml(author), url: `https://www.youtube.com/watch?v=${videoId}` };
}

export async function pollYoutube(client) {
  for (const sub of getAllYoutubeSubs()) {
    try {
      const latest = await fetchLatestVideo(sub.youtube_channel_id);
      if (!latest) continue;

      // First time we see this sub: record the latest as a baseline, don't announce.
      if (!sub.last_video_id) { setYoutubeLastVideo(sub.id, latest.videoId); continue; }
      if (latest.videoId === sub.last_video_id) continue;

      setYoutubeLastVideo(sub.id, latest.videoId);
      const channel = client.channels.cache.get(sub.discord_channel_id)
        || (await client.channels.fetch(sub.discord_channel_id).catch(() => null));
      if (channel?.isTextBased()) {
        const mention = sub.mention_role_id ? `<@&${sub.mention_role_id}> ` : '';
        await channel.send(`${mention}📺 **${latest.author}** posted a new video: **${latest.title}**\n${latest.url}`).catch(() => {});
      }
    } catch (err) {
      console.error('YouTube poll error:', err.message);
    }
  }
}
