import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a poll with up to 5 options.')
    .addStringOption((o) => o.setName('question').setDescription('The poll question').setRequired(true))
    .addStringOption((o) => o.setName('option1').setDescription('First option').setRequired(true))
    .addStringOption((o) => o.setName('option2').setDescription('Second option').setRequired(true))
    .addStringOption((o) => o.setName('option3').setDescription('Third option'))
    .addStringOption((o) => o.setName('option4').setDescription('Fourth option'))
    .addStringOption((o) => o.setName('option5').setDescription('Fifth option'))
    .addIntegerOption((o) =>
      o.setName('hours').setDescription('How long the poll runs (default 24h)').setMinValue(1).setMaxValue(768))
    .addBooleanOption((o) => o.setName('multiselect').setDescription('Allow voting for multiple options')),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const answers = [];
    for (let i = 1; i <= 5; i++) {
      const opt = interaction.options.getString(`option${i}`);
      if (opt) answers.push({ text: opt });
    }

    await interaction.reply({
      poll: {
        question: { text: question },
        answers,
        duration: interaction.options.getInteger('hours') ?? 24,
        allowMultiselect: interaction.options.getBoolean('multiselect') ?? false,
      },
    });
  },
};
