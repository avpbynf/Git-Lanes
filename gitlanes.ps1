<#
.SYNOPSIS
    Open the commit graph of a repository in the browser.
.DESCRIPTION
    Starts the local backend and opens the page. The page polls the repository
    and redraws whenever a ref moves. A backend already listening on the port is
    reused as is, so calling this twice never starts a second one.
.EXAMPLE
    .\gitlanes.ps1
    .\gitlanes.ps1 -Repo C:\code\some-other-repository -Port 7421
#>
param(
    [string]$Repo = (Get-Location).Path,
    [int]$Port = 7420,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://127.0.0.1:$Port/"

function Test-Listening([int]$port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

if (Test-Listening $Port) {
    Write-Host "already serving on $url"
    if (-not $NoBrowser) { Start-Process $url }
    return
}

$Repo = (Resolve-Path $Repo).Path.TrimEnd('\')

# One += at a time: an @('-3') assigned through an if unrolls to a bare string,
# and the next + then concatenates instead of appending.
$exe = 'python'
$argv = @()
if (Get-Command py -ErrorAction SilentlyContinue) { $exe = 'py'; $argv += '-3' }
$argv += (Join-Path $here 'server\gitlanes.py')
$argv += '--repo'; $argv += $Repo
$argv += '--port'; $argv += "$Port"
$line = ($argv | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '

$log = Join-Path $env:TEMP "gitlanes-$Port.log"
Start-Process -FilePath $exe -ArgumentList $line -WindowStyle Hidden `
              -RedirectStandardError $log -RedirectStandardOutput "$log.out"

for ($i = 0; $i -lt 50; $i++) {
    if (Test-Listening $Port) { break }
    Start-Sleep -Milliseconds 100
}
if (-not (Test-Listening $Port)) {
    if (Test-Path $log) { Get-Content $log | Write-Host }
    throw "the backend did not come up on port $Port (see $log)"
}

Write-Host "$Repo -> $url"
if (-not $NoBrowser) { Start-Process $url }
