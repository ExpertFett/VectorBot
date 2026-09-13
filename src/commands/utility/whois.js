import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getRosterEntry, getConfig } from '../../db/index.js';

const RR_PURPLE = 0x9119f5;

// Ready Room is the single source of truth for the roster. If this guild is
// wired to a Ready Room wing (readyroom_ingest_url), pull the pilot's card from
// there over the existing token'd link. Returns:
//   { member }   — found
//   { notFound } — wing reachable, but this Discord user isn't linked to a pilot
//   null         — no wing configured, or it was unreachable (→ fall back to local)
async function fetchFromReadyRoom(guildId, discordId) {
  let base = null;
  try { base = getConfig(guildId)?.readyroom_ingest_url || null; } catch { base = null; }
  if (!base) return null; // guild not linked to Ready Room
  const url = `${String(base).replace(/\/+$/, '')}/whois/${discordId}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return null; // unreachable/error → resilient fallback to local
    return await res.json();
  } catch { return null; }
}

export default {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Show a pilot\'s roster card.')
    .addUserOption((o) => o.setName('pilot').setDescription('Pilot to look up (defaults to you)')),

  async execute(interaction) {
    const user = interaction.options.getUser('pilot') ?? interaction.user;

    // --- Ready Room (authoritative when the guild is linked) ---
    const rr = await fetchFromReadyRoom(interaction.guild.id, user.id);
    if (rr && rr.member) {
      const m = rr.member;
      const title = m.callsign
        ? `${m.rank ? `${m.rank} ` : ''}${m.callsign} — ${user.username}`
        : user.username;
      const embed = new EmbedBuilder()
        .setColor(RR_PURPLE)
        .setTitle(title)
        .setThumbnail(user.displayAvatarURL());
      if (m.name) embed.addFields({ name: 'Name', value: m.name, inline: true });
      if (m.modex) embed.addFields({ name: 'Modex', value: String(m.modex), inline: true });
      if (m.squadron) embed.addFields({ name: 'Squadron', value: m.squadron, inline: true });
      if (m.airframes) embed.addFields({ name: 'Airframes', value: m.airframes });
      if (Array.isArray(m.quals) && m.quals.length) embed.addFields({ name: 'Qualifications', value: m.quals.join(', ') });
      if (m.billet) embed.addFields({ name: 'Billet', value: m.billet });
      if (m.profile_url) embed.setURL(m.profile_url);
      embed.setFooter({ text: `${rr.wing?.tag || rr.wing?.name || 'Ready Room'} · Ready Room` });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    // Guild IS linked to Ready Room, but this Discord user isn't on the roster.
    if (rr && rr.notFound) {
      return interaction.reply({
        content: `**${user.username}** isn't linked to a pilot in Ready Room yet. An admin can add them to the roster (and set their Discord ID), or they can use the wing's claim link.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // --- Fallback: guild not linked to Ready Room (or it was unreachable) ---
    const entry = getRosterEntry(interaction.guild.id, user.id);
    if (!entry) {
      return interaction.reply({ content: `No roster entry for **${user.username}** yet.`, flags: MessageFlags.Ephemeral });
    }
    const embed = new EmbedBuilder()
      .setColor(RR_PURPLE)
      .setTitle(entry.callsign ? `${entry.callsign} — ${user.username}` : user.username)
      .setThumbnail(user.displayAvatarURL());
    if (entry.airframes) embed.addFields({ name: 'Airframes', value: entry.airframes });
    if (entry.quals) embed.addFields({ name: 'Qualifications', value: entry.quals });
    if (entry.notes) embed.addFields({ name: 'Notes', value: entry.notes });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
