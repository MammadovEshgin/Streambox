param(
  [string]$SourceDir = "assets/images/personas",
  [int]$MaxWidth = 1080,
  [int]$Quality = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Get-JpegEncoder {
  return [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq "image/jpeg" } |
    Select-Object -First 1
}

function Save-Jpeg([System.Drawing.Image]$Image, [string]$Path, [int]$EncoderQuality) {
  $encoder = Get-JpegEncoder
  if (-not $encoder) {
    throw "JPEG encoder not found."
  }

  $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality,
    [long]$EncoderQuality
  )

  $Image.Save($Path, $encoder, $encoderParams)
  $encoderParams.Dispose()
}

function Resize-Image([string]$InputPath, [string]$OutputPath, [int]$TargetWidth, [int]$EncoderQuality) {
  $source = [System.Drawing.Image]::FromFile($InputPath)
  try {
    $scale = [Math]::Min(1.0, $TargetWidth / [double]$source.Width)
    $width = [int][Math]::Round($source.Width * $scale)
    $height = [int][Math]::Round($source.Height * $scale)

    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    try {
      $bitmap.SetResolution($source.HorizontalResolution, $source.VerticalResolution)

      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, 0, 0, $width, $height)
      }
      finally {
        $graphics.Dispose()
      }

      Save-Jpeg -Image $bitmap -Path $OutputPath -EncoderQuality $EncoderQuality
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $source.Dispose()
  }
}

$files = Get-ChildItem -Path $SourceDir -Filter *.png -File -Recurse
if (-not $files) {
  Write-Host "No PNG persona assets found in $SourceDir"
  exit 0
}

foreach ($file in $files) {
  $outputPath = [System.IO.Path]::ChangeExtension($file.FullName, ".jpg")
  Resize-Image -InputPath $file.FullName -OutputPath $outputPath -TargetWidth $MaxWidth -EncoderQuality $Quality
  Write-Host "Optimized $($file.Name) -> $([System.IO.Path]::GetFileName($outputPath))"
}
