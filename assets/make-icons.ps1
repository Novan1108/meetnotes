Add-Type -AssemblyName System.Drawing

$dir = "C:\Users\Asus Tuf A16\Desktop\meetnotes"

foreach ($s in 16, 32, 48, 128) {
  $bitmap = New-Object System.Drawing.Bitmap($s, $s)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $radius = $s * 0.23
  $dia = 2 * $radius
  $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shape.AddArc(0, 0, $dia, $dia, 180, 90)
  $shape.AddArc($s - $dia, 0, $dia, $dia, 270, 90)
  $shape.AddArc($s - $dia, $s - $dia, $dia, $dia, 0, 90)
  $shape.AddArc(0, $s - $dia, $dia, $dia, 90, 90)
  $shape.CloseFigure()

  $bgRect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
  $c1 = [System.Drawing.Color]::FromArgb(255, 0x63, 0x66, 0xF1)
  $c2 = [System.Drawing.Color]::FromArgb(255, 0x8B, 0x5C, 0xF6)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, $c1, $c2, 45.0)
  $graphics.FillPath($grad, $shape)

  $fractions = @(0.22, 0.42, 0.66, 0.42, 0.22)
  $barW = $s * 0.085
  $gap = $s * 0.055
  $totalW = 5 * $barW + 4 * $gap
  $barX = ($s - $totalW) / 2

  for ($i = 0; $i -lt 5; $i++) {
    $h = $s * $fractions[$i]
    if ($i % 2 -eq 1) { $y = $s * 0.08 } else { $y = $s * 0.08 + $s * ($fractions[2] - $fractions[$i]) / 2 }
    $y = ($s * 0.84 - $h) / 2
    $cap = $barW / 2
    $graphics.FillEllipse([System.Drawing.Brushes]::White, $barX, $y, $barW, $barW)
    $graphics.FillEllipse([System.Drawing.Brushes]::White, $barX, $y + $h - $barW, $barW, $barW)
    $bodyRect = New-Object System.Drawing.RectangleF($barX, ($y + $cap), $barW, ($h - $barW))
    $graphics.FillRectangle([System.Drawing.Brushes]::White, $bodyRect)
    $barX += $barW + $gap
  }

  $dotR = $s * 0.028
  $graphics.FillEllipse([System.Drawing.Brushes]::White, $s / 2 - $dotR, $s * 0.845, 2 * $dotR, 2 * $dotR)

  $graphics.Flush()
  $graphics.Dispose()
  $bitmap.Save("$dir\icon$s.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

Get-ChildItem "$dir\icon*.png" | Select-Object Name, Length
