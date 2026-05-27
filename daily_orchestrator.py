import os
import subprocess
import time
import resend
from datetime import datetime
from dotenv import load_dotenv

# Load local environment variables from .env.local or fallback to .env
if os.path.exists(".env.local"):
    load_dotenv(".env.local")
else:
    load_dotenv()

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
EMAIL_TO = "mscott614@gmail.com"  # Canonical recipient

def run_script(script_name):
    print(f"\n[Orchestrator] Executing script: {script_name}...")
    start_time = time.time()
    try:
        # Determine the execution command based on file extension
        if script_name.endswith(".py"):
            cmd = ["python", "-u", script_name]
        elif script_name.endswith(".ts"):
            cmd = ["npx", "tsx", script_name]
        elif script_name.endswith(".js"):
            cmd = ["node", script_name]
        else:
            cmd = [script_name]

        # Use shell=True on Windows to support 'npx' command resolution
        use_shell = os.name == 'nt'
        
        # Run script and stream it in real-time
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            shell=use_shell
        )
        
        stdout_lines = []
        # Print child stdout in real-time as it becomes available
        for line in process.stdout:
            print(line, end='', flush=True)
            stdout_lines.append(line)
            
        process.wait()
        duration = time.time() - start_time
        success = process.returncode == 0
        
        stderr_content = process.stderr.read()
        
        # Parse stdout for interesting status lines
        summary_lines = []
        for line in stdout_lines:
            # Pick up progress or sync markers
            if any(x in line for x in ["[Google Sheets]", "[CSV Fallback]", "completed", "COMPLETED", "Successfully", "EXCEPTION", "Arbitrage Hunter Run Complete", "Validated Deals Found", "Noise Blocked"]):
                summary_lines.append(line.strip())
                
        summary = "\n".join(summary_lines[-12:]) if summary_lines else "No status lines parsed."
        
        # If execution failed and summary is dry, load the last 5 stderr lines
        if not success:
            print(f"[Orchestrator] ERROR: Script {script_name} failed with stderr:\n{stderr_content}", flush=True)
            stderr_tail = "\n".join(stderr_content.split('\n')[-5:])
            summary += f"\n\nError Output:\n{stderr_tail}"
            
        print(f"[Orchestrator] Completed {script_name} in {round(duration, 2)}s with exit code {process.returncode}")
        
        return {
            "name": script_name,
            "success": success,
            "duration": round(duration, 2),
            "summary": summary
        }
    except Exception as e:
        duration = time.time() - start_time
        print(f"[Orchestrator] FATAL: Script {script_name} crashed: {str(e)}")
        return {
            "name": script_name,
            "success": False,
            "duration": round(duration, 2),
            "summary": f"Execution crashed: {str(e)}"
        }

def send_status_email(results):
    if not RESEND_API_KEY:
        print("\n" + "="*80)
        print("[Orchestrator] WARNING: RESEND_API_KEY is not configured in .env.local.")
        print("[Orchestrator] Cannot dispatch email. Printing summary report locally:")
        for r in results:
            status_label = "SUCCESS" if r["success"] else "FAILED"
            print(f"  - {r['name']}: {status_label} ({r['duration']}s)")
            print(f"    Summary: {r['summary']}\n")
        print("="*80 + "\n")
        return False
        
    resend.api_key = RESEND_API_KEY
    
    today = datetime.now().strftime("%Y-%m-%d")
    overall_success = all(r["success"] for r in results)
    status_icon = "✅" if overall_success else "❌"
    status_text = "All Sync Scripts Completed Successfully!" if overall_success else "Attention Needed: Sync Script Failed"
    
    # Compile HTML body
    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #1f2937; border: 1px solid #e5e7eb; border-radius: 8px; padding: 25px; background: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <h2 style="color: { '#16a34a' if overall_success else '#dc2626' }; margin-top: 0; display: flex; align-items: center; gap: 8px; font-size: 20px;">
            <span style="font-size: 24px;">{status_icon}</span> TradeValue Daily Sync Report
        </h2>
        <p style="font-size: 14px; color: #6b7280; margin-top: -8px; margin-bottom: 20px;">Date: {today}</p>
        <div style="font-size: 15px; font-weight: 600; color: #374151; margin-bottom: 20px;">{status_text}</div>
        <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
    """
    
    for r in results:
        badge_bg = "#f0fdf4" if r["success"] else "#fef2f2"
        badge_border = "#bbf7d0" if r["success"] else "#fecaca"
        text_color = "#16a34a" if r["success"] else "#dc2626"
        status_label = "SUCCESS" if r["success"] else "FAILED"
        
        html_content += f"""
        <div style="margin-bottom: 20px; padding: 18px; border-radius: 6px; background-color: {badge_bg}; border: 1px solid {badge_border};">
            <h3 style="margin-top: 0; color: #1f2937; font-size: 16px;">
                Script: <span style="font-family: monospace; background: rgba(0,0,0,0.04); padding: 2px 6px; border-radius: 4px;">{r["name"]}</span>
                <span style="float: right; font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; background: {text_color}; color: white; letter-spacing: 0.5px;">{status_label}</span>
            </h3>
            <p style="font-size: 13px; color: #4b5563; margin: 8px 0;"><strong>Execution Duration:</strong> {r["duration"]} seconds</p>
            <p style="font-size: 13px; color: #4b5563; margin: 8px 0 4px 0;"><strong>Status Log Summary:</strong></p>
            <pre style="background: #ffffff; border: 1px solid #e5e7eb; padding: 12px; border-radius: 4px; font-family: monospace; white-space: pre-wrap; font-size: 12px; color: #374151; margin-top: 4px;">{r["summary"]}</pre>
        </div>
        """
        
    html_content += """
        <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 25px 0;" />
        <p style="font-size: 11px; color: #9ca3af; text-align: center; margin-top: 20px; line-height: 1.4;">
            TradeValue Automated Local Orchestrator.<br/>
            This is a locally triggered diagnostic report sent from your host PC.
        </p>
    </div>
    """
    
    try:
        print(f"[Orchestrator] Dispatching sync report email to {EMAIL_TO}...")
        resend.Emails.send({
            "from": "TradeValue Daily Agent <onboarding@resend.dev>",
            "to": EMAIL_TO,
            "subject": f"{status_icon} Daily Sync Status Report — {today}",
            "html": html_content
        })
        print("[Orchestrator] Sync report email dispatched successfully!")
        return True
    except Exception as e:
        print(f"[Orchestrator] ERROR sending email via Resend: {str(e)}")
        return False

def main():
    print("====================================================================")
    print("Starting TradeValue Daily Orchestration Loop")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("====================================================================")

    # List of daily sync scripts to execute
    scripts = [
        "ebay_saved_searches_sync.py",
        "src/workers/arbitrage-hunter.ts"
    ]

    results = []
    for script in scripts:
        if os.path.exists(script):
            res = run_script(script)
            results.append(res)
        else:
            print(f"[Orchestrator] WARNING: Script '{script}' not found in directory.")
            results.append({
                "name": script,
                "success": False,
                "duration": 0.0,
                "summary": "Script file not found in directory."
            })

    # Dispatch compiled HTML report via Resend
    send_status_email(results)
    
    print("====================================================================")
    print("TradeValue Daily Orchestration Loop Finished")
    print("====================================================================")

if __name__ == "__main__":
    main()
