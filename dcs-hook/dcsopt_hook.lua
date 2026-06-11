-- dcsopt_hook.lua  --  DCS GameGUI Hook for DCS:OPT OPS Bot
-- Place this file AND dcsopt_mission.lua AND dcsopt_launch.vbs in:
--   %USERPROFILE%\Saved Games\<your DCS variant>\Scripts\Hooks\
--
-- Posts live server status (players / mission / theatre) AND mission events
-- (kills, carrier LSO traps, bomb scores, sorties) to DCS:OPT OPS Bot.
--
-- DCS Lua has no HTTPS, so we shell out to Windows' built-in curl. The shell-
-- out itself uses a VBScript launcher (dcsopt_launch.vbs) so the cmd window
-- stays fully hidden — `start /B` doesn't reliably hide on every Windows /
-- DCS-dedicated-server combo we've seen.

local DCSOPT = {}

DCSOPT.config = {
  -- Paste your per-server Ingest URL from the dashboard's "DCS Server" page:
  url            = "https://CHANGE-ME.up.railway.app/ingest/CHANGE_ME_TOKEN",
  statusInterval = 60,   -- seconds between status heartbeats
  eventInterval  = 2,    -- seconds between draining mission events
}

local function logmsg(s) log.write("DCSOPT", log.INFO,  s) end
local function logerr(s) log.write("DCSOPT", log.ERROR, s) end

local installed    = false
local sendBat      = nil
local launcherVbs  = nil
local payloadSeq   = 0
local lastStatus   = 0
local lastDrain    = 0

local function readMissionScript()
  local path = lfs.writedir() .. "Scripts/Hooks/dcsopt_mission.lua"
  local f = io.open(path, "r")
  if not f then logerr("cannot open " .. path); return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function writeSendBat()
  local path = lfs.writedir() .. "Scripts\\Hooks\\dcsopt_send.cmd"
  local f = io.open(path, "w")
  if not f then logerr("cannot write " .. path); return nil end
  f:write("@echo off\r\n")
  f:write(string.format(
    'curl -s -m 10 -X POST -H "Content-Type: application/json" --data-binary "@%%~1" "%s" >nul 2>nul\r\n',
    DCSOPT.config.url))
  f:write('del "%~1" >nul 2>nul\r\n')
  f:close()
  return path
end

local function writeLauncher()
  local path = lfs.writedir() .. "Scripts\\Hooks\\dcsopt_launch.vbs"
  -- If a previous boot already wrote this, leave it alone — it's idempotent.
  local existing = io.open(path, "r")
  if existing then existing:close(); return path end
  local f = io.open(path, "w")
  if not f then logerr("cannot write " .. path); return nil end
  f:write('Set sh = CreateObject("WScript.Shell")\r\n')
  -- Args(0) = the .cmd to run, Args(1) = the .json file path to POST.
  -- Show-state 0 = fully hidden. False = don't wait.
  f:write('sh.Run """" & WScript.Arguments(0) & """ """ & WScript.Arguments(1) & """", 0, False\r\n')
  f:close()
  logmsg("launcher written: " .. path)
  return path
end

-- One-shot sweep of any .json files left in the Hooks folder by previous
-- buggy versions of this hook. Called once on boot.
local function cleanupStaleFiles()
  local dir = lfs.writedir() .. "Scripts/Hooks/"
  local ok = pcall(function()
    for file in lfs.dir(dir) do
      if file:match("^dcsopt_%d+_%d+%.json$") then
        os.remove(dir .. file)
      end
    end
  end)
  if ok then logmsg("swept stale json payloads from " .. dir) end
end

local function postPayload(json)
  if not sendBat then sendBat = writeSendBat() end
  if not launcherVbs then launcherVbs = writeLauncher() end
  if not sendBat or not launcherVbs then return end
  payloadSeq = payloadSeq + 1
  local tmp = string.format("%sScripts\\Hooks\\dcsopt_%d_%d.json",
    lfs.writedir(), os.time(), payloadSeq)
  local f = io.open(tmp, "w")
  if not f then logerr("cannot write payload tmp"); return end
  f:write(json)
  f:close()
  -- wscript is a windows-subsystem exe (not a console exe), so spawning it
  -- never shows a cmd window. The VBS then launches the curl with show=0.
  os.execute(string.format('wscript "%s" "%s" "%s"', launcherVbs, sendBat, tmp))
end

local function jsonString(s)
  if s == nil then return "null" end
  s = tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', ' '):gsub('\r', ' ')
  return '"' .. s .. '"'
end

local function sendStatus(online)
  local players, names = 0, {}
  local ok, list = pcall(net.get_player_list)
  if ok and list then
    for _, pid in pairs(list) do
      if pid ~= 1 then
        players = players + 1
        local n = net.get_player_info(pid, 'name')
        if n then names[#names + 1] = jsonString(n) end
      end
    end
  end
  local mission = (DCS.getMissionName and DCS.getMissionName()) or nil
  local theatre = (DCS.getMissionTheatre and DCS.getMissionTheatre()) or nil
  postPayload(string.format(
    '{"type":"status","online":%s,"players":%d,"names":[%s],"mission":%s,"theatre":%s}',
    tostring(online), players, table.concat(names, ","), jsonString(mission), jsonString(theatre)))
end

local function install()
  if installed then return end
  local missionLua = readMissionScript()
  if not missionLua then return end
  local ok, res = pcall(function() return net.dostring_in("mission", missionLua) end)
  if ok then installed = true; logmsg("mission tracker installed (" .. tostring(res) .. ")")
  else logerr("inject failed: " .. tostring(res)) end
end

local function drainEvents()
  if not installed then return end
  -- Defensive drain: ask the mission sandbox for the queue ONLY if both
  -- DCSOPT and DCSOPT.drain exist. Otherwise we'd get an error string back
  -- and (in earlier versions) POST it as bogus data 30 times a minute.
  local ok, res = pcall(function()
    return net.dostring_in("mission", "return (DCSOPT and DCSOPT.drain and DCSOPT.drain()) or ''")
  end)
  -- Only POST if the result is a string starting with '[' (a JSON array).
  -- Error responses from the sandbox are wrapped error text, not JSON.
  if ok and type(res) == "string" and #res >= 2 and res:sub(1,1) == "[" and res:sub(-1) == "]" then
    postPayload('{"type":"events","events":' .. res .. '}')
  end
end

local callbacks = {}

function callbacks.onSimulationStart()
  installed = false
  lastStatus = os.time()
  install()
  sendStatus(true)
end

function callbacks.onSimulationStop()
  installed = false
  sendStatus(false)
end

function callbacks.onPlayerConnect()    sendStatus(true) end
function callbacks.onPlayerDisconnect() sendStatus(true) end

function callbacks.onSimulationFrame()
  if not installed then install() end
  local now = os.time()
  if now - lastDrain >= DCSOPT.config.eventInterval then
    lastDrain = now
    drainEvents()
  end
  if now - lastStatus >= DCSOPT.config.statusInterval then
    lastStatus = now
    sendStatus(true)
  end
end

DCS.setUserCallbacks(callbacks)
cleanupStaleFiles()
logmsg("hook loaded")
