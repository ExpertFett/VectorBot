' dcsopt_daemon.vbs -- background poster for DCS:OPT OPS Bot.
'
' Launched once per mission load by dcsopt_hook.lua (via wscript, which is a
' windowless GUI-subsystem process). Watches the queue folder and POSTs each
' .json payload via native Windows WinHTTP -- no curl, no cmd consoles, ever.
'
' Lifecycle: exits on its own when the hook's heartbeat file goes stale
' (DCS closed or stopped writing), so it can never outlive the game. A lock
' file held with an exclusive write handle guarantees only one daemon runs
' per queue folder, no matter how many times the hook tries to launch it.
'
' Args: 0 = queue folder path, 1 = ingest URL.

Option Explicit

Dim fso, queueDir, url, lock, startedAt
Set fso = CreateObject("Scripting.FileSystemObject")

If WScript.Arguments.Count < 2 Then WScript.Quit
queueDir = WScript.Arguments(0)
url = WScript.Arguments(1)
If Right(queueDir, 1) <> "\" Then queueDir = queueDir & "\"
If Not fso.FolderExists(queueDir) Then WScript.Quit

' Single-instance guard: an exclusive write handle on the lock file. A second
' daemon's OpenTextFile raises a sharing violation and it quits immediately.
On Error Resume Next
Set lock = fso.OpenTextFile(queueDir & "daemon.lock", 2, True)
If Err.Number <> 0 Then WScript.Quit
On Error GoTo 0

startedAt = Now

' Read a file as UTF-8 (FileSystemObject's OpenTextFile would mangle
' non-ASCII player names).
Function ReadUtf8(path)
  Dim s
  Set s = CreateObject("ADODB.Stream")
  s.Type = 2
  s.Charset = "utf-8"
  s.Open
  s.LoadFromFile path
  ReadUtf8 = s.ReadText
  s.Close
End Function

' POST one JSON body. Errors are swallowed -- telemetry is lossy by design;
' a failed POST must never wedge the loop or leave files behind.
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
  ' Exit when the hook stops heartbeating (DCS closed). 90s threshold vs the
  ' hook's 10s heartbeat interval leaves a wide margin for load stutters.
  stale = False
  If fso.FileExists(hbPath) Then
    If DateDiff("s", fso.GetFile(hbPath).DateLastModified, Now) > 90 Then stale = True
  ElseIf DateDiff("s", startedAt, Now) > 120 Then
    stale = True
  End If
  If stale Then Exit Do

  ' Drain the queue. Delete after posting regardless of outcome -- if the
  ' endpoint is down we drop events rather than letting files pile up.
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
