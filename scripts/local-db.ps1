param([ValidateSet('start','stop','status')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
$mutex = $null
$locked = $false
try {
    # Read only this ignored file; inherited shell DB_* values must not override it.
    $dbConfig = node -e "const fs=require('node:fs');const e=require('dotenv').parse(fs.readFileSync('backend/.env'));console.log(JSON.stringify({host:e.DB_HOST,port:e.DB_PORT,name:e.DB_NAME}))" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $dbConfig.host -ne '127.0.0.1' -or $dbConfig.name -ne 'select_topic_2_local') { throw 'Expected select_topic_2_local on 127.0.0.1 in backend/.env' }
    $dbPort = 0
    if (-not [int]::TryParse($dbConfig.port, [ref]$dbPort) -or $dbPort -lt 1 -or $dbPort -gt 65535) { throw 'Invalid DB_PORT in backend/.env' }
    $localRoot = Join-Path $env:LOCALAPPDATA 'select-topic-2'
    $pgBin = Join-Path $localRoot 'postgresql-16.15-tar\pgsql\bin'
    $pgCtl = Join-Path $pgBin 'pg_ctl.exe'
    $pgData = Join-Path $localRoot 'pgdata-v3'
    $pgLog = Join-Path $localRoot 'postgresql-v3.log'
    if (-not (Test-Path -LiteralPath $pgCtl) -or -not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) { throw 'Existing portable binary/data directory missing; refusing to initialize anything' }
    if ((Get-Content -LiteralPath (Join-Path $pgData 'PG_VERSION') -Raw).Trim() -ne '16') { throw 'Data directory version does not match PostgreSQL 16' }
    $mutex = New-Object System.Threading.Mutex($false, 'Local\SelectTopic2PortablePostgres')
    try { $locked = $mutex.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another database management operation is running' }

    function Get-DbPid {
        $pidFile = Join-Path $pgData 'postmaster.pid'
        if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
        $pidText = Get-Content -LiteralPath $pidFile -TotalCount 1
        $dbProcess = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
        if (-not $dbProcess) { return $null }
        if ($dbProcess.Path -ne (Join-Path $pgBin 'postgres.exe')) { throw 'PID file points to another executable; refusing to touch it' }
        $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($dbProcess.Id)").CommandLine
        if (-not $commandLine -or -not $commandLine.Replace('\','/').Contains($pgData.Replace('\','/'))) { throw 'PID does not belong to the expected data directory; refusing to touch it' }
        return $dbProcess.Id
    }
    function Assert-DbHealth {
        $dbPid = Get-DbPid
        if (-not $dbPid) { throw 'PostgreSQL is stopped' }
        $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $dbPid -ErrorAction SilentlyContinue)
        if (-not $listeners.Count -or @($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' -or $_.LocalPort -ne $dbPort }).Count) { throw 'PostgreSQL listener differs from the expected loopback/port; refusing to reconfigure a running cluster' }
        & (Join-Path $pgBin 'pg_isready.exe') -h $dbConfig.host -p $dbPort -d $dbConfig.name -t 5
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL readiness failed' }
        Write-Output "PostgreSQL ready: $($dbConfig.host):$dbPort / $($dbConfig.name); PID $dbPid"
    }

    $existingPid = Get-DbPid
    if ($Action -eq 'start') {
        if (-not $existingPid) {
            if (Get-NetTCPConnection -State Listen -LocalPort $dbPort -ErrorAction SilentlyContinue) { throw "Port $dbPort is occupied by another process; refusing to stop it" }
            $stdout = Join-Path $localRoot 'pg-ctl-last-start.log'
            $stderr = Join-Path $localRoot 'pg-ctl-last-start-error.log'
            $pgArgs = @('start','-D',('"{0}"' -f $pgData),'-l',('"{0}"' -f $pgLog),'-o',('"-h 127.0.0.1 -p {0}"' -f $dbPort),'-w','-t','30')
            # Hidden standalone Windows process; wait for pg_ctl itself, not its server descendants.
            $starter = Start-Process -FilePath $pgCtl -ArgumentList $pgArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
            $null = $starter.Handle # Cache the native handle before pg_ctl exits (Windows PowerShell).
            if (-not $starter.WaitForExit(40000)) { throw 'pg_ctl startup wait timed out; inspect the local log before retrying' }
            $starter.Refresh()
            if ($starter.ExitCode -ne 0) { throw "pg_ctl failed ($($starter.ExitCode)); inspect $stderr and $pgLog" }
        }
        Assert-DbHealth
    } elseif ($Action -eq 'stop') {
        if ($existingPid) {
            Assert-DbHealth
            & $pgCtl stop -D $pgData -m fast -w -t 30
            if ($LASTEXITCODE -ne 0) { throw 'Graceful PostgreSQL stop failed; no forced process termination attempted' }
        } else { Write-Output 'PostgreSQL already stopped; data preserved' }
    } else {
        Assert-DbHealth
        & $pgCtl status -D $pgData
    }
    [pscustomobject]@{ timestamp = [DateTime]::UtcNow.ToString('o'); action = $Action; host = $dbConfig.host; port = $dbPort; process = (Get-DbPid) } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $localRoot 'db-management.jsonl')
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
    Pop-Location
}
