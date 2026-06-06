// Automation engine. fireTrigger(type, ctx) looks up every enabled rule of that
// type for the guild, validates the trigger params against the ctx, and runs
// each rule's actions in sequence. Action failures are logged but don't abort
// the rest of the rule chain — one bad role-add shouldn't block the DM.
//
// Hooked into existing event handlers (guildMemberAdd, messageCreate, etc.)
// so the engine itself stays Discord-event-agnostic.

import { getEnabledAutomationsForTrigger, recordAutomationFire } from '../db/index.js';
import { applyPlaceholders } from '../util/format.js';
import { getBotForGuild } from '../customBots/index.js';

const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

// Decide whether the rule's trigger params match this firing's context.
function paramsMatch(triggerType, params, ctx) {
  switch (triggerType) {
    case 'member.role_added':
    case 'member.role_removed':
      // The role added/removed must be the one configured on the rule.
      return params.role_id && ctx.role?.id === params.role_id;
    case 'message.keyword': {
      if (!params.keyword) return false;
      if (params.channel_id && ctx.channel?.id !== params.channel_id) return false;
      const text = String(ctx.message?.content || '').toLowerCase();
      return text.includes(String(params.keyword).toLowerCase());
    }
    default:
      return true;
  }
}

function fill(template, ctx) {
  if (!template) return template;
  // Reuse the welcome/onboarding placeholder helper. When we have a real
  // GuildMember (the common case), pass it straight through so {avatar} et al
  // resolve to real CDN URLs. Fall back to a minimal synthetic shape only
  // when no member is in context (e.g. send.message on a member.leave where
  // the partial member is gone — the user shape is enough for {username}).
  const guild = ctx.guild ? { name: ctx.guild.name, memberCount: ctx.guild.memberCount ?? 0 } : { name: '', memberCount: 0 };
  if (ctx.member?.user?.displayAvatarURL) {
    return applyPlaceholders(String(template), { member: ctx.member, guild, mention: true });
  }
  const user = ctx.user || ctx.member?.user;
  const synthetic = {
    id: user?.id || '',
    displayName: user?.username || '',
    user: {
      id: user?.id || '',
      username: user?.username || '',
      tag: user?.tag || user?.username || '',
      // Default-avatar fallback so {avatar} at least renders SOMETHING.
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
  };
  return applyPlaceholders(String(template), { member: synthetic, guild, mention: true });
}

async function runAction(action, ctx, mainClient) {
  const { type, params = {} } = action;
  const bot = getBotForGuild(ctx.guild.id, mainClient);

  switch (type) {
    case 'send.message': {
      const channelId = params.channel_id;
      if (!channelId) return;
      const ch = bot.channels.cache.get(channelId) || (await bot.channels.fetch(channelId).catch(() => null));
      if (!ch?.isTextBased()) return;
      await ch.send({ content: fill(params.content || '', ctx).slice(0, 2000) }).catch((e) => console.warn('[automations] send.message failed:', e.message));
      return;
    }
    case 'send.dm': {
      // ctx.member is normally a GuildMember (has .send); guard for bots /
      // partials where .send is missing so we never hit "not a function".
      if (!ctx.member || typeof ctx.member.send !== 'function') return;
      await ctx.member.send({ content: fill(params.content || '', ctx).slice(0, 2000) }).catch(() => { /* user has DMs off — best effort */ });
      return;
    }
    case 'role.add': {
      if (!ctx.member || !params.role_id) return;
      const role = ctx.guild.roles.cache.get(params.role_id);
      const me = ctx.guild.members.me;
      if (!role || (me && role.position >= me.roles.highest.position)) return;
      await ctx.member.roles.add(params.role_id, 'Automation').catch((e) => console.warn('[automations] role.add failed:', e.message));
      return;
    }
    case 'role.remove': {
      if (!ctx.member || !params.role_id) return;
      const role = ctx.guild.roles.cache.get(params.role_id);
      const me = ctx.guild.members.me;
      if (!role || (me && role.position >= me.roles.highest.position)) return;
      await ctx.member.roles.remove(params.role_id, 'Automation').catch((e) => console.warn('[automations] role.remove failed:', e.message));
      return;
    }
    case 'react.emoji': {
      if (!ctx.message || !params.emoji) return;
      await ctx.message.react(String(params.emoji).trim()).catch((e) => console.warn('[automations] react failed:', e.message));
      return;
    }
    case 'delete.message': {
      if (!ctx.message) return;
      await ctx.message.delete().catch((e) => console.warn('[automations] delete failed:', e.message));
      return;
    }
    default:
      console.warn(`[automations] unknown action type: ${type}`);
  }
}

// Public API. Hand this whatever context is natural for the event — the engine
// pulls what it needs. Safe to call from any event handler; never throws.
export async function fireTrigger(triggerType, ctx, mainClient) {
  if (!ctx?.guild?.id) return;
  let rules;
  try { rules = getEnabledAutomationsForTrigger(ctx.guild.id, triggerType); }
  catch (err) { console.error('[automations] DB lookup failed:', err.message); return; }
  for (const rule of rules) {
    try {
      if (!paramsMatch(triggerType, rule.trigger_params, ctx)) continue;
      for (const action of rule.actions) {
        await runAction(action, ctx, mainClient);
      }
      recordAutomationFire(rule.id);
    } catch (err) {
      console.error(`[automations] rule "${rule.name}" (${rule.id}) failed:`, err.message);
    }
  }
}
