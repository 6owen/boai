# Build script for Windows NSIS installer
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent (Split-Path -Parent $ElectronDir)

Write-Host "=== Building BoAI Windows Installer using electron-builder ===" -ForegroundColor Cyan

# Debug: System information
Write-Host ""
Write-Host "=== Debug: System Information ===" -ForegroundColor Magenta
Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "Hostname: $env:COMPUTERNAME"
Write-Host "User: $env:USERNAME"
Write-Host "Temp: $env:TEMP"
Write-Host "Working Dir: $(Get-Location)"

# Debug: Check Windows Defender status
Write-Host ""
Write-Host "=== Debug: Windows Defender Status ===" -ForegroundColor Magenta
try {
    $defenderStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($defenderStatus) {
        Write-Host "Real-time Protection: $($defenderStatus.RealTimeProtectionEnabled)"
        Write-Host "Antivirus Enabled: $($defenderStatus.AntivirusEnabled)"
        Write-Host "On Access Protection: $($defenderStatus.OnAccessProtectionEnabled)"
        Write-Host "IO AV Protection: $($defenderStatus.IoavProtectionEnabled)"
    } else {
        Write-Host "Could not get Defender status"
    }
} catch {
    Write-Host "Defender status check failed: $_"
}

# Debug: List exclusions
Write-Host ""
Write-Host "=== Debug: Defender Exclusions ===" -ForegroundColor Magenta
try {
    $prefs = Get-MpPreference -ErrorAction SilentlyContinue
    if ($prefs.ExclusionPath) {
        Write-Host "Path Exclusions: $($prefs.ExclusionPath -join ', ')"
    }
    if ($prefs.ExclusionProcess) {
        Write-Host "Process Exclusions: $($prefs.ExclusionProcess -join ', ')"
    }
} catch {
    Write-Host "Could not get exclusions: $_"
}
Write-Host ""

# 0. Kill any lingering processes that might lock files
Write-Host "Killing any lingering node/npm processes..."
$processesToKill = @('node', 'npm', 'electron', 'electron-builder')
foreach ($procName in $processesToKill) {
    Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  Killing $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
# Give processes time to fully terminate
Start-Sleep -Seconds 2

# 1. Clean previous build artifacts (with retry for locked files)
Write-Host "Cleaning previous builds..."
$foldersToClean = @(
    "$ElectronDir\vendor",
    "$ElectronDir\node_modules\@anthropic-ai",
    "$ElectronDir\packages",
    "$ElectronDir\release"
)
foreach ($folder in $foldersToClean) {
    if (Test-Path $folder) {
        $retries = 3
        for ($i = 1; $i -le $retries; $i++) {
            try {
                Remove-Item -Recurse -Force $folder -ErrorAction Stop
                break
            } catch {
                if ($i -eq $retries) { throw }
                Write-Host "  Retrying cleanup of $folder (attempt $i)..." -ForegroundColor Yellow
                Start-Sleep -Seconds 2
            }
        }
    }
}

# 2. Install dependencies
if ($env:BOAI_SKIP_INSTALL -eq "1") {
    Write-Host "Reusing existing dependencies (BOAI_SKIP_INSTALL=1)..."
} else {
    Write-Host "Installing dependencies..."
    Push-Location $RootDir
    try {
        bun install --frozen-lockfile
    } finally {
        Pop-Location
    }
}

# 3. Copy ripgrep used by the search service.
$RgSource = "$RootDir\node_modules\@vscode\ripgrep"
if (-not (Test-Path $RgSource) -or -not (Test-Path "$RgSource\bin\rg.exe")) {
    Write-Host "ERROR: @vscode/ripgrep not installed or postinstall did not run" -ForegroundColor Red
    Write-Host "Run 'bun install' and 'bun pm trust @vscode/ripgrep'."
    exit 1
}
Write-Host "Copying @vscode/ripgrep..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\node_modules\@vscode" | Out-Null
Remove-Item -Recurse -Force "$ElectronDir\node_modules\@vscode\ripgrep" -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force $RgSource "$ElectronDir\node_modules\@vscode\"

# 5. Build Electron through the canonical cross-platform pipeline. This also
# builds the Node PI bundle, interceptor, workers and runtime resource allowlist.
Write-Host "Building Electron app..."
$env:BOAI_BUILD_PLATFORM = "win32"
$env:BOAI_BUILD_ARCH = "x64"
Push-Location $RootDir
try {
    bun run electron:build
    if ($LASTEXITCODE -ne 0) { throw "Electron build failed" }
} finally {
    Pop-Location
}

# 6. Package with electron-builder
Write-Host "Packaging app with electron-builder..."

# Debug: Check for processes that might have files open
Write-Host ""
Write-Host "=== Debug: Potentially Relevant Processes ===" -ForegroundColor Magenta
$relevantProcesses = Get-Process | Where-Object {
    $_.ProcessName -match 'node|npm|bun|electron|defender|antimalware|mpcmdrun'
} | Select-Object ProcessName, Id, CPU, WorkingSet64
if ($relevantProcesses) {
    $relevantProcesses | ForEach-Object {
        Write-Host "  $($_.ProcessName) (PID: $($_.Id)) - Memory: $([math]::Round($_.WorkingSet64 / 1MB, 1)) MB"
    }
} else {
    Write-Host "  No relevant processes found"
}
Write-Host ""

# Force garbage collection to release any managed file handles
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()

# Run electron-builder with retry logic for EBUSY errors
Push-Location $ElectronDir
$maxBuilderRetries = 3
$builderRetry = 0
$builderSuccess = $false

while (-not $builderSuccess -and $builderRetry -lt $maxBuilderRetries) {
    $builderRetry++
    Write-Host "  electron-builder attempt $builderRetry of $maxBuilderRetries..." -ForegroundColor Cyan

    # Clean release directory before each attempt to avoid stale files
    if (Test-Path "$ElectronDir\release") {
        Write-Host "  Cleaning release directory before attempt..."
        Remove-Item -Recurse -Force "$ElectronDir\release" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    npx electron-builder --win --x64 --publish never 2>&1 | Tee-Object -Variable builderOutput

    if ($LASTEXITCODE -eq 0) {
        $builderSuccess = $true
        Write-Host "  electron-builder succeeded on attempt $builderRetry" -ForegroundColor Green
    } else {
        Write-Host "  electron-builder failed with exit code $LASTEXITCODE" -ForegroundColor Yellow

        if ($builderRetry -lt $maxBuilderRetries) {
            Write-Host "  Waiting 10 seconds before retry..." -ForegroundColor Yellow

            # Kill any processes that might be holding file locks
            Get-Process -Name 'node', 'npm' -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "    Killing $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor Yellow
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }

            Start-Sleep -Seconds 10
        }
    }
}

Pop-Location

if (-not $builderSuccess) {
    throw "electron-builder failed after $maxBuilderRetries attempts"
}

# Validate and report the final unpacked application before publishing.
$UnpackedPath = "$ElectronDir\release\win-unpacked"
Push-Location $RootDir
try {
    bun scripts/validate-electron-artifact.ts $UnpackedPath
    if ($LASTEXITCODE -ne 0) { throw "Electron artifact validation failed" }
    bun scripts/electron-artifact-report.ts $UnpackedPath --json "$ElectronDir\release\artifact-report-win-x64.json"
    if ($LASTEXITCODE -ne 0) { throw "Electron artifact report failed" }
} finally {
    Pop-Location
}

# 7. Verify the installer was built
$InstallerPath = Get-ChildItem -Path "$ElectronDir\release" -Filter "*.exe" | Select-Object -First 1

if (-not $InstallerPath) {
    Write-Host "ERROR: Installer not found in $ElectronDir\release" -ForegroundColor Red
    Write-Host "Contents of release directory:"
    Get-ChildItem "$ElectronDir\release"
    exit 1
}

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Green
Write-Host "Installer: $($InstallerPath.FullName)"
Write-Host "Size: $([math]::Round($InstallerPath.Length / 1MB, 2)) MB"
