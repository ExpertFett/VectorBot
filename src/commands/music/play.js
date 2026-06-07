import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { getMusic, ensureVoice } from '../../features/music.js';
import { getPersonalization } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube (or add it to the queue).')
    .addStringOption((o) =>
      o.setName('query').setDescription('Song name or YouTube URL').setRequired(true)),

  async execute(interaction) {
    const distube = getMusic();
    if (!distube) {
      return interaction.reply({ content: 'Music engine isn\'t running on this bot.', flags: MessageFlags.Ephemeral });
    }
    const voice = await ensureVoice(interaction);
    if (!voice) return;

    const query = interaction.options.getString('query', true);
    await interaction.deferReply();

    try {
      await distube.play(voice, query, {
        member: interaction.member,
        textChannel: interaction.channel,
      });
      // DisTube emits 'playSong' which posts the now-playing embed itself. We
      // only need to ack the slash command — keep it short so it doesn't
      // duplicate the now-playing card the event handler will post.
      const accent = getPersonalization(interaction.guild.id).embed_color ?? 0x9119f5;
      const queue = distube.getQueue(voice);
      const wasAlreadyPlaying = queue && queue.songs.length > 1;
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(accent)
          .setDescription(wasAlreadyPlaying
            ? `✓ Added to queue (position ${queue.songs.length - 1})`
            : `🔍 Searching for **${query.slice(0, 200)}**…`),
        ],
      });
    } catch (err) {
      const msg = String(err?.message || err);
      const isYtBlocked = /sign in|extract|410|403|status code 4|forbidden/i.test(msg);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xe11d48)
          .setTitle(isYtBlocked ? 'YouTube blocked the request' : 'Couldn\'t play that')
          .setDescription(isYtBlocked
            ? 'YouTube has updated its bot-detection. Try again shortly, or ping a bot admin to update the extractor.'
            : msg.slice(0, 1500)),
        ],
      }).catch(() => {});
    }
  },
};
