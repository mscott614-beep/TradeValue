# TradeValue - Scheduled Tasks Registration Script (Windows PowerShell)
# Registers the 7 TradeValue local automation tasks in Windows Task Scheduler.

$ErrorActionPreference = "Stop"

# Define literal ampersand wrapped in double quotes
$Amp = "&"

Write-Host "======================================================================"
Write-Host "         TradeValue: Windows Task Scheduler Registration"
Write-Host "======================================================================"

# Check for Administrator privileges
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
$IsAdmin = $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin) {
    Write-Warning "This script should be run as Administrator to register scheduled tasks."
    Write-Warning "Please restart PowerShell as Administrator and run this script again."
}

# 1. Resolve paths
$BaseDir = $PSScriptRoot
if ($null -eq $BaseDir -or $BaseDir -eq "") {
    $BaseDir = Get-Location
}
$BaseDir = $BaseDir.ToString()

Write-Host "Workspace Root Directory: $BaseDir"

$PythonPath = Join-Path $BaseDir ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonPath)) {
    Write-Error "CRITICAL: Python virtual environment executable not found at '$PythonPath'."
    Write-Error "Please run setup_k12.ps1 first to create the virtual environment."
} else {
    Write-Host "Python virtual environment detected: $PythonPath"
}

$NodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if ($null -eq $NodeCmd) {
    Write-Warning "node.exe was not found in PATH. Defaulting to 'node' in scheduled tasks, but you may need to specify its absolute path."
    $NodePath = "node"
} else {
    $NodePath = $NodeCmd.Source
    Write-Host "Node.js executable detected: $NodePath"
}

# 2. Define Helper Function to Register a Task
function Register-TradeValueTask {
    param (
        [string]$TaskName,
        [string]$Executable,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [Microsoft.Management.Infrastructure.CimInstance[]]$Triggers
    )

    Write-Host ""
    Write-Host "Configuring task: $TaskName..."

    try {
        # Create Task Action
        $Action = New-ScheduledTaskAction -Execute $Executable -Argument $Arguments -WorkingDirectory $WorkingDirectory

        # Create Task Settings (Allow running on battery, start when available if missed)
        $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

        # Register/Overwrite the task
        Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Settings $Settings -Force

        Write-Host "SUCCESS: Task '$TaskName' registered and enabled."
    } catch {
        Write-Error "Failed to register task '$TaskName': $_"
    }
}

# 3. Define Triggers and Register Tasks

# --- Task 1: TradeValue Arbitrage Scanner ---
# Triggers: 8:30 AM Daily
$Trigger1 = New-ScheduledTaskTrigger -Daily -At "8:30 AM"
Register-TradeValueTask -TaskName "TradeValue Arbitrage Scanner" `
                        -Executable $NodePath `
                        -Arguments "hermesArbitrage.js" `
                        -WorkingDirectory $BaseDir `
                        -Triggers $Trigger1

# --- Task 2: TradeValue Daily Asset Generation ---
# Triggers: 6:45 AM every Monday
$Trigger2 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "6:45 AM"
Register-TradeValueTask -TaskName "TradeValue Daily Asset Generation" `
                        -Executable $NodePath `
                        -Arguments "hermesInsights.js" `
                        -WorkingDirectory $BaseDir `
                        -Triggers $Trigger2

# --- Task 3: TradeValue Daily eBay Sync ---
# Triggers: 8:00 AM Daily
# Note: Defaults to ebay_sheets_sync.py (headless via agent). If you want headed Playwright, change to ebay_saved_searches_sync.py
$Trigger3 = New-ScheduledTaskTrigger -Daily -At "8:00 AM"
Register-TradeValueTask -TaskName "TradeValue Daily eBay Sync" `
                        -Executable $PythonPath `
                        -Arguments "ebay_sheets_sync.py" `
                        -WorkingDirectory $BaseDir `
                        -Triggers $Trigger3

# --- Task 4: TradeValue Global Cleanup Task ---
# Triggers: 6:15 AM Daily
$Trigger4 = New-ScheduledTaskTrigger -Daily -At "6:15 AM"
Register-TradeValueTask -TaskName "TradeValue Global Cleanup Task" `
                        -Executable $PythonPath `
                        -Arguments "scripts/cleanup_placeholders.py --execute" `
                        -WorkingDirectory $BaseDir `
                        -Triggers $Trigger4

# --- Task 5: TradeValue Midnight Snapshot ---
# Triggers: 12:00 AM (Midnight) Daily
$Trigger5 = New-ScheduledTaskTrigger -Daily -At "12:00 AM"
Register-TradeValueTask -TaskName "TradeValue Midnight Snapshot" `
                        -Executable $NodePath `
                        -Arguments "hermesSnapshot.js" `
                        -WorkingDirectory $BaseDir `
                        -Triggers $Trigger5

# --- Task 6: TradeValue Weekly Scraper ---
# Triggers: 6:00 AM every Monday
$Trigger6 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "6:00 AM"
Register-TradeValueTask -TaskName "TradeValue Weekly Scraper" `
                        -Executable $NodePath `
                        -Arguments "hermesGlobal.js" `
                        -WorkingDirectory $BaseDir `
                        -Triggers $Trigger6

# --- Task 7: TradeValue Daily Market Refresh ---
# Triggers: 7:30 AM Daily
$Trigger7 = New-ScheduledTaskTrigger -Daily -At "7:30 AM"
Register-TradeValueTask -TaskName "TradeValue Daily Market Refresh" `
                        -Executable $NodePath `
                        -Arguments "hermesRefresh.js" `
                        -WorkingDirectory $BaseDir `
                        -Triggers $Trigger7

Write-Host ""
Write-Host "======================================================================"
Write-Host "             All 7 Scheduled Tasks Registered Successfully!"
Write-Host "======================================================================"
Write-Host "You can open 'Task Scheduler' (taskschd.msc) to view or test them."
Write-Host "======================================================================"

