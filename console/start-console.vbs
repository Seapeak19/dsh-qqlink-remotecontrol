' Whale Console launcher (ASCII only; do not add non-ASCII text here)
Option Explicit

Dim sh, fso, consoleDir, logsDir, url, alive, http, nodeExe, edge, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

consoleDir = fso.GetParentFolderName(WScript.ScriptFullName)
logsDir = fso.BuildPath(consoleDir, "logs")
url = "http://127.0.0.1:3900/"

' 1) If the backend is already running, just open the UI.
alive = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 800, 800, 1500, 1500
http.open "GET", url & "api/ping", False
http.send
If Err.Number = 0 Then
  If http.status = 200 Then
    alive = True
  End If
End If
Err.Clear
On Error GoTo 0

' 2) Start the backend hidden if it is not running.
If Not alive Then
  If Not fso.FolderExists(logsDir) Then
    fso.CreateFolder(logsDir)
  End If
  nodeExe = sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
  If Not fso.FileExists(nodeExe) Then
    nodeExe = "node"
  End If
  sh.CurrentDirectory = consoleDir
  cmd = "cmd /c """ & nodeExe & """ server.js >> logs\console.log 2>&1"
  sh.Run cmd, 0, False
  WScript.Sleep 1800
End If

' 3) Open the UI in Edge app mode, fallback to the default browser.
edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edge) Then
  edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
End If
If fso.FileExists(edge) Then
  sh.Run """" & edge & """ --app=" & url, 1, False
Else
  sh.Run url, 1, False
End If