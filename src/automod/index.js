import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getAutomod, getConfig, addWarning, addModLog } from '../db/index.js';

const URL_RE = /https?:\/\/[^\s]+/gi;
const INVITE_RE = /(discord\.(gg|io|me|li)\/|discord(?:app)?\.com\/invite\/)/i;
const TIMEOUT_MS = 5 * 60 * 1000; // automod timeout = 5 minutes

// Per-user recent-message timestamps for spam detection.
const spamMap = new Map();

function wordRegex(w) {
  const esc = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'i');
}

function isAllowedUrl(url, allowed) {
  if (!allowed || allowed.length === 0) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowed.some((d) => {
      const dom = String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      return host === dom || host.endsWith('.' + dom);
    });
  } catch {
    return false;
  }
}

async function applyAction(message, rule, reason, ruleName) {
  const taken = [];
  try { await message.delete(); taken.push('deleted'); } catch { /* may already be gone */ }

  const action = rule.action || 'delete';
  if (action === 'warn') {
    addWarning(message.guild.id, message.author.id, message.client.user.id, `[automod] ${reason}`);
    taken.push('warned');
  } else if (action === 'timeout') {
    try { await message.member?.timeout(TIMEOUT_MS, `[automod] ${reason}`); taken.push('timed out 5m'); }
    catch { /* missing perms / hierarchy */ }
  }

  addModLog({
    guildId: message.guild.id,
    action: `automod:${ruleName}`,
    targetId: message.author.id,
    targetTag: message.author.tag,
    moderatorId: message.client.user.id,
    moderatorTag: message.client.user.tag,
    reason,
  });

  const cfg = getConfig(message.guild.id);
  if (cfg.log_channel_id) {
    const ch = message.guild.channels.cache.get(cfg.log_channel_id);
    if (ch?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('Auto-moderation')
        .setColor(0xf23f43)
        .setDescription(`**${message.author.tag}** (<@${message.author.id}>) — ${reason}`)
        .addFields(
          { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
          { name: 'Action', value: taken.join(', ') || 'none', inline: true },
        )
        .setTimestamp();
      ch.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

// Returns true if a rule was triggered and the message was acted upon.
export async function checkMessage(message) {
  if (!message.guild || message.author.bot) return false;

  const cfg = getAutomod(message.guild.id);
  const member = message.member;

  // Staff and exemptions bypass automod.
  if (member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return false;
  if (member && cfg.exemptRoles.some((r) => member.roles.cache.has(r))) return false;
  if (cfg.exemptChannels.includes(message.channelId)) return false;

  const content = message.content || '';
  const { spam, mentions, words, invites, links } = cfg.rules;

  if (invites.enabled && INVITE_RE.test(content)) {
    await applyAction(message, invites, 'Posted a server invite', 'invites');
    return true;
  }

  if (links.enabled) {
    const urls = content.match(URL_RE) || [];
    if (urls.some((u) => !isAllowedUrl(u, links.allowed))) {
      await applyAction(message, links, 'Posted a disallowed link', 'links');
      return true;
    }
  }

  if (mentions.enabled) {
    const count = message.mentions.users.size + message.mentions.roles.size;
    if (count > mentions.maxMentions) {
      await applyAction(message, mentions, `Too many mentions (${count})`, 'mentions');
      return true;
    }
  }

  if (words.enabled && words.list.length) {
    const lc = content.toLowerCase();
    if (words.list.some((w) => w && wordRegex(w).test(lc))) {
      await applyAction(message, words, 'Used a blocked word', 'words');
      return true;
    }
  }

  if (spam.enabled) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const windowMs = spam.perSeconds * 1000;
    const recent = (spamMap.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    spamMap.set(key, recent);
    if (recent.length > spam.maxMessages) {
      spamMap.set(key, []);
      await applyAction(message, spam, `Spam (${recent.length} msgs / ${spam.perSeconds}s)`, 'spam');
      return true;
    }
  }

  return false;
}
