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

function buildVars(ctx) {
  if (!ctx.member && !ctx.user) return { server: ctx.guild?.name };
  const user = ctx.user || ctx.member?.user;
  return {
    user: user ? `<@${user.id}>` : '',
    username: user?.username || '',
    displayname: ctx.member?.displayName || user?.username || '',
    tag: user?.tag || user?.username || '',
    id: user?.id || '',
    server: ctx.guild?.name || '',
    membercount: String(ctx.guild?.memberCount ?? ''),
  };
}

function fill(template, vars) {
  if (!template) return template;
  // Reuse the welcome/onboarding placeholder helper for consistency.
  return applyPlaceholders(String(template), {
    member: { id: vars.id, displayName: vars.displayname, user: { id: vars.id, username: vars.username, tag: vars.tag, displayAvatarURL: () => '' } },
    guild: { name: vars.server, memberCount: Number(vars.membercount) || 0 },
    mention: true,
  });
}

async function runAction(action, ctx, mainClient) {
  const { type, params = {} } = action;
  const vars = buildVars(ctx);
  const bot = getBotForGuild(ctx.guild.id, mainClient);

  switch (type) {
    case 'send.message': {
      const channelId = params.channel_id;
      if (!channelId) return;
      const ch = bot.channels.cache.get(channelId) || (await bot.channels.fetch(channelId).catch(() => null));
      if (!ch?.isTextBased()) return;
      await ch.send({ content: fill(params.content || '', vars).slice(0, 2000) }).catch((e) => console.warn('[automations] send.message failed:', e.message));
      return;
    }
    case 'send.dm': {
      if (!ctx.member) return;
      await ctx.member.send({ content: fill(params.content || '', vars).slice(0, 2000) }).catch(() => { /* user has DMs off — best effort */ });
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
