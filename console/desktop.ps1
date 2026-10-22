param([Parameter(Mandatory = $true)][string]$ArgsFile)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# 桌面驱动：窗口查找 / 启动 / 聚焦 / 截图 / 点击 / 输入 / 按键 / 滚轮
# 只做「被指定的进程与窗口」内的操作；授权判断在 Node 侧的 desktop-lib.cjs。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ('Win32Desktop' -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Desktop {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
}
[Win32Desktop]::SetProcessDPIAware() | Out-Null

function Out-Json($obj) {
  $obj | ConvertTo-Json -Compress -Depth 8
}

function Save-Jpeg {
  param($Bmp, [string]$Path)
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
  $enc = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]85)
  $Bmp.Save($Path, $codec, $enc)
}

function New-AppWindowObject {
  param($P)
  $rect = New-Object Win32Desktop+RECT
  [Win32Desktop]::GetWindowRect($P.MainWindowHandle, [ref]$rect) | Out-Null
  return [pscustomobject]@{
    pid     = [int]$P.Id
    process = [string]$P.ProcessName
    title   = [string]$P.MainWindowTitle
    handle  = [int64]$P.MainWindowHandle
    left    = [int]$rect.Left
    top     = [int]$rect.Top
    width   = [int]($rect.Right - $rect.Left)
    height  = [int]($rect.Bottom - $rect.Top)
  }
}

function Get-AppWindow {
  param([string]$ProcessName, [string]$TitlePattern)
  $procs = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  if ($TitlePattern) { $procs = @($procs | Where-Object { $_.MainWindowTitle -match $TitlePattern }) }
  $p = $procs | Select-Object -First 1
  if (-not $p) { return $null }
  return (New-AppWindowObject $p)
}

function Get-AppWindowByPath {
  param([string]$ExePath)
  if (-not $ExePath) { return $null }
  $target = ''
  try { $target = [System.IO.Path]::GetFullPath($ExePath).ToLower() } catch { return $null }
  foreach ($p in @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })) {
    try {
      $pth = [string]$p.Path
      if ($pth -and [System.IO.Path]::GetFullPath($pth).ToLower() -eq $target) {
        return (New-AppWindowObject $p)
      }
    } catch {}
  }
  return $null
}

function Focus-AppWindow {
  param($W)
  $h = [IntPtr]$W.handle
  if ([Win32Desktop]::IsIconic($h)) { [Win32Desktop]::ShowWindow($h, 9) | Out-Null }
  [Win32Desktop]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0003 -bor 0x0040) | Out-Null
  [Win32Desktop]::SetForegroundWindow($h) | Out-Null
  [Win32Desktop]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x0003) | Out-Null
  Start-Sleep -Milliseconds 250
  if ([Win32Desktop]::GetForegroundWindow() -ne $h) {
    try { (New-Object -ComObject WScript.Shell).AppActivate([int]$W.pid) | Out-Null } catch {}
    Start-Sleep -Milliseconds 300
  }
  if ([Win32Desktop]::GetForegroundWindow() -ne $h) {
    # 模拟一次 Alt 键，解除 Windows 前台锁
    [Win32Desktop]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [Win32Desktop]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [Win32Desktop]::SetForegroundWindow($h) | Out-Null
    Start-Sleep -Milliseconds 300
  }
  return ([Win32Desktop]::GetForegroundWindow() -eq $h)
}

try {
  $cfg = Get-Content -LiteralPath $ArgsFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $action = [string]$cfg.action

  if ($action -eq 'list') {
    $items = @()
    foreach ($p in @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })) {
      $exe = ''
      try { $exe = [string]$p.Path } catch {}
      $items += [pscustomobject]@{
        pid = [int]$p.Id; process = [string]$p.ProcessName;
        title = [string]$p.MainWindowTitle; exe = $exe
      }
    }
    Out-Json ([pscustomobject]@{ ok = $true; items = $items })
    exit 0
  }

  if ($action -eq 'launch') {
    $exe = [string]$cfg.exe
    if (-not (Test-Path -LiteralPath $exe)) {
      Out-Json ([pscustomobject]@{ ok = $false; error = "exe 不存在：$exe" })
      exit 0
    }
    $workDir = Split-Path -Parent $exe
    $proc = $null
    try {
      $proc = Start-Process -FilePath $exe -WorkingDirectory $workDir -PassThru -ErrorAction Stop
    } catch {
      Out-Json ([pscustomobject]@{ ok = $false; error = ('启动失败：' + $_.Exception.Message) })
      exit 0
    }
    $w = $null
    $exitCode = $null
    for ($i = 0; $i -lt 120; $i++) {
      Start-Sleep -Milliseconds 500
      $w = Get-AppWindow ([string]$cfg.process) ([string]$cfg.titlePattern)
      if (-not $w) { $w = Get-AppWindowByPath $exe }
      if ($w) { break }
      if ($proc.HasExited) {
        if ($null -eq $exitCode) { $exitCode = $proc.ExitCode }
        # 给启动器拉起子进程留 10 秒，之后不再傻等
        if ($i -ge 20) { break }
      }
    }
    if (-not $w) {
      # Electron/商店应用直接启动可能被启动 token 限制秒退；让 Explorer 以用户 shell 身份拉起
      try {
        Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('"' + $exe + '"') -ErrorAction SilentlyContinue
      } catch {}
      for ($j = 0; $j -lt 60; $j++) {
        Start-Sleep -Milliseconds 500
        $w = Get-AppWindow ([string]$cfg.process) ([string]$cfg.titlePattern)
        if (-not $w) { $w = Get-AppWindowByPath $exe }
        if ($w) { break }
      }
    }
    if (-not $w) {
      if ($null -ne $exitCode) {
        $msg = "程序启动后立即退出（exit $exitCode），且 Explorer 启动也没找到窗口；可能安装不完整或被安全软件拦截"
      } else {
        $msg = '启动超时：直接启动和 Explorer 启动都没有找到窗口'
      }
      Out-Json ([pscustomobject]@{ ok = $false; error = $msg; exe = $exe; exitCode = $exitCode })
      exit 0
    }
    Out-Json ([pscustomobject]@{ ok = $true; window = $w })
    exit 0
  }

  if ($action -eq 'screen') {
    Add-Type -AssemblyName System.Windows.Forms
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
    $out = [string]$cfg.out
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $jpg = [System.IO.Path]::ChangeExtension($out, '.jpg')
    try { Save-Jpeg $bmp $jpg } catch { $jpg = '' }
    $g.Dispose(); $bmp.Dispose()
    Out-Json ([pscustomobject]@{ ok = $true; width = $vs.Width; height = $vs.Height; path = $out; jpg = $jpg })
    exit 0
  }

  if ($action -eq 'pick-folder') {
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = '选择允许小鲸鱼读写的文件夹'
    $dlg.ShowNewFolderButton = $true
    $res = $dlg.ShowDialog()
    if ($res -ne [System.Windows.Forms.DialogResult]::OK) {
      Out-Json ([pscustomobject]@{ ok = $false; canceled = $true })
      exit 0
    }
    Out-Json ([pscustomobject]@{ ok = $true; path = $dlg.SelectedPath })
    exit 0
  }

  if ($action -eq 'inspect') {
    $p = [string]$cfg.exe
    if (-not (Test-Path -LiteralPath $p)) { Out-Json @{ ok = $false; error = 'exe 不存在' }; exit 0 }
    $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($p)
    $nm = [System.IO.Path]::GetFileNameWithoutExtension($p)
    if ($vi.ProductName) { $nm = [string]$vi.ProductName }
    elseif ($vi.FileDescription) { $nm = [string]$vi.FileDescription }
    Out-Json ([pscustomobject]@{
      ok = $true; exe = $p; name = $nm;
      process = [System.IO.Path]::GetFileNameWithoutExtension($p);
      version = [string]$vi.FileVersion
    })
    exit 0
  }

  if ($action -eq 'pick-exe') {
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = '选择要授权的软件'
    $dlg.Filter = '可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*'
    $dlg.CheckFileExists = $true
    $dlg.Multiselect = $false
    $dlg.RestoreDirectory = $true
    $res = $dlg.ShowDialog()
    if ($res -ne [System.Windows.Forms.DialogResult]::OK) {
      Out-Json ([pscustomobject]@{ ok = $false; canceled = $true })
      exit 0
    }
    $p = [string]$dlg.FileName
    $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($p)
    $nm = [System.IO.Path]::GetFileNameWithoutExtension($p)
    if ($vi.ProductName) { $nm = [string]$vi.ProductName }
    elseif ($vi.FileDescription) { $nm = [string]$vi.FileDescription }
    Out-Json ([pscustomobject]@{
      ok = $true; exe = $p; name = $nm;
      process = [System.IO.Path]::GetFileNameWithoutExtension($p);
      version = [string]$vi.FileVersion
    })
    exit 0
  }

  if ($action -eq 'installed') {
    $shell = New-Object -ComObject WScript.Shell
    $seen = @{}
    $items = @()
    $dirs = @(
      (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
      (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
    )
    foreach ($d in $dirs) {
      if (-not (Test-Path -LiteralPath $d)) { continue }
      foreach ($lnk in @(Get-ChildItem -LiteralPath $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue)) {
        try {
          $sc = $shell.CreateShortcut($lnk.FullName)
          $target = [string]$sc.TargetPath
          if (-not $target -or -not ($target -match '\.exe$')) { continue }
          if (-not (Test-Path -LiteralPath $target)) { continue }
          $low = ($lnk.BaseName + ' ' + $target).ToLower()
          if ($low -match 'unins|uninstall|setup|update|updater|helper|crash|readme|help') { continue }
          $key = $target.ToLower()
          if ($seen.ContainsKey($key)) { continue }
          $seen[$key] = $true
          $items += [pscustomobject]@{
            name = [string]$lnk.BaseName
            exe = $target
            process = [System.IO.Path]::GetFileNameWithoutExtension($target)
            source = '开始菜单'
          }
        } catch {}
      }
    }
    # 常见安装路径兜底（Office / WPS / 抖音）
    $patterns = @(
      'C:\Program Files\Microsoft Office\root\Office*\EXCEL.EXE',
      'C:\Program Files (x86)\Microsoft Office\root\Office*\EXCEL.EXE',
      'C:\Program Files\WPS Office\*\office6\wps.exe',
      'C:\Program Files (x86)\WPS Office\*\office6\wps.exe',
      (Join-Path $env:LOCALAPPDATA 'Douyin\*\douyin.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Douyin\*\douyin.exe')
    )
    foreach ($pat in $patterns) {
      foreach ($f in @(Get-ChildItem -Path $pat -ErrorAction SilentlyContinue)) {
        $target = [string]$f.FullName
        if (-not $target) { continue }
        $key = $target.ToLower()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $nm = [System.IO.Path]::GetFileNameWithoutExtension($target)
        try {
          $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($target)
          if ($vi.ProductName) { $nm = [string]$vi.ProductName }
        } catch {}
        $items += [pscustomobject]@{
          name = $nm
          exe = $target
          process = [System.IO.Path]::GetFileNameWithoutExtension($target)
          source = '常见路径'
        }
      }
    }
    $items = @($items | Sort-Object name)
    Out-Json ([pscustomobject]@{ ok = $true; items = $items })
    exit 0
  }

  $w = Get-AppWindow ([string]$cfg.process) ([string]$cfg.titlePattern)
  if (-not $w) {
    Out-Json ([pscustomobject]@{ ok = $false; error = '没有找到授权窗口，请先启动应用' })
    exit 0
  }

  switch ($action) {
    'windows' {
      $procs = @(Get-Process -Name ([string]$cfg.process) -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
      if ($cfg.titlePattern) { $procs = @($procs | Where-Object { $_.MainWindowTitle -match ([string]$cfg.titlePattern) }) }
      $list = @()
      foreach ($p in $procs) {
        $list += [pscustomobject]@{ pid = [int]$p.Id; title = [string]$p.MainWindowTitle }
      }
      Out-Json ([pscustomobject]@{ ok = $true; windows = $list })
    }
    'focus' {
      $focused = Focus-AppWindow $w
      Out-Json ([pscustomobject]@{ ok = $true; focused = $focused; window = $w })
    }
    'snapshot' {
      if ([Win32Desktop]::IsIconic([IntPtr]$w.handle)) {
        [Win32Desktop]::ShowWindow([IntPtr]$w.handle, 9) | Out-Null
        Start-Sleep -Milliseconds 400
        $w = Get-AppWindow ([string]$cfg.process) ([string]$cfg.titlePattern)
        if (-not $w) { Out-Json ([pscustomobject]@{ ok = $false; error = '窗口丢失' }); exit 0 }
      }
      $bmp = New-Object System.Drawing.Bitmap($w.width, $w.height)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $hdc = $g.GetHdc()
      $okPrint = $false
      try { $okPrint = [Win32Desktop]::PrintWindow([IntPtr]$w.handle, $hdc, 2) } catch { $okPrint = $false }
      $g.ReleaseHdc($hdc)
      $focused = $false
      if (-not $okPrint) {
        $focused = Focus-AppWindow $w
        Start-Sleep -Milliseconds 250
        $g.CopyFromScreen($w.left, $w.top, 0, 0, $bmp.Size)
      }
      $out = [string]$cfg.out
      $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
      $jpg = [System.IO.Path]::ChangeExtension($out, '.jpg')
      try { Save-Jpeg $bmp $jpg } catch { $jpg = '' }
      $g.Dispose(); $bmp.Dispose()
      Out-Json ([pscustomobject]@{ ok = $true; focused = $focused; printWindow = $okPrint; window = $w; path = $out; jpg = $jpg })
    }
    'click' {
      $x = [int]$cfg.x; $y = [int]$cfg.y
      if ($x -lt 0 -or $y -lt 0 -or $x -ge $w.width -or $y -ge $w.height) {
        Out-Json ([pscustomobject]@{ ok = $false; error = "坐标超出窗口: ${x},${y} / $($w.width)x$($w.height)" })
        exit 0
      }
      $focused = Focus-AppWindow $w
      [Win32Desktop]::SetCursorPos(($w.left + $x), ($w.top + $y)) | Out-Null
      Start-Sleep -Milliseconds 120
      [Win32Desktop]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      [Win32Desktop]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      if ($cfg.double) {
        Start-Sleep -Milliseconds 100
        [Win32Desktop]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [Win32Desktop]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      }
      Out-Json ([pscustomobject]@{ ok = $true; focused = $focused; window = $w })
    }
    'type' {
      $focused = Focus-AppWindow $w
      if (-not $focused) { Out-Json ([pscustomobject]@{ ok = $false; error = '窗口没能切到前台' }); exit 0 }
      $prev = ''
      try { $prev = [string](Get-Clipboard) } catch {}
      Set-Clipboard -Value ([string]$cfg.text)
      Start-Sleep -Milliseconds 150
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      Start-Sleep -Milliseconds 500
      try { if ($prev) { Set-Clipboard -Value $prev } } catch {}
      Out-Json ([pscustomobject]@{ ok = $true; focused = $focused; window = $w; chars = ([string]$cfg.text).Length })
    }
    'key' {
      $focused = Focus-AppWindow $w
      if (-not $focused) { Out-Json ([pscustomobject]@{ ok = $false; error = '窗口没能切到前台' }); exit 0 }
      [System.Windows.Forms.SendKeys]::SendWait([string]$cfg.keys)
      Start-Sleep -Milliseconds 250
      Out-Json ([pscustomobject]@{ ok = $true; focused = $focused; window = $w })
    }
    'scroll' {
      $focused = Focus-AppWindow $w
      if (-not $focused) { Out-Json ([pscustomobject]@{ ok = $false; error = '窗口没能切到前台' }); exit 0 }
      [Win32Desktop]::SetCursorPos(($w.left + [int]($w.width / 2)), ($w.top + [int]($w.height / 2))) | Out-Null
      Start-Sleep -Milliseconds 100
      [Win32Desktop]::mouse_event(0x0800, 0, 0, [int]$cfg.delta, [UIntPtr]::Zero)
      Out-Json ([pscustomobject]@{ ok = $true; focused = $focused; window = $w })
    }
    default {
      Out-Json ([pscustomobject]@{ ok = $false; error = '未知动作: ' + $action })
    }
  }
} catch {
  Out-Json ([pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message })
}