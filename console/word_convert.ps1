param(
  [Parameter(Mandatory = $true)][string]$Action,
  [Parameter(Mandatory = $true)][string]$InPath,
  [Parameter(Mandatory = $true)][string]$OutPath
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ErrorActionPreference = 'Stop'
$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0

  if ($Action -eq 'docx2pdf') {
    $doc = $word.Documents.Open($InPath, $false, $false)
    $doc.SaveAs2($OutPath, 17)
    $doc.Close(0)
  } else {
    throw 'unknown action'
  }

  [pscustomobject]@{ ok = $true; out = $OutPath } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message } | ConvertTo-Json -Compress
} finally {
  if ($word) { try { $word.Quit() } catch {} }
}