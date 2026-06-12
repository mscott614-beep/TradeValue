import asyncio
import os
import sys

# Load environment variables if running manually
# (The JS script will inject them via process.env)
from dotenv import load_dotenv
load_dotenv(".env.local")

# We import from agent_service which already sets up the db, resend, etc.
from agent_service import warm_all_series_caches, execute_batch_sync_worker

async def main():
    print("[HermesGlobal] Starting Local Global Batch Sync")
    try:
        # Step 1: Warm up the caches (Skip if local LLM is used, as it doesn't support Gemini's explicit caching)
        use_local_llm = os.getenv("USE_LOCAL_LLM") == "true"
        if use_local_llm:
            print("[HermesGlobal] Skipping Gemini explicit context caches (Local LLM is active)...")
        else:
            print("[HermesGlobal] Warming Gemini explicit context caches...")
            from google import genai
            from agent_service import get_db
            client = genai.Client()
            warm_res = warm_all_series_caches(client, db=get_db())
            print(f"[HermesGlobal] Cache warming results: {warm_res}")
    except Exception as e:
        print(f"[HermesGlobal] Context cache warm failed (non-fatal): {str(e)}")

    try:
        # Step 2: Execute the batch sync logic
        print("[HermesGlobal] Starting zero-value card batch sync...")
        await execute_batch_sync_worker("GLOBAL_BATCH_SYSTEM")
        print("[HermesGlobal] Batch sync complete.")
    except Exception as e:
        print(f"[HermesGlobal] Failed to execute batch sync: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
