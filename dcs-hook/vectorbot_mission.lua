-- vectorbot_mission.lua
-- Runs INSIDE the DCS mission scripting environment (sandboxed Lua).
-- Injected by vectorbot.lua. Captures player kills and carrier (LSO) trap grades,
-- and queues JSON events for the GameGUI hook to drain via VectorBot_drain().

if VectorBot and VectorBot.installed then return "already-installed" end

VectorBot = {}
VectorBot.installed = true
VectorBot.queue = {}

local function jstr(s)
  s = tostring(s or "")
  s = string.gsub(s, "\\", "\\\\")
  s = string.gsub(s, '"', '\\"')
  s = string.gsub(s, "[\r\n]", " ")
  return '"' .. s .. '"'
end

local function unitName(u)
  if not u then return nil end
  local okp, pn = pcall(function() return u.getPlayerName and u:getPlayerName() end)
  if okp and pn then return pn end
  local okn, n = pcall(function() return u.getName and u:getName() end)
  if okn and n then return n end
  return nil
end

local function isPlayer(u)
  if not u or not u.getPlayerName then return false end
  local ok, pn = pcall(function() return u:getPlayerName() end)
  return ok and pn ~= nil
end

VectorBot.handler = {}
function VectorBot.handler:onEvent(event)
  if not event or not event.id then return end
  local id = event.id

  if id == world.event.S_EVENT_KILL then
    local killer, victim = event.initiator, event.target
    -- Only log kills that involve a player, to avoid AI-vs-AI spam.
    if isPlayer(killer) or isPlayer(victim) then
      local wtype = "weapon"
      if event.weapon and event.weapon.getTypeName then
        local ok, n = pcall(function() return event.weapon:getTypeName() end)
        if ok and n then wtype = n end
      end
      table.insert(VectorBot.queue, string.format(
        '{"kind":"kill","killer":%s,"victim":%s,"weapon":%s,"time":%.1f}',
        jstr(unitName(killer) or "unknown"), jstr(unitName(victim) or "unknown"), jstr(wtype), timer.getTime()))
    end

  elseif world.event.S_EVENT_LANDING_QUALITY_MARK and id == world.event.S_EVENT_LANDING_QUALITY_MARK then
    local pilot = unitName(event.initiator)
    if pilot then
      local ship = nil
      if event.place and event.place.getName then
        local ok, n = pcall(function() return event.place:getName() end)
        if ok then ship = n end
      end
      table.insert(VectorBot.queue, string.format(
        '{"kind":"trap","pilot":%s,"grade":%s,"ship":%s,"time":%.1f}',
        jstr(pilot), jstr(event.comment or ""), jstr(ship or ""), timer.getTime()))
    end
  end
end
world.addEventHandler(VectorBot.handler)

-- Called by the hook each drain interval; returns a JSON array string (or "").
function VectorBot_drain()
  if #VectorBot.queue == 0 then return "" end
  local body = table.concat(VectorBot.queue, ",")
  VectorBot.queue = {}
  return "[" .. body .. "]"
end

return "installed"
