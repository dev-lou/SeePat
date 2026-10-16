# Generate the promo voiceover with the voice Windows already ships.
#
# No account, no API key, no network: System.Speech synthesizes straight to a WAV,
# which is the only free Tagalog-capable path that needs nothing from the user.
#
# The rate is found by measurement, not by arithmetic. SAPI's rate curve is not
# linear (a step of -4 is roughly three times slower, not 1.3x), so the script
# speaks the line at successive rates and keeps the SLOWEST rate that still fits
# inside the shot's window -- that is the most natural delivery that does not
# overrun into the next line.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-narration.ps1

param(
  [string]$Script = "docs/video/narration.json",
  [string]$OutDir = "docs/video/voice"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$data = Get-Content -Raw -Path $Script | ConvertFrom-Json
$voiceName = $data.voice
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$available = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if ($available -notcontains $voiceName) {
  Write-Warning "Voice '$voiceName' not installed; falling back to $($available[0])"
  $voiceName = $available[0]
}
$synth.SelectVoice($voiceName)
Write-Output "voice: $voiceName"

function Get-WavSeconds([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $ch = [BitConverter]::ToUInt16($bytes, 22)
  $sr = [BitConverter]::ToUInt32($bytes, 24)
  $bits = [BitConverter]::ToUInt16($bytes, 34)
  $dataLen = $bytes.Length - 44
  return $dataLen / ($sr * $ch * ($bits / 8.0))
}

# Slowest first: the first rate that fits is the most natural delivery that fits.
$rates = @(-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6)
$tmp = Join-Path $OutDir "_probe.wav"

foreach ($line in $data.lines) {
  $id = [int]$line.id
  $window = [double]$line.max
  $target = $window - 0.15  # leave a beat between lines
  $chosen = $null
  $chosenLen = 0.0

  foreach ($r in $rates) {
    $synth.Rate = $r
    $synth.SetOutputToWaveFile($tmp)
    $synth.Speak($line.text)
    $synth.SetOutputToNull()
    $len = Get-WavSeconds $tmp
    if ($len -le $target) { $chosen = $r; $chosenLen = $len; break }
  }

  if ($null -eq $chosen) {
    # Even the fastest rate is too slow: take it and let the timeline absorb it.
    $chosen = $rates[-1]
    $chosenLen = $len
    Write-Warning ("line-{0:D2} cannot fit {1}s at the fastest rate ({2}s)" -f $id, $window, $chosenLen)
  }

  $synth.Rate = $chosen
  $path = Join-Path $OutDir ("line-{0:D2}.wav" -f $id)
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($line.text)
  $synth.SetOutputToNull()

  Write-Output ("line-{0:D2}  rate {1,3}  start {2,5}s  fits {3,5}s of {4,5}s" -f $id, $chosen, $line.start, $chosenLen, $window)
}

Remove-Item $tmp -ErrorAction SilentlyContinue
$synth.Dispose()
Write-Output "done"
