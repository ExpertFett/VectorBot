import { Events } from 'discord.js';
import { getCustomCommand } from '../db/index.js';

const PREFIX = process.env.COMMAND_PREFIX || '!';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const name = message.content.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase();
    if (!name) return;

    const cmd = getCustomCommand(message.guild.id, name);
    if (!cmd) return;

    await message.channel.send(cmd.response).catch((err) =>
      console.error(`Custom command "${name}" send failed:`, err.message)
    );
  },
};
