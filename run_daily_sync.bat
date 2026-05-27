@echo off
:: Navigate to the project directory
cd /d "%~dp0"

echo ====================================================================
echo Starting TradeValue Master Daily Orchestrator
echo Timestamp: %date% %time%
echo ====================================================================

:: Run the daily orchestration loop (runs both sync scripts and emails results)
python daily_orchestrator.py

echo ====================================================================
echo Daily Sync Orchestration Complete!
echo ====================================================================
timeout /t 5
