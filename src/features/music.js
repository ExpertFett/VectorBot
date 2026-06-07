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
import { YouTubePlugin } from '@distube/youtube';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getPersonalization } from '../db/index.js';
import ffmpegPath from 'ffmpeg-static';

let distube = null;

// Static across the process so commands import a stable handle.
export function getMusic() { return distube; }

export function initMusic(client) {
  if (distube) return distube;
  distube = new DisTube(client, {
    plugins: [new YouTubePlugin()],
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
