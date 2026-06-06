// Mee6-style placeholders for welcome / goodbye messages.
//   {user}         -> mention (welcome) — falls back to plain tag if mention unavailable
//   {username}     -> user's Discord username
//   {displayname}  -> per-server display name (nickname if set, else username)
//   {tag}          -> full username#discriminator
//   {id}           -> snowflake ID
//   {avatar}       -> user's avatar URL (works in image fields like Thumbnail)
//   {server}       -> guild name
//   {membercount}  -> current member count
export function applyPlaceholders(template, { member, guild, mention = true }) {
  if (!template) return template;
  return String(template)
    .replaceAll('{user}', mention ? `<@${member.id}>` : member.user.username)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{displayname}', member.displayName || member.user.username)
    .replaceAll('{tag}', member.user.tag || member.user.username)
    .replaceAll('{id}', member.id)
    .replaceAll('{avatar}', member.user.displayAvatarURL({ size: 512, extension: 'png' }))
    .replaceAll('{server}', guild.name)
    .replaceAll('{membercount}', String(guild.memberCount));
}
