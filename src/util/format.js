// Mee6-style placeholders for welcome / goodbye messages.
//   {user}        -> mention (welcome) — falls back to plain tag if mention unavailable
//   {username}    -> display name / tag
//   {server}      -> guild name
//   {membercount} -> current member count
export function applyPlaceholders(template, { member, guild, mention = true }) {
  return template
    .replaceAll('{user}', mention ? `<@${member.id}>` : member.user.username)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', guild.name)
    .replaceAll('{membercount}', String(guild.memberCount));
}
