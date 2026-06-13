# TradeValue — K12 Migration & Setup Script (Windows PowerShell)
# Automates Virtual Environment creation, installs dependencies, and validates directories.

$ErrorActionPreference = "Stop"

# Define literal ampersand wrapped in double quotes
$Amp = "&"

Write-Host "======================================================================"
Write-Host "         TradeValue: K12 Environment Setup $Amp Diagnostics"
Write-Host "======================================================================"

# 1. Validate Repository Folder Structure
Write-Host ""
Write-Host "[1/5] Validating folder structure..."
$RequiredFiles = @(
    "agent_service.py",
    "market_watcher_agent.py",
    "requirements.txt",
    "package.json",
    "functions/package.json",
    ".env.example"
)

foreach ($file in $RequiredFiles) {
    if (-not (Test-Path $file)) {
        Write-Error "CRITICAL: Required file '$file' is missing! Are you running this script from the project root?"
    }
}
Write-Host "All core files validated successfully."

# 2. Check Prerequisites (Python & Node.js)
Write-Host ""
Write-Host "[2/5] Checking prerequisites..."

$PythonCmd = Get-Command "python" -ErrorAction SilentlyContinue
if ($null -eq $PythonCmd) {
    Write-Error "Python is not installed or not in System PATH."
} else {
    try {
        $pythonVer = python --version 2>&1
        Write-Host "Python detected: $pythonVer"
    } catch {
        Write-Error "Failed to check Python version: $_"
    }
}

$NodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if ($null -eq $NodeCmd) {
    Write-Error "Node.js is not installed or not in System PATH."
} else {
    try {
        $nodeVer = node --version 2>&1
        Write-Host "Node.js detected: $nodeVer"
    } catch {
        Write-Error "Failed to check Node.js version: $_"
    }
}

# 3. Set up Python Virtual Environment & Install Dependencies
Write-Host ""
Write-Host "[3/5] Setting up Python virtual environment..."
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment '.venv'..."
    python -m venv .venv
} else {
    Write-Host "Virtual environment '.venv' already exists. Skipping creation."
}

# Determine paths to venv tools
$venvPython = ""
$venvPip = ""
$venvPlaywright = ""

if ($IsWindows -or $env:OS -eq "Windows_NT") {
    $venvPython = Join-Path (Get-Location) ".venv\Scripts\python.exe"
    $venvPip = Join-Path (Get-Location) ".venv\Scripts\pip.exe"
    $venvPlaywright = Join-Path (Get-Location) ".venv\Scripts\playwright.exe"
} else {
    $venvPython = Join-Path (Get-Location) ".venv/bin/python"
    $venvPip = Join-Path (Get-Location) ".venv/bin/pip"
    $venvPlaywright = Join-Path (Get-Location) ".venv/bin/playwright"
}

# Upgrade pip
Write-Host "Upgrading pip..."
Start-Process -FilePath $venvPython -ArgumentList "-m pip install --upgrade pip" -NoNewWindow -Wait

# Install dependencies from requirements.txt
Write-Host "Installing dependencies from requirements.txt..."
Start-Process -FilePath $venvPip -ArgumentList "install -r requirements.txt" -NoNewWindow -Wait
Write-Host "Python dependencies installed successfully."

# Install Playwright browser dependencies
Write-Host "Installing Playwright chromium browser dependency..."
Start-Process -FilePath $venvPlaywright -ArgumentList "install chromium" -NoNewWindow -Wait
Write-Host "Playwright Chromium browser installed."

# 4. Install Node.js packages
Write-Host ""
Write-Host "[4/5] Installing Node.js dependencies..."
Write-Host "Installing root package.json packages..."
Start-Process -FilePath "npm" -ArgumentList "install" -NoNewWindow -Wait

Write-Host "Installing functions package.json packages..."
Push-Location functions
try {
    Start-Process -FilePath "npm" -ArgumentList "install" -NoNewWindow -Wait
} finally {
    Pop-Location
}
Write-Host "Node.js dependencies installed successfully."

# 5. Check configuration files
Write-Host ""
Write-Host "[5/5] Checking configuration files..."
if (-not (Test-Path ".env.local")) {
    Write-Host "Warning: .env.local not found. Creating from .env.example..."
    Copy-Item ".env.example" ".env.local"
    Write-Host "IMPORTANT: Please fill in your API keys and configuration in your newly created .env.local file."
} else {
    Write-Host ".env.local configuration file detected."
}

Write-Host ""
Write-Host "======================================================================"
Write-Host "                 K12 Machine Setup Completed!"
Write-Host "======================================================================"
Write-Host "To start the backend server, run:"
Write-Host "   $Amp .venv/Scripts/python run_backend.py"
Write-Host "To run the daily synchronizer manually, run:"
Write-Host "   $Amp .venv/Scripts/python daily_orchestrator.py"
Write-Host "======================================================================"
