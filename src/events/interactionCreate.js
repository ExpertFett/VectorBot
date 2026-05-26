import { Events, MessageFlags } from 'discord.js';
import { handleRoleButton, handleRoleSelect } from '../features/roleMenus.js';
import { handleVerify } from '../features/verification.js';
import { handleOpenTicket, handleCloseTicket } from '../features/tickets.js';
import { handleGiveawayButton } from '../features/giveaways.js';
import { handleEventButton } from '../features/events.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // Component interactions (buttons + select menus)
    try {
      if (interaction.isButton()) {
        const id = interaction.customId;
        if (id.startsWith('rolemenu:')) return await handleRoleButton(interaction);
        if (id === 'verify:grant') return await handleVerify(interaction);
        if (id === 'ticket:open') return await handleOpenTicket(interaction);
        if (id === 'ticket:close') return await handleCloseTicket(interaction);
        if (id.startsWith('giveaway:')) return await handleGiveawayButton(interaction);
        if (id.startsWith('event:')) return await handleEventButton(interaction);
        return;
      }
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('rolemenu:')) return await handleRoleSelect(interaction);
        return;
      }
    } catch (err) {
      console.error('Component interaction error:', err);
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
