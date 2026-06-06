import { Events } from 'discord.js';
import { getCustomCommand, getPersonalization } from '../db/index.js';
import { buildEmbed } from '../util/embed.js';
import { checkMessage } from '../automod/index.js';
import { maybeRepostSticky } from '../features/sticky.js';
import { fireTrigger } from '../automations/engine.js';

const PREFIX = process.env.COMMAND_PREFIX || '!';

export default {
  name: Events.MessageCreate,
  async execute(message, mainClient) {
    if (message.author.bot || !message.guild) return;

    // Auto-moderation runs first; if it acted on the message, stop.
    if (await checkMessage(message)) return;

    // Re-post any sticky message for this channel (throttled internally).
    maybeRepostSticky(message).catch(() => {});

    // Run any 'message.keyword' automations — engine filters by keyword /
    // channel itself, so we can fire indiscriminately.
    fireTrigger('message.keyword', {
      guild: message.guild,
      member: message.member,
      user: message.author,
      message,
      channel: message.channel,
    }, mainClient).catch(() => {});

    if (!message.content.startsWith(PREFIX)) return;

    const name = message.content.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase();
    if (!name) return;

    const cmd = getCustomCommand(message.guild.id, name);
    if (!cmd) return;

    const payload = {};
    if (cmd.response) payload.content = cmd.response;
    const accent = getPersonalization(message.guild.id).embed_color ?? undefined;
    const embed = cmd.embed ? buildEmbed(cmd.embed, undefined, accent) : null;
    if (embed) payload.embeds = [embed];
    if (!payload.content && !payload.embeds) return;

    await message.channel.send(payload).catch((err) =>
      console.error(`Custom command "${name}" send failed:`, err.message)
    );
  },
};
