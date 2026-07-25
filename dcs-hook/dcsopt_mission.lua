-- dcsopt_mission.lua
-- Runs INSIDE the DCS mission scripting environment (sandboxed Lua).
-- Injected by dcsopt_hook.lua at simulation start. Captures player kills,
-- carrier (LSO) trap grades, bomb/rocket impacts vs a "TGT" map-marker,
-- and sorties (takeoff → landing).
--
-- NOTE: drain() is attached to the DCSOPT table (NOT a top-level function).
-- Earlier versions used `function DCSOPT_drain()` but the DCS mission sandbox
-- didn't always expose top-level function declarations as globals across
-- net.dostring_in calls — the hook would get "attempt to call nil" errors
-- and spam JSON files with the error text. Table-attached methods are
-- reliable because DCSOPT itself is a known global.

if DCSOPT and DCSOPT.installed then return "already-installed" end

DCSOPT = {}
DCSOPT.installed = true
DCSOPT.queue    = {}
DCSOPT.tracked  = {}     -- weapons in flight (for impact detection)
DCSOPT.airborne = {}     -- unitName -> { pilot, t0, airframe } (for sorties)
DCSOPT.target   = nil    -- { x, z, name } from the most recent "TGT" map marker
DCSOPT.KEYWORD  = "TGT"

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

DCSOPT.handler = {}
function DCSOPT.handler:onEvent(event)
  if not event or not event.id then return end
  local id = event.id

  if id == world.event.S_EVENT_KILL then
    local killer, victim = event.initiator, event.target
    if isPlayer(killer) or isPlayer(victim) then
      table.insert(DCSOPT.queue, string.format(
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
      table.insert(DCSOPT.queue, string.format(
        '{"kind":"trap","pilot":%s,"grade":%s,"ship":%s,"time":%.1f}',
        jstr(pilot), jstr(event.comment or ""), jstr(ship or ""), timer.getTime()))
    end

  elseif id == world.event.S_EVENT_MARK_ADDED or id == world.event.S_EVENT_MARK_CHANGE then
    local text = event.text or ""
    if string.upper(string.sub(text, 1, #DCSOPT.KEYWORD)) == DCSOPT.KEYWORD and event.pos then
      DCSOPT.target = { x = event.pos.x, z = event.pos.z, name = text }
    end

  elseif id == world.event.S_EVENT_MARK_REMOVE then
    DCSOPT.target = nil

  elseif id == world.event.S_EVENT_SHOT then
    local w = event.weapon
    if w and isPlayer(event.initiator) then
      local ok, desc = pcall(function() return w:getDesc() end)
      if ok and desc and (desc.category == 2 or desc.category == 3) then
        local okp, p = pcall(function() return w:getPoint() end)
        if okp and p then
          table.insert(DCSOPT.tracked, { wpn = w, last = p, shooter = unitName(event.initiator) or "unknown", wtype = typeName(w) or "weapon" })
        end
      end
    end

  elseif id == world.event.S_EVENT_TAKEOFF then
    if isPlayer(event.initiator) then
      local key = event.initiator:getName()
      DCSOPT.airborne[key] = { pilot = unitName(event.initiator), t0 = timer.getTime(), airframe = typeName(event.initiator) or "aircraft" }
    end

  elseif id == world.event.S_EVENT_LAND then
    if isPlayer(event.initiator) then
      local key = event.initiator:getName()
      local s = DCSOPT.airborne[key]
      if s then
        table.insert(DCSOPT.queue, string.format(
          '{"kind":"sortie","pilot":%s,"airframe":%s,"seconds":%d}',
          jstr(s.pilot), jstr(s.airframe), math.floor(timer.getTime() - s.t0)))
        DCSOPT.airborne[key] = nil
      end
    end
  end
end
world.addEventHandler(DCSOPT.handler)

-- Grade band label for a miss distance (m). Kept in sync with bombGrade() in
-- src/features/dcsEvents.js so the in-game toast matches the Discord feed.
local COMPASS_16 = {"N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"}
local function bombLabel(m)
  if m <= 10 then return "SHACK"
  elseif m <= 25 then return "Excellent"
  elseif m <= 50 then return "Good"
  elseif m <= 100 then return "Fair"
  else return "Miss" end
end
local function compass16(brg)
  return COMPASS_16[math.floor((brg / 22.5) + 0.5) % 16 + 1]
end

local function poll()
  local i = 1
  while i <= #DCSOPT.tracked do
    local t = DCSOPT.tracked[i]
    local exists = false
    pcall(function() exists = t.wpn:isExist() end)
    if exists then
      local ok, p = pcall(function() return t.wpn:getPoint() end)
      if ok and p then t.last = p end
      i = i + 1
    else
      local dist = "null"
      local bearing = "null"
      local tgt = "null"
      if DCSOPT.target and t.last then
        -- DCS map frame: x = north (m), z = east (m). Bearing FROM target TO
        -- impact = the direction the pilot missed, 0-360 cw from north.
        local dx = t.last.x - DCSOPT.target.x
        local dz = t.last.z - DCSOPT.target.z
        local dm = math.sqrt(dx * dx + dz * dz)
        local brg = math.deg(math.atan2(dz, dx))
        if brg < 0 then brg = brg + 360 end
        dist    = string.format("%.1f", dm)
        bearing = string.format("%.1f", brg)
        tgt     = jstr(DCSOPT.target.name)
        -- In-game toast to everyone in the mission. Only fires when a TGT
        -- marker is present AND the impact is within 100 m (avoids spamming
        -- huge misses that weren't real bombing attempts).
        if dm <= 100 then
          pcall(function()
            trigger.action.outText(string.format(
              "BOMB %s -- %.0fm %s at %.0fdeg -- %s",
              t.shooter, dm, compass16(brg), brg, bombLabel(dm)), 12, false)
          end)
        end
      end
      table.insert(DCSOPT.queue, string.format(
        '{"kind":"bomb","shooter":%s,"weapon":%s,"distance":%s,"bearing":%s,"target":%s,"time":%.1f}',
        jstr(t.shooter), jstr(t.wtype), dist, bearing, tgt, timer.getTime()))
      table.remove(DCSOPT.tracked, i)
    end
  end
  return timer.getTime() + 0.05
end
timer.scheduleFunction(poll, nil, timer.getTime() + 0.05)

-- Drain attached to the table so it's reliably reachable as a global property
-- even across separate net.dostring_in injections.
DCSOPT.drain = function()
  if #DCSOPT.queue == 0 then return "" end
  local body = table.concat(DCSOPT.queue, ",")
  DCSOPT.queue = {}
  return "[" .. body .. "]"
end

return "installed"
