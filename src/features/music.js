// Music player. Wraps DisTube around the main client so /play et al. can fan
// out to discord-friendly voice connections. Pure-JS deps only — libsodium /
// opusscript / ffmpeg-static, no MSVC compile needed (verified, see /memory).
//
// Architecture note: DisTube binds to ONE Client. For now we attach to the
// main bot only — custom-bot guilds that have removed the main bot won't get
// music. A follow-up could spin up a DisTube per custom-bot client.
//
// YouTube is intentionally the only source plugin. The user opted in knowing
// it's best-effort: when YouTube changes their bot-detection, /play will
// start failing and we'll need to bump @distube/ytdl-core. The error path is
// designed to make that obvious in the response embed.

import { DisTube } from 'distube';
import { YtDlpPlugin } from '@distube/yt-dlp';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getPersonalization } from '../db/index.js';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

let distube = null;

// Static across the process so commands import a stable handle.
export function getMusic() { return distube; }

// Boot-time diagnostic. Tells us in the deploy log exactly which yt-dlp the
// system will resolve, so we can tell "binary missing" from "binary present
// but wrong one is first on PATH" from "binary present and working."
function probeYtDlp() {
  const localPath = '/app/yt-dlp';
  const hasLocal = existsSync(localPath);
  if (hasLocal) {
    const s = statSync(localPath);
    console.log(`[music] /app/yt-dlp present: ${(s.size / 1_000_000).toFixed(1)} MB · mode=${(s.mode & 0o777).toString(8)}`);
    // If PATH wasn't prepended for some reason, do it now from the running process.
    if (!process.env.PATH?.split(':').includes('/app')) {
      process.env.PATH = `/app:${process.env.PATH || ''}`;
      console.log('[music] prepended /app to PATH at runtime');
    }
  } else {
    console.warn('[music] /app/yt-dlp NOT FOUND — postinstall script likely did not run.');
  }
  try {
    const which = execFileSync('which', ['yt-dlp'], { encoding: 'utf8' }).trim();
    console.log(`[music] which yt-dlp → ${which}`);
    const version = execFileSync(which, ['--version'], { encoding: 'utf8' }).trim();
    console.log(`[music] yt-dlp --version → ${version}`);
  } catch (err) {
    console.warn('[music] yt-dlp probe failed:', err.message);
  }
}

export function initMusic(client) {
  if (distube) return distube;
  probeYtDlp();
  // YtDlpPlugin spawns its OWN bundled binary at
  // node_modules/@distube/yt-dlp/bin/yt-dlp (NOT whatever's on PATH). Our
  // postinstall script overwrites that with yt-dlp's self-contained Linux
  // binary so the plugin's spawn() call works without Python.
  // `update: false` is critical here — `true` would make the plugin re-
  // download the broken Python zipapp on startup and clobber our binary.
  distube = new DisTube(client, {
    plugins: [new YtDlpPlugin({ update: false })],
    ffmpeg: { path: ffmpegPath },
    emitAddSongWhenCreatingQueue: false,  // we send our own "added to queue" message via /play directly
    emitAddListWhenCreatingQueue: false,
    emitNewSongOnly: true,                // only fire 'playSong' the first time, not on repeats
    savePreviousSongs: false,             // memory: we don't need previous-song history yet
    nsfw: false,
  });

  distube.on('playSong', (queue, song) => {
    const channel = queue.textChannel;
    if (!channel?.isTextBased?.()) return;
    const accent = getPersonalization(queue.id).embed_color ?? 0x9119f5;
    const embed = new EmbedBuilder()
      .setColor(accent)
      .setAuthor({ name: 'Now playing' })
      .setTitle(song.name?.slice(0, 256) || 'Untitled')
      .setURL(song.url || null)
      .setThumbnail(song.thumbnail || null)
      .addFields(
        { name: 'Duration', value: song.formattedDuration || '—', inline: true },
        { name: 'Requested by', value: song.user ? `<@${song.user.id}>` : '—', inline: true },
        { name: 'Queue', value: queue.songs.length > 1 ? `${queue.songs.length - 1} more in queue` : 'last in queue', inline: true },
      );
    channel.send({ embeds: [embed], components: [nowPlayingButtons()] }).catch(() => {});
  });

  distube.on('finish', (queue) => {
    queue.textChannel?.send?.('🎵 Queue finished — leaving the voice channel.').catch(() => {});
  });

  distube.on('disconnect', () => { /* voice connection ended — DisTube handles cleanup */ });

  distube.on('empty', (queue) => {
    queue.textChannel?.send?.('👋 Voice channel is empty — leaving.').catch(() => {});
  });

  distube.on('error', (err, queue) => {
    console.error('[music] DisTube error:', err?.message || err);
    const channel = queue?.textChannel;
    if (!channel?.isTextBased?.()) return;
    const msg = String(err?.message || err);
    // Surface the broken-YouTube case explicitly so users + maintainers can
    // tell "bot is down" from "this one song failed". Common signatures:
    // "Sign in to confirm", "could not extract", "410", "403", etc.
    const isYtBlocked = /sign in|extract|410|403|status code 4|forbidden/i.test(msg);
    channel.send({
      embeds: [new EmbedBuilder().setColor(0xe11d48)
        .setTitle(isYtBlocked ? 'YouTube is blocking the bot right now' : 'Playback error')
        .setDescription(isYtBlocked
          ? 'YouTube has updated its bot-detection — the extractor needs a refresh. Try again in a few minutes, or ping your bot admin to update `@distube/ytdl-core`.'
          : `\`\`\`${msg.slice(0, 1500)}\`\`\``),
      ],
    }).catch(() => {});
  });

  console.log('[music] DisTube ready (YouTube source, pure-JS audio stack).');
  return distube;
}

// Standard control buttons shown on every "Now playing" embed.
export function nowPlayingButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music:pause').setLabel('Pause').setStyle(ButtonStyle.Secondary).setEmoji('⏸️'),
    new ButtonBuilder().setCustomId('music:skip').setLabel('Skip').setStyle(ButtonStyle.Secondary).setEmoji('⏭️'),
    new ButtonBuilder().setCustomId('music:stop').setLabel('Stop').setStyle(ButtonStyle.Danger).setEmoji('⏹️'),
    new ButtonBuilder().setCustomId('music:queue').setLabel('Queue').setStyle(ButtonStyle.Secondary).setEmoji('📜'),
  );
}

// Make sure the invoker is in a voice channel + the bot has permission to
// join. Returns the voice channel or sends an ephemeral reply and returns null.
export async function ensureVoice(interaction) {
  const voice = interaction.member?.voice?.channel;
  if (!voice) {
    await interaction.reply({ content: 'You need to be in a voice channel first.', ephemeral: true });
    return null;
  }
  const me = interaction.guild.members.me;
  const perms = voice.permissionsFor(me);
  if (!perms?.has('Connect') || !perms?.has('Speak')) {
    await interaction.reply({ content: `I need **Connect** + **Speak** permissions in ${voice}.`, ephemeral: true });
    return null;
  }
  // If the bot is already in a different voice channel and someone else is in
  // it, refuse the move — avoids "Fett kicked me out of channel A to play in B".
  const myVoice = me.voice?.channel;
  if (myVoice && myVoice.id !== voice.id && myVoice.members.filter((m) => !m.user.bot).size > 0) {
    await interaction.reply({ content: `I'm already playing in ${myVoice} for other listeners. Hop in there or wait until it's empty.`, ephemeral: true });
    return null;
  }
  return voice;
}
