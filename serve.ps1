# Local static server (no npm/Python): powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8000]
# Keep this file ASCII-only: Windows PowerShell 5.1 reads UTF-8 without BOM as ANSI and can garble lines.
param([int]$Port = 8000)

# Trailing "\" so sibling folders (e.g. day4-cafe2) do not pass the prefix check
$root = $PSScriptRoot.TrimEnd('\') + '\'
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'
  '.jpg' = 'image/jpeg'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    # Never serve dot folders/files such as .git or .claude
    $hidden = $file.Substring([Math]::Min($root.Length, $file.Length)) -split '[\\/]' | Where-Object { $_ -like '.*' }

    if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and -not $hidden -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $bytes.Length
      if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    } else {
      $res.StatusCode = 404
    }
    Write-Host "$($ctx.Request.HttpMethod) /$path $($res.StatusCode)"
  } catch {
    # e.g. the browser disconnected mid-response: keep the server loop alive
    try { $res.StatusCode = 500 } catch {}
  } finally {
    try { $res.Close() } catch {}
  }
}
