#!/bin/bash
# TradeValue — K12 Migration & Setup Script (Unix/Linux/macOS Bash)
# Automates Virtual Environment creation, installs dependencies, and validates directories.

set -e

# ANSI Color Codes
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}======================================================================${NC}"
echo -e "${CYAN}         🔮 TradeValue: K12 Environment Setup & Diagnostics 🔮${NC}"
echo -e "${CYAN}======================================================================${NC}"

# 1. Validate Repository Folder Structure
echo -e "\n${YELLOW}[1/5] Validating folder structure...${NC}"
REQUIRED_FILES=(
    "agent_service.py"
    "market_watcher_agent.py"
    "requirements.txt"
    "package.json"
    "functions/package.json"
    ".env.example"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}CRITICAL: Required file '$file' is missing! Are you running this script from the project root?${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ All core files validated successfully.${NC}"

# 2. Check Prerequisites (Python & Node.js)
echo -e "\n${YELLOW}[2/5] Checking prerequisites...${NC}"
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
else
    echo -e "${RED}Python is not installed or not in System PATH.${NC}"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version)
echo -e "${GREEN}✓ Python detected: $PYTHON_VERSION${NC}"

if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js detected: $NODE_VERSION${NC}"
else
    echo -e "${RED}Node.js is not installed or not in System PATH.${NC}"
    exit 1
fi

# 3. Set up Python Virtual Environment & Install Dependencies
echo -e "\n${YELLOW}[3/5] Setting up Python virtual environment...${NC}"
if [ ! -d ".venv" ]; then
    echo -e "Creating virtual environment '.venv'..."
    $PYTHON_CMD -m venv .venv
else
    echo -e "Virtual environment '.venv' already exists. Skipping creation."
fi

# Activate virtual environment
echo -e "Activating virtual environment..."
source .venv/bin/activate

# Upgrade pip
echo -e "Upgrading pip..."
pip install --upgrade pip

# Install dependencies from requirements.txt
echo -e "Installing dependencies from requirements.txt..."
pip install -r requirements.txt
echo -e "${GREEN}✓ Python dependencies installed successfully.${NC}"

# Install Playwright browser dependencies
echo -e "Installing Playwright chromium browser dependency..."
playwright install chromium
echo -e "${GREEN}✓ Playwright Chromium browser installed.${NC}"

# 4. Install Node.js packages
echo -e "\n${YELLOW}[4/5] Installing Node.js dependencies...${NC}"
echo -e "Installing root package.json packages..."
npm install

echo -e "Installing functions package.json packages..."
cd functions
npm install
cd ..
echo -e "${GREEN}✓ Node.js dependencies installed successfully.${NC}"

# 5. Check configuration files
echo -e "\n${YELLOW}[5/5] Checking configuration files...${NC}"
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}Warning: .env.local not found. Creating from .env.example...${NC}"
    copy .env.example .env.local 2>/dev/null || cp .env.example .env.local
    echo -e "${CYAN}!${NC}"
    echo -e "${YELLOW}IMPORTANT: Please fill in your API keys and configuration in your newly created .env.local file.${NC}"
else
    echo -e "${GREEN}✓ .env.local configuration file detected.${NC}"
fi

echo -e "${GREEN}======================================================================${NC}"
echo -e "${GREEN}                 🎉 K12 Machine Setup Completed! 🎉${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo -e "To start the backend server, run:"
echo -e "   source .venv/bin/activate && python run_backend.py"
echo -e "To run the daily synchronizer manually, run:"
echo -e "   source .venv/bin/activate && python daily_orchestrator.py"
echo -e "${GREEN}======================================================================${NC}"
