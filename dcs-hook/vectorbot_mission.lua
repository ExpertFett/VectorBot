-- vectorbot_mission.lua
-- Runs INSIDE the DCS mission scripting environment (sandboxed Lua).
-- Injected by vectorbot.lua. Captures player kills, carrier (LSO) trap grades,
-- bomb/rocket impacts vs a "TGT" map-marker, and sorties (takeoff->landing).
-- Queues JSON events for the GameGUI hook to drain via VectorBot_drain().

if VectorBot and VectorBot.installed then return "already-installed" end

VectorBot = {}
VectorBot.installed = true
VectorBot.queue   = {}
VectorBot.tracked = {}   -- weapons in flight (for impact detection)
VectorBot.airborne = {}  -- unitName -> { pilot, t0, airframe } (for sorties)
VectorBot.target  = nil  -- { x, z, name } from a "TGT" map marker
VectorBot.KEYWORD = "TGT"

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

local function typeName(u)
  if not u or not u.getTypeName then return nil end
  local ok, n = pcall(function() return u:getTypeName() end)
  return ok and n or nil
end

VectorBot.handler = {}
function VectorBot.handler:onEvent(event)
  if not event or not event.id then return end
  local id = event.id

  if id == world.event.S_EVENT_KILL then
    local killer, victim = event.initiator, event.target
    if isPlayer(killer) or isPlayer(victim) then
      table.insert(VectorBot.queue, string.format(
        '{"kind":"kill","killer":%s,"victim":%s,"weapon":%s,"time":%.1f}',
        jstr(unitName(killer) or "unknown"), jstr(unitName(victim) or "unknown"), jstr(typeName(event.weapon) or "weapon"), timer.getTime()))
    end

  elseif world.event.S_EVENT_LANDING_QUALITY_MARK and id == world.event.S_EVENT_LANDING_QUALITY_MARK then
    local pilot = unitName(event.initiator)
    if pilot then
      local ship = nil
      if event.place and event.place.getName then
        local ok, n = pcall(function() return event.place:getName() end); if ok then ship = n end
      end
      table.insert(VectorBot.queue, string.format(
        '{"kind":"trap","pilot":%s,"grade":%s,"ship":%s,"time":%.1f}',
        jstr(pilot), jstr(event.comment or ""), jstr(ship or ""), timer.getTime()))
    end

  elseif id == world.event.S_EVENT_MARK_ADDED or id == world.event.S_EVENT_MARK_CHANGE then
    local text = event.text or ""
    if string.upper(string.sub(text, 1, #VectorBot.KEYWORD)) == VectorBot.KEYWORD and event.pos then
      VectorBot.target = { x = event.pos.x, z = event.pos.z, name = text }
    end

  elseif id == world.event.S_EVENT_MARK_REMOVE then
    VectorBot.target = nil

  elseif id == world.event.S_EVENT_SHOT then
    local w = event.weapon
    if w and isPlayer(event.initiator) then
      local ok, desc = pcall(function() return w:getDesc() end)
      if ok and desc and (desc.category == 2 or desc.category == 3) then -- rocket / bomb
        local okp, p = pcall(function() return w:getPoint() end)
        if okp and p then
          table.insert(VectorBot.tracked, { wpn = w, last = p, shooter = unitName(event.initiator) or "unknown", wtype = typeName(w) or "weapon" })
        end
      end
    end

  elseif id == world.event.S_EVENT_TAKEOFF then
    if isPlayer(event.initiator) then
      local key = event.initiator:getName()
      VectorBot.airborne[key] = { pilot = unitName(event.initiator), t0 = timer.getTime(), airframe = typeName(event.initiator) or "aircraft" }
    end

  elseif id == world.event.S_EVENT_LAND then
    if isPlayer(event.initiator) then
      local key = event.initiator:getName()
      local s = VectorBot.airborne[key]
      if s then
        table.insert(VectorBot.queue, string.format(
          '{"kind":"sortie","pilot":%s,"airframe":%s,"seconds":%d}',
          jstr(s.pilot), jstr(s.airframe), math.floor(timer.getTime() - s.t0)))
        VectorBot.airborne[key] = nil
      end
    end
  end
end
world.addEventHandler(VectorBot.handler)

-- Poll tracked weapons; the last position before a weapon stops existing is the impact.
local function poll()
  local i = 1
  while i <= #VectorBot.tracked do
    local t = VectorBot.tracked[i]
    local exists = false
    pcall(function() exists = t.wpn:isExist() end)
    if exists then
      local ok, p = pcall(function() return t.wpn:getPoint() end)
      if ok and p then t.last = p end
      i = i + 1
    else
      local dist = "null"
      local tgt = "null"
      if VectorBot.target and t.last then
        local dx = t.last.x - VectorBot.target.x
        local dz = t.last.z - VectorBot.target.z
        dist = string.format("%.1f", math.sqrt(dx * dx + dz * dz))
        tgt = jstr(VectorBot.target.name)
      end
      table.insert(VectorBot.queue, string.format(
        '{"kind":"bomb","shooter":%s,"weapon":%s,"distance":%s,"target":%s,"time":%.1f}',
        jstr(t.shooter), jstr(t.wtype), dist, tgt, timer.getTime()))
      table.remove(VectorBot.tracked, i)
    end
  end
  return timer.getTime() + 0.05
end
timer.scheduleFunction(poll, nil, timer.getTime() + 0.05)

function VectorBot_drain()
  if #VectorBot.queue == 0 then return "" end
  local body = table.concat(VectorBot.queue, ",")
  VectorBot.queue = {}
  return "[" .. body .. "]"
end

return "installed"
