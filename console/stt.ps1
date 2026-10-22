param(
  [Parameter(Mandatory = $true)][string]$Wav,
  [Parameter(Mandatory = $true)][string]$OutJson
)

$ErrorActionPreference = 'Stop'
$items = @()
$warning = ''
try {
  Add-Type -AssemblyName System.Speech
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine([System.Globalization.CultureInfo]::GetCultureInfo('zh-CN'))
  $rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $rec.SetInputToWaveFile($Wav)
  try {
    for ($i = 0; $i -lt 20; $i++) {
      $r = $rec.Recognize()
      if (-not $r) { break }
      if ($r.Text) {
        $items += [pscustomobject]@{ text = [string]$r.Text; confidence = [math]::Round([double]$r.Confidence, 2) }
      }
    }
  } catch {
    $warning = [string]$_.Exception.Message
  }
  $rec.Dispose()
  $obj = [pscustomobject]@{ ok = $true; items = $items; warning = $warning }
} catch {
  $obj = [pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message; items = @() }
}
$json = $obj | ConvertTo-Json -Compress -Depth 5
[System.IO.File]::WriteAllText($OutJson, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output '{"ok":true}'