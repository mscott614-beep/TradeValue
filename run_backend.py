import os
import subprocess
import sys

# Load env variables from .env.local
env_file = ".env.local"
if os.path.exists(env_file):
    print(f"Loading environment from {env_file}...")
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip().strip("'\"")
else:
    print(f"Warning: {env_file} not found. Running with default env.")

# Force port to 8082 to avoid Windows Docker port 8080 conflict
print("Configuring port to 8082 (avoiding Docker conflict on 8080)...")
os.environ["PORT"] = "8082"

# Resolve GOOGLE_APPLICATION_CREDENTIALS to absolute path
if "GOOGLE_APPLICATION_CREDENTIALS" in os.environ:
    creds_path = os.environ["GOOGLE_APPLICATION_CREDENTIALS"]
    if not os.path.isabs(creds_path):
        abs_path = os.path.abspath(creds_path)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = abs_path
        print(f"Resolved GOOGLE_APPLICATION_CREDENTIALS to: {abs_path}")

# Launch agent_service.py with unbuffered python output
try:
    subprocess.run([sys.executable, "-u", "agent_service.py"], check=True)
except KeyboardInterrupt:
    print("\nStopping Agent Service.")
except Exception as e:
    print(f"Error running agent service: {e}")
