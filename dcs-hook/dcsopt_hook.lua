-- dcsopt_hook.lua  --  DCS GameGUI Hook for DCS:OPT OPS Bot
-- Place this file, dcsopt_mission.lua, AND dcsopt_daemon.vbs in:
--   %USERPROFILE%\Saved Games\<your DCS variant>\Scripts\Hooks\
--
-- Posts live server status (players / mission / theatre) AND mission events
-- (kills, carrier LSO traps, bomb scores, sorties) to DCS:OPT OPS Bot.
--
-- ARCHITECTURE (v2): the hook never shells out per payload. It writes JSON
-- files into a queue folder and launches ONE background daemon (VBScript,
-- windowless) per mission load. The daemon POSTs each file via native
-- Windows WinHTTP — no curl, no cmd consoles — and exits on its own when
-- the hook's heartbeat goes stale (i.e. DCS closed).
--
-- WHY: os.execute() from DCS (a GUI app) spawns a visible cmd.exe console
-- on EVERY call, no matter what runs inside it. The old design executed it
-- every 2 seconds, which is where the endless cmd-window spam came from.
-- This design calls os.execute exactly once per mission load.

local DCSOPT = {}

-- Bump this whenever the hook's behaviour changes. The bot compares it to its
-- own DCS_HOOK_VERSION and nudges the user to re-download if they're behind.
DCSOPT.VERSION = "2.0.0"

DCSOPT.config = {
  -- Paste your per-server Ingest URL from the dashboard's "DCS Server" page:
  url               = "https://CHANGE-ME.up.railway.app/ingest/CHANGE_ME_TOKEN",
  statusInterval    = 60,  -- seconds between status heartbeats
  eventInterval     = 2,   -- seconds between draining mission events
  heartbeatInterval = 10,  -- seconds between daemon-keepalive file touches
  maxQueuedFiles    = 100, -- stop writing payloads if the daemon is dead
}

local function logmsg(s) log.write("DCSOPT", log.INFO,  s) end
local function logerr(s) log.write("DCSOPT", log.ERROR, s) end

local HOOKS_DIR = lfs.writedir() .. "Scripts\\Hooks\\"
local QUEUE_DIR = HOOKS_DIR .. "dcsopt_queue\\"

local installed     = false
local payloadSeq    = 0
local lastStatus    = 0
local lastDrain     = 0
local lastHeartbeat = 0

-- One-shot cleanup of files from PREVIOUS versions of this hook: the old
-- send-cmd, the old launcher vbs, and any orphaned payload json in the
-- Hooks root. Also sweeps stale payloads from the queue folder.
local function cleanupLegacyFiles()
  pcall(function()
    os.remove(HOOKS_DIR .. "dcsopt_send.cmd")
    os.remove(HOOKS_DIR .. "dcsopt_launch.vbs")
    os.remove(HOOKS_DIR .. "vectorbot_send.cmd")
    for file in lfs.dir(HOOKS_DIR) do
      if file:match("^dcsopt_%d+_%d+%.json$") or file:match("^vectorbot_%d+_%d+%.json$") then
        os.remove(HOOKS_DIR .. file)
      end
    end
  end)
  pcall(function()
    for file in lfs.dir(QUEUE_DIR) do
      if file:match("%.json$") or file:match("%.tmp$") then
        os.remove(QUEUE_DIR .. file)
      end
    end
  end)
  logmsg("legacy/stale file sweep complete")
end

local function countQueuedFiles()
  local n = 0
  local ok = pcall(function()
    for file in lfs.dir(QUEUE_DIR) do
      if file:match("%.json$") then n = n + 1 end
    end
  end)
  return ok and n or 0
end

local function writeHeartbeat()
  local f = io.open(QUEUE_DIR .. "heartbeat.txt", "w")
  if f then f:write(tostring(os.time())); f:close() end
end

-- Queue a payload: write to .tmp first, then rename to .json so the daemon
-- never reads a half-written file.
local function postPayload(json)
  if countQueuedFiles() >= DCSOPT.config.maxQueuedFiles then
    -- Daemon dead or endpoint unreachable for a long time. Don't flood disk.
    return
  end
  payloadSeq = payloadSeq + 1
  local base = string.format("%s%d_%d", QUEUE_DIR, os.time(), payloadSeq)
  local f = io.open(base .. ".tmp", "w")
  if not f then logerr("cannot write payload tmp"); return end
  f:write(json)
  f:close()
  os.rename(base .. ".tmp", base .. ".json")
end

-- Embedded copy of the daemon, written to disk if the .vbs is missing.
-- Self-heal: if the user dropped only the .lua files (the most common install
-- mistake), the hook materializes the daemon itself instead of going dark.
-- Keep this in sync with dcs-hook/dcsopt_daemon.vbs in the repo.
local DAEMON_VBS = [==[
Option Explicit
Dim fso, queueDir, url, lock, startedAt
Set fso = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count < 2 Then WScript.Quit
queueDir = WScript.Arguments(0)
url = WScript.Arguments(1)
If Right(queueDir, 1) <> "\" Then queueDir = queueDir & "\"
If Not fso.FolderExists(queueDir) Then WScript.Quit
On Error Resume Next
Set lock = fso.OpenTextFile(queueDir & "daemon.lock", 2, True)
If Err.Number <> 0 Then WScript.Quit
On Error GoTo 0
startedAt = Now
Function ReadUtf8(path)
  Dim s
  Set s = CreateObject("ADODB.Stream")
  s.Type = 2 : s.Charset = "utf-8" : s.Open
  s.LoadFromFile path
  ReadUtf8 = s.ReadText : s.Close
End Function
Sub PostJson(body)
  Dim http
  On Error Resume Next
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  http.Open "POST", url, False
  http.SetRequestHeader "Content-Type", "application/json"
  http.SetTimeouts 5000, 5000, 5000, 10000
  http.Send body
  On Error GoTo 0
End Sub
Dim hbPath, f, stale
hbPath = queueDir & "heartbeat.txt"
Do While True
  stale = False
  If fso.FileExists(hbPath) Then
    If DateDiff("s", fso.GetFile(hbPath).DateLastModified, Now) > 90 Then stale = True
  ElseIf DateDiff("s", startedAt, Now) > 120 Then
    stale = True
  End If
  If stale Then Exit Do
  On Error Resume Next
  For Each f In fso.GetFolder(queueDir).Files
    If LCase(fso.GetExtensionName(f.Name)) = "json" Then
      PostJson ReadUtf8(f.Path)
      f.Delete True
    End If
  Next
  On Error GoTo 0
  WScript.Sleep 2000
Loop
lock.Close
On Error Resume Next
fso.DeleteFile queueDir & "daemon.lock", True
]==]

local function ensureDaemonFile()
  local vbs = HOOKS_DIR .. "dcsopt_daemon.vbs"
  local fh = io.open(vbs, "r")
  if fh then fh:close(); return vbs end
  -- Missing — write our embedded copy so telemetry still works.
  local out = io.open(vbs, "w")
  if not out then logerr("cannot write daemon vbs to " .. vbs); return nil end
  out:write(DAEMON_VBS)
  out:close()
  logmsg("daemon vbs was missing — wrote embedded copy (self-heal)")
  return vbs
end

-- Launch the posting daemon. The ONLY os.execute in this file — one brief
-- minimized console flash per mission load, then silence. The daemon holds
-- an exclusive lock file, so double-launches exit immediately.
local function launchDaemon()
  local vbs = ensureDaemonFile()
  if not vbs then return end
  writeHeartbeat()
  os.execute(string.format(
    'start "" /min wscript.exe //B //Nologo "%s" "%s" "%s"',
    vbs, QUEUE_DIR, DCSOPT.config.url))
  logmsg("posting daemon launched")
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
    '{"type":"status","online":%s,"players":%d,"names":[%s],"mission":%s,"theatre":%s,"hook_version":%s}',
    tostring(online), players, table.concat(names, ","), jsonString(mission), jsonString(theatre), jsonString(DCSOPT.VERSION)))
end

local function readMissionScript()
  local path = lfs.writedir() .. "Scripts/Hooks/dcsopt_mission.lua"
  local f = io.open(path, "r")
  if not f then logerr("cannot open " .. path); return nil end
  local data = f:read("*a")
  f:close()
  return data
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
  -- Defensive drain: only call DCSOPT.drain if it exists, and only queue the
  -- result if it looks like a JSON array. Sandbox error text never gets posted.
  local ok, res = pcall(function()
    return net.dostring_in("mission", "return (DCSOPT and DCSOPT.drain and DCSOPT.drain()) or ''")
  end)
  if ok and type(res) == "string" and #res >= 2 and res:sub(1,1) == "[" and res:sub(-1) == "]" then
    postPayload('{"type":"events","events":' .. res .. '}')
  end
end

local callbacks = {}

function callbacks.onSimulationStart()
  installed = false
  lastStatus = os.time()
  lastHeartbeat = 0
  install()
  launchDaemon()
  sendStatus(true)
end

function callbacks.onSimulationStop()
  installed = false
  -- Daemon stays alive ~90s past the last heartbeat — long enough to deliver this.
  sendStatus(false)
end

function callbacks.onPlayerConnect()    sendStatus(true) end
function callbacks.onPlayerDisconnect() sendStatus(true) end

function callbacks.onSimulationFrame()
  if not installed then install() end
  local now = os.time()
  if now - lastHeartbeat >= DCSOPT.config.heartbeatInterval then
    lastHeartbeat = now
    writeHeartbeat()
  end
  if now - lastDrain >= DCSOPT.config.eventInterval then
    lastDrain = now
    drainEvents()
  end
  if now - lastStatus >= DCSOPT.config.statusInterval then
    lastStatus = now
    sendStatus(true)
  end
end

lfs.mkdir(QUEUE_DIR)
cleanupLegacyFiles()
DCS.setUserCallbacks(callbacks)
logmsg("hook loaded (v2 daemon architecture)")
