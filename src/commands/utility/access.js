import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getAccessGroups, getPersonalization } from '../../db/index.js';
import { canPerform } from '../../access/check.js';
import { ACTIONS } from '../../access/registry.js';

export default {
  data: new SlashCommandBuilder()
    .setName('access')
    .setDescription('Show the squadron\'s access groups and what each can do.')
    .addSubcommand((s) => s.setName('groups').setDescription('List the named access groups + the roles in each'))
    .addSubcommand((s) => s.setName('me').setDescription('Show which gated actions YOU are permitted to perform')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const accent = getPersonalization(interaction.guild.id).embed_color ?? 0x9119f5;

    if (sub === 'groups') {
      const groups = getAccessGroups(interaction.guild.id);
      const embed = new EmbedBuilder().setColor(accent).setTitle('Access Groups');
      if (!groups.length) {
        embed.setDescription('No access groups have been configured yet. Admins can create them at the dashboard.');
      } else {
        for (const g of groups) {
          const roles = g.role_ids.length
            ? g.role_ids.map((id) => `<@&${id}>`).join(' ')
            : '_(no roles assigned)_';
          embed.addFields({ name: g.name, value: roles, inline: false });
        }
      }
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'me') {
      const member = interaction.member;
      const isOwner = interaction.guild.ownerId === member.id;
      const isAdmin = member.permissions?.has?.('ManageGuild');
      const allowed = ACTIONS.filter((a) => canPerform(member, a.key));
      const embed = new EmbedBuilder().setColor(accent).setTitle('Your bot permissions');
      if (isOwner) embed.setDescription('You are the **server owner** — every gated action is allowed.');
      else if (isAdmin) embed.setDescription('You have **Manage Server** — every gated action is allowed.');
      else if (!allowed.length) embed.setDescription('You aren\'t granted any gated actions. Ask an admin to add a role you have to an access group with permissions.');
      else {
        const byCat = allowed.reduce((acc, a) => { (acc[a.category] = acc[a.category] || []).push(a.label); return acc; }, {});
        for (const [cat, items] of Object.entries(byCat)) {
          embed.addFields({ name: cat, value: items.map((l) => `• ${l}`).join('\n'), inline: false });
        }
      }
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
