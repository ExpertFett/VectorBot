import { SlashCommandBuilder, MessageFlags } from 'discord.js';

export default {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check the bot\'s latency.'),

  async execute(interaction, client) {
    const sent = await interaction.reply({ content: 'Pinging…', flags: MessageFlags.Ephemeral, withResponse: true });
    const roundtrip = sent.resource.message.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong! Roundtrip **${roundtrip}ms**, gateway **${Math.round(client.ws.ping)}ms**.`);
  },
};
