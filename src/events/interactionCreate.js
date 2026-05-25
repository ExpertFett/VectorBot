import { Events, MessageFlags } from 'discord.js';
import { handleRoleButton } from '../features/roleMenus.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // Button interactions (role menus)
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('rolemenu:')) {
        try {
          await handleRoleButton(interaction);
        } catch (err) {
          console.error('Role button handler error:', err);
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client);
    } catch (err) {
      console.error(`Error in /${interaction.commandName}:`, err);
      const payload = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};
