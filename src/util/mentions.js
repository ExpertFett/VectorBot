// Shared mention builder. Turns a saved "mentions" config into the message
// content prefix + the allowedMentions object Discord needs to ACTUALLY fire
// the pings (without allowedMentions, role/everyone pings render but don't
// notify — a common gotcha).
//
// A mentions config is an array of tokens:
//   - a numeric string      → a role ID          → <@&id>
//   - the string 'everyone' → @everyone
//   - the string 'here'     → @here
//
// Discord note: both @everyone and @here are gated by the SAME allowed
// mentions parse value ('everyone'). There is no separate 'here' parse.

export function normalizeMentions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const t = String(raw);
    let token = null;
    if (t === 'everyone' || t === 'here') token = t;
    else if (/^\d+$/.test(t)) token = t;                 // role id
    else if (/^<@&(\d+)>$/.test(t)) token = t.match(/^<@&(\d+)>$/)[1];
    if (token && !seen.has(token)) { seen.add(token); out.push(token); }
    if (out.length >= 20) break;                          // sane cap
  }
  return out;
}

// Build { text, allowedMentions } from a mentions config, or null if empty.
// `text` is the space-joined ping prefix; merge it into your message content.
export function buildMentions(input) {
  const tokens = normalizeMentions(input);
  if (!tokens.length) return null;
  const roleIds = [];
  const parts = [];
  let everyone = false;
  for (const t of tokens) {
    if (t === 'everyone') { parts.push('@everyone'); everyone = true; }
    else if (t === 'here') { parts.push('@here'); everyone = true; }
    else { roleIds.push(t); parts.push(`<@&${t}>`); }
  }
  const allowedMentions = { parse: [], roles: roleIds };
  if (everyone) allowedMentions.parse.push('everyone');
  return { text: parts.join(' '), allowedMentions };
}

// Convenience: fold a mentions config into an existing message payload.
// Prepends the ping text to content and sets allowedMentions. Returns the
// same payload object (mutated) for chaining. No-op if mentions is empty.
export function applyMentions(payload, input) {
  const m = buildMentions(input);
  if (!m) {
    // Explicitly suppress pings when none configured, so a raw @everyone typed
    // into body text can't fire unless the user actually picked it.
    payload.allowedMentions = payload.allowedMentions || { parse: [] };
    return payload;
  }
  payload.content = payload.content ? `${m.text} ${payload.content}` : m.text;
  payload.allowedMentions = m.allowedMentions;
  return payload;
}
