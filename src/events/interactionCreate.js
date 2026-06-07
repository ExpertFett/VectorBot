import { Events, MessageFlags } from 'discord.js';
import { handleRoleButton, handleRoleSelect } from '../features/roleMenus.js';
import { handleVerify } from '../features/verification.js';
import { handleOpenTicket, handleCloseTicket, handleClaimTicket, handleDeleteTicket } from '../features/tickets.js';
import { handleGiveawayButton } from '../features/giveaways.js';
import { handleEventButton, handleEventSelect } from '../features/events.js';
import { handleApply, handleApplyModal, handleReview } from '../features/recruitment.js';
import { handleStart, handleNav, handleRoleToggle, handleFinish } from '../features/onboarding.js';
import { getMusic } from '../features/music.js';
import { reportError } from '../util/report.js';

// Best-effort acknowledgement when a component handler throws — Discord will
// otherwise leave the user with a silent click and eventually an "interaction
// failed" toast. We try ephemeral reply first, fall back to followUp if the
// handler already responded.
async function softFail(interaction, msg = 'Something went wrong handling that click.') {
  const payload = { content: msg, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch { /* nothing else to do */ }
}

// Handlers for the "Now Playing" embed control buttons. Each one is a thin
// wrapper around the DisTube call the equivalent slash command makes — same
// safety guards (queue exists, etc.), just an ephemeral reply since the
// invoker probably doesn't need a public ack for hitting Pause.
async function handleMusicButton(interaction) {
  const distube = getMusic();
  const queue = distube?.getQueue(interaction.guild.id);
  if (!queue) {
    return interaction.reply({ content: 'Nothing is playing anymore.', flags: MessageFlags.Ephemeral });
  }
  const id = interaction.customId.split(':')[1];
  try {
    if (id === 'pause') {
      if (queue.paused) distube.resume(interaction.guild.id);
      else distube.pause(interaction.guild.id);
      return interaction.reply({ content: queue.paused ? `▶️ Resumed by ${interaction.user}.` : `⏸️ Paused by ${interaction.user}.` });
    }
    if (id === 'skip') {
      if (queue.songs.length <= 1) { await distube.stop(interaction.guild.id); return interaction.reply({ content: `⏭️ Skipped (last song) by ${interaction.user}.` }); }
      await distube.skip(interaction.guild.id);
      return interaction.reply({ content: `⏭️ Skipped by ${interaction.user}.` });
    }
    if (id === 'stop') {
      await distube.stop(interaction.guild.id);
      return interaction.reply({ content: `⏹️ Stopped by ${interaction.user}.` });
    }
    if (id === 'queue') {
      // Defer to the /queue command's logic — easier to just inline a compact view.
      const [current, ...upcoming] = queue.songs;
      const lines = upcoming.slice(0, 10).map((s, i) => `**${i + 1}.** ${(s.name || 'Untitled').slice(0, 70)}`);
      const body = `**Now:** ${(current.name || 'Untitled').slice(0, 100)}\n` + (lines.length ? lines.join('\n') : '_No upcoming songs._');
      return interaction.reply({ content: body, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    return interaction.reply({ content: `Couldn't do that: ${err.message}`, flags: MessageFlags.Ephemeral });
  }
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // Component interactions (buttons + select menus)
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      console.log(`[interaction] ${interaction.type} ${interaction.customId} from ${interaction.user.tag} (guild ${interaction.guildId})`);
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
          if (id === 'onboard:start') return await handleStart(interaction);
          if (id.startsWith('onboard:nav:')) return await handleNav(interaction);
          if (id.startsWith('onboard:role:')) return await handleRoleToggle(interaction);
          if (id === 'onboard:finish') return await handleFinish(interaction);
          if (id.startsWith('music:')) return await handleMusicButton(interaction);
          // Unrecognised customId — tell the user instead of leaving silent.
          await softFail(interaction, 'I don’t recognise this button. The bot may have been updated since this message was posted.');
          return;
        }
        if (interaction.isStringSelectMenu()) {
          if (interaction.customId.startsWith('rolemenu:')) return await handleRoleSelect(interaction);
          if (interaction.customId.startsWith('event:')) return await handleEventSelect(interaction);
          await softFail(interaction);
          return;
        }
        if (interaction.isModalSubmit()) {
          if (interaction.customId === 'recruit:modal') return await handleApplyModal(interaction);
          await softFail(interaction);
          return;
        }
      } catch (err) {
        reportError(client, `component:${interaction.customId}`, err);
        await softFail(interaction);
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client);
    } catch (err) {
      reportError(client, `command:/${interaction.commandName}`, err);
      const payload = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};
