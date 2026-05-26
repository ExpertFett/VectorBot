import { Events, MessageFlags } from 'discord.js';
import { handleRoleButton, handleRoleSelect } from '../features/roleMenus.js';
import { handleVerify } from '../features/verification.js';
import { handleOpenTicket, handleCloseTicket, handleClaimTicket, handleDeleteTicket } from '../features/tickets.js';
import { handleGiveawayButton } from '../features/giveaways.js';
import { handleEventButton, handleEventSelect } from '../features/events.js';
import { handleApply, handleApplyModal, handleReview } from '../features/recruitment.js';

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
        if (id === 'ticket:claim') return await handleClaimTicket(interaction);
        if (id === 'ticket:close') return await handleCloseTicket(interaction);
        if (id === 'ticket:delete') return await handleDeleteTicket(interaction);
        if (id.startsWith('giveaway:')) return await handleGiveawayButton(interaction);
        if (id.startsWith('event:')) return await handleEventButton(interaction);
        if (id === 'recruit:apply') return await handleApply(interaction);
        if (id.startsWith('recruit:approve:') || id.startsWith('recruit:deny:')) return await handleReview(interaction);
        return;
      }
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('rolemenu:')) return await handleRoleSelect(interaction);
        if (interaction.customId.startsWith('event:')) return await handleEventSelect(interaction);
        return;
      }
      if (interaction.isModalSubmit()) {
        if (interaction.customId === 'recruit:modal') return await handleApplyModal(interaction);
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
