-- vectorbot.lua  --  DCS GameGUI Hook for VectorBot
-- Place this file in your server's:
--   %USERPROFILE%\Saved Games\DCS\Scripts\Hooks\
-- (use your DCS variant's folder, e.g. "DCS.openbeta" or "DCS.server")
--
-- Posts live server status (players / mission / theatre) to VectorBot.
-- DCS Lua has no TLS, so it shells out to Windows' built-in curl.exe.

local VectorBot = {}

VectorBot.config = {
  -- Paste your per-server Ingest URL from the dashboard's "DCS Server" page:
  url      = "https://CHANGE-ME.up.railway.app/ingest/CHANGE_ME_TOKEN",
  -- Seconds between status heartbeats:
  interval = 60,
}

local function logmsg(s) log.write("VectorBot", log.INFO,  s) end
local function logerr(s) log.write("VectorBot", log.ERROR, s) end

local sendBat    = nil
local payloadSeq = 0
local lastBeat   = 0

-- A tiny launcher .cmd avoids Windows quoting pain. %1 = payload file.
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

-- Detached, non-blocking send.
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

local function buildStatus(online)
  local players, names = 0, {}
  local ok, list = pcall(net.get_player_list)
  if ok and list then
    for _, id in pairs(list) do
      if id ~= 1 then -- id 1 is the server itself
        players = players + 1
        local n = net.get_player_info(id, 'name')
        if n then names[#names + 1] = jsonString(n) end
      end
    end
  end
  local mission = (DCS.getMissionName and DCS.getMissionName()) or nil
  local theatre = (DCS.getMissionTheatre and DCS.getMissionTheatre()) or nil
  return string.format(
    '{"type":"status","online":%s,"players":%d,"names":[%s],"mission":%s,"theatre":%s}',
    tostring(online), players, table.concat(names, ","), jsonString(mission), jsonString(theatre))
end

local function beat(online)
  local okp, payload = pcall(buildStatus, online)
  if okp and payload then postPayload(payload) end
end

local callbacks = {}

function callbacks.onSimulationStart()
  lastBeat = os.time()
  beat(true)
end

function callbacks.onSimulationStop()
  beat(false)
end

function callbacks.onPlayerConnect()  beat(true) end
function callbacks.onPlayerDisconnect() beat(true) end

function callbacks.onSimulationFrame()
  local now = os.time()
  if now - lastBeat < VectorBot.config.interval then return end
  lastBeat = now
  beat(true)
end

DCS.setUserCallbacks(callbacks)
logmsg("hook loaded")
