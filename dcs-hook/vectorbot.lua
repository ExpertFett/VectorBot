-- vectorbot.lua  --  DCS GameGUI Hook for VectorBot
-- Place this file AND vectorbot_mission.lua in your server's:
--   %USERPROFILE%\Saved Games\DCS\Scripts\Hooks\
-- (use your DCS variant's folder, e.g. "DCS.openbeta" or "DCS.server")
--
-- Posts live server status (players / mission / theatre) AND mission events
-- (player kills, carrier LSO trap grades) to VectorBot.
-- DCS Lua has no TLS, so it shells out to Windows' built-in curl.exe.

local VectorBot = {}

VectorBot.config = {
  -- Paste your per-server Ingest URL from the dashboard's "DCS Server" page:
  url            = "https://CHANGE-ME.up.railway.app/ingest/CHANGE_ME_TOKEN",
  -- Seconds between status heartbeats:
  statusInterval = 60,
  -- Seconds between draining the mission event queue (kills / traps):
  eventInterval  = 2,
}

local function logmsg(s) log.write("VectorBot", log.INFO,  s) end
local function logerr(s) log.write("VectorBot", log.ERROR, s) end

local installed   = false
local sendBat     = nil
local payloadSeq  = 0
local lastStatus  = 0
local lastDrain   = 0

local function readMissionScript()
  local path = lfs.writedir() .. "Scripts/Hooks/vectorbot_mission.lua"
  local f = io.open(path, "r")
  if not f then logerr("cannot open " .. path); return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function writeSendBat()
  local path = os.getenv("TEMP") .. "\\vectorbot_send.cmd"
  local f = io.open(path, "w")
  if not f then logerr("cannot write " .. path); return nil end
  f:write("@echo off\r\n")
  f:write(string.format(
    'curl -s -m 10 -X POST -H "Content-Type: application/json" --data-binary "@%%~1" "%s"\r\n',
    VectorBot.config.url))
  f:write('del "%~1" >nul 2>&1\r\n')
  f:close()
  return path
end

local function postPayload(json)
  if not sendBat then sendBat = writeSendBat() end
  if not sendBat then return end
  payloadSeq = payloadSeq + 1
  local tmp = string.format("%s\\vectorbot_%d_%d.json", os.getenv("TEMP"), os.time(), payloadSeq)
  local f = io.open(tmp, "w")
  if not f then logerr("cannot write payload tmp"); return end
  f:write(json)
  f:close()
  os.execute(string.format('start "" /B "%s" "%s"', sendBat, tmp))
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
  local ok, res = pcall(function() return net.dostring_in("mission", "return VectorBot_drain()") end)
  if ok and res and res ~= "" then
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
  if now - lastDrain >= VectorBot.config.eventInterval then
    lastDrain = now
    drainEvents()
  end
  if now - lastStatus >= VectorBot.config.statusInterval then
    lastStatus = now
    sendStatus(true)
  end
end

DCS.setUserCallbacks(callbacks)
logmsg("hook loaded")
