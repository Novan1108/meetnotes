Add-Type -AssemblyName System.Drawing

$repo = "C:\Users\Asus Tuf A16\Desktop\meetnotes"
$out = "$repo\docs\social-preview.png"

$w = 1280
$h = 640
$bitmap = New-Object System.Drawing.Bitmap($w, $h)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

$bgRect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$c1 = [System.Drawing.Color]::FromArgb(255, 0xF7, 0xF7, 0xFB)
$c2 = [System.Drawing.Color]::FromArgb(255, 0xEC, 0xEA, 0xFC)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, $c1, $c2, 90.0)
$graphics.FillRectangle($grad, $bgRect)

$icon = [System.Drawing.Image]::FromFile("$repo\icons\icon128.png")
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$iconSize = 320
$iconY = ($h - $iconSize) / 2
$graphics.DrawImage($icon, 140, $iconY, $iconSize, $iconSize)
$icon.Dispose()

$titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0x19, 0x19, 0x27))
$mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0x6B, 0x72, 0x80))
$accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0x63, 0x66, 0xF1))

$titleFont = New-Object System.Drawing.Font("Segoe UI", 96, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$tagFont = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

$graphics.DrawString("NoteAssist", $titleFont, $titleBrush, 520, 200)
$graphics.DrawString("Google Meet calls in, takeaways out.", $tagFont, $mutedBrush, 524, 330)
$graphics.DrawString("Every note linked to the words that back it.", $tagFont, $accentBrush, 524, 386)

$barRect = New-Object System.Drawing.Rectangle(524, 460, 420, 8)
$barGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($barRect, [System.Drawing.Color]::FromArgb(255, 0x63, 0x66, 0xF1), [System.Drawing.Color]::FromArgb(255, 0x8B, 0x5C, 0xF6), 0.0)
$graphics.FillRectangle($barGrad, $barRect)

$graphics.Flush()
$graphics.Dispose()
$bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
"banner saved: $out"
