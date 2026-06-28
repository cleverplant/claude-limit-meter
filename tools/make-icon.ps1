Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $root 'icon.png'

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded orange background (Claude-Code-ish clay tone)
$radius = 44
$rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $radius*2, $radius*2, 180, 90)
$path.AddArc($rect.Right - $radius*2, $rect.Y, $radius*2, $radius*2, 270, 90)
$path.AddArc($rect.Right - $radius*2, $rect.Bottom - $radius*2, $radius*2, $radius*2, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $radius*2, $radius*2, $radius*2, 90, 90)
$path.CloseAllFigures()

$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#CC785C'))
$g.FillPath($bgBrush, $path)
$bgBrush.Dispose()

# 4-point white sparkle (Claude-like spark, drawn from scratch)
$cx = [float]($size / 2)
$cy = [float]($size * 0.22)
$rOut = 44.0
$rIn  = 11.0

$pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
for ($i = 0; $i -lt 8; $i++) {
    $ang = ($i * 45.0 - 90.0) * [Math]::PI / 180.0
    $r = if ($i % 2 -eq 0) { $rOut } else { $rIn }
    $x = [float]($cx + $r * [Math]::Cos($ang))
    $y = [float]($cy + $r * [Math]::Sin($ang))
    $pts.Add((New-Object System.Drawing.PointF $x, $y))
}

$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$g.FillPolygon($whiteBrush, $pts.ToArray())

# "limit" and "meter" text, stacked
$font = New-Object System.Drawing.Font 'Segoe UI', 56.0, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

$rw = [float]$size
$rh = [float]($size * 0.26)

# "limit" centered around y = 0.55
$ry1 = [float]($size * 0.42)
$rect1 = New-Object System.Drawing.RectangleF ([float]0.0), $ry1, $rw, $rh
$g.DrawString('limit', $font, $whiteBrush, $rect1, $sf)

# "meter" centered around y = 0.80
$ry2 = [float]($size * 0.67)
$rect2 = New-Object System.Drawing.RectangleF ([float]0.0), $ry2, $rw, $rh
$g.DrawString('meter', $font, $whiteBrush, $rect2, $sf)

$whiteBrush.Dispose()
$font.Dispose()
$g.Dispose()

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output ("ICON=" + $out)
Write-Output ("SIZE=" + ((Get-Item -LiteralPath $out).Length) + "B")
