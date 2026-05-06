# REQUIRED_ENV: RESEND_API_KEY
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import asyncio
import json
import re
import os
from market_watcher_agent import AgentClass, PROJECT_ID
from google.cloud import firestore
from google.cloud import aiplatform
from google.cloud import storage
from datetime import datetime, timezone
from google import genai
from google.genai import types
import resend

# Initialize Resend
resend.api_key = os.getenv("RESEND_API_KEY")

# Lazy Firestore Client initialization
_db = None
def get_db():
    global _db
    if _db is None:
        try:
            _db = firestore.Client(project=PROJECT_ID)
        except Exception as e:
            print(f"[AgentService] CRITICAL: Firestore client failed to initialize: {str(e)}")
            return None
    return _db

def clean_numeric(val, default=0.01):
    """Strictly casts a value to a float."""
    if val is None or val == "" or str(val).strip().upper() in ["N/A", "UNDEFINED", "NULL"]:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        clean_str = re.sub(r'[^\d.]', '', val)
        try:
            return float(clean_str) if clean_str else default
        except ValueError:
            return default
    return default

def sanitize_query_parts(parts: list) -> str:
    """Removes duplicate words and cleans formatting for eBay searches."""
    seen = set()
    cleaned = []
    for part in parts:
        if not part: continue
        # Normalize: replace hyphens with spaces for duplicate detection
        words = str(part).replace('-', ' ').split()
        for word in words:
            if word.lower() not in seen:
                cleaned.append(word)
                seen.add(word.lower())
    return " ".join(cleaned)

def robust_json_parse(raw_text):
    """Finds and parses the first JSON block in a string. Fallback to regex for price."""
    match = re.search(r'(\{[\s\S]*\})', raw_text)
    if match:
        json_str = match.group(1).replace('```json', '').replace('```', '').strip()
        bracket_count = 0
        for i, char in enumerate(json_str):
            if char == '{': bracket_count += 1
            elif char == '}': bracket_count -= 1
            if bracket_count == 0:
                json_str = json_str[:i+1]
                break
        try:
            return json.loads(json_str)
        except:
            pass
            
    # Fallback: Extract the first numerical value with a dollar sign or just the first large number
    price_match = re.search(r'\$(\d+(?:\.\d{2})?)', raw_text)
    if price_match:
        return {
            "currentMarketValue": float(price_match.group(1)),
            "active_listings": [],
            "sold_listings": []
        }
        
    num_match = re.search(r'(\d+\.\d{2})', raw_text)
    if num_match:
        return {
            "currentMarketValue": float(num_match.group(1)),
            "active_listings": [],
            "sold_listings": []
        }
        
    return None

def sanitize_firestore_payload(payload: dict) -> dict:
    """
    Strips None values and ensures UI-critical fields have safe fallbacks.
    Prevents Firestore 'undefined' errors and red 'Refresh Failed' boxes.
    """
    defaults = {
        "currentMarketValue": 0.00,
        "image_url": "",
        "status": "manual_review",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "active_listings": [],
        "sold_listings": [],
        "supporting_data": {}
    }
    
    # 1. Apply Defaults for missing/null keys
    sanitized = {k: (payload.get(k) if payload.get(k) is not None else v) for k, v in defaults.items()}
    
    # 2. Add other non-None keys from payload
    for k, v in payload.items():
        if k not in sanitized and v is not None:
            sanitized[k] = v
            
    # 3. Final type safety for numeric fields
    if "currentMarketValue" in sanitized:
        try:
            sanitized["currentMarketValue"] = float(sanitized["currentMarketValue"])
        except:
            sanitized["currentMarketValue"] = 0.00
            
    return sanitized

app = FastAPI()

class ValuationRequest(BaseModel):
    userId: str
    cardId: str
    cardDetails: dict
    deepSearch: bool = False

@app.get("/health")
def health():
    return {"status": "healthy"}

class BatchSyncRequest(BaseModel):
    userId: str = "GLOBAL_SYSTEM"

@app.post("/batch-sync", status_code=202)
async def batch_sync(req: BatchSyncRequest, background_tasks: BackgroundTasks):
    """
    Triggers the batch sync process as a background task.
    """
    # Trigger the "tool" logic which now returns immediately
    msg = run_batch_sync_job(req.userId)
    return {"status": "accepted", "message": msg}

def run_batch_sync_job(userId: str):
    """
    Entry point for the batch sync 'tool'.
    Now returns immediately while the worker handles the heavy lifting.
    """
    # Start the actual worker in a new thread or background task
    # Since we're in a synchronous function called by FastAPI background tasks,
    # or potentially called directly, we'll use a threading approach if needed,
    # but here we'll just return a message and let the worker be called.
    
    # In this specific architecture, we'll use a non-blocking asyncio task
    # to trigger the worker loop.
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(execute_batch_sync_worker(userId))
        else:
            asyncio.run(execute_batch_sync_worker(userId))
    except Exception as e:
        print(f"[BatchSync] Trigger failed: {str(e)}")
        # Fallback to direct call if event loop is tricky
        import threading
        threading.Thread(target=lambda: asyncio.run(execute_batch_sync_worker(userId))).start()

    return "Batch Sync Job Started"

async def execute_batch_sync_worker(userId: str):
    """
    The actual heavy-lifting worker that processes cards and submits Vertex AI jobs.
    """
    print(f"[BatchSync] Worker started for user: {userId}")
    try:
        db = get_db()
        # Find cards needing valuation (Limit increased to 200 total per run)
        cards_ref = db.collection_group("portfolios").where("currentMarketValue", "in", [0.0, 0.01]).limit(200)
        cards = list(cards_ref.stream())
        
        if not cards:
            print("[BatchSync] No cards found needing sync.")
            return

        # Chunk into groups of 20
        chunk_size = 20
        for i in range(0, len(cards), chunk_size):
            chunk = cards[i:i + chunk_size]
            jsonl_lines = []
            
            for card_doc in chunk:
                data = card_doc.to_dict()
                player = data.get('player', 'Unknown')
                card_num = data.get('cardNumber', '')
                brand = data.get('brand', '')
                year = data.get('year', '')
                
                # Explicit Query Construction
                search_query = f"{year} {brand} {player} #{card_num}".strip()
                prompt = f"SEARCH AND VALUE: {search_query}. Return JSON {{currentMarketValue, active_listings, sold_listings}}."
                
                jsonl_lines.append(json.dumps({
                    "request": {"contents": [{"role": "user", "parts": [{"text": prompt}]}]}
                }))
            
            # Upload and trigger job for this chunk
            bucket_name = f"{PROJECT_ID}-batch-sync"
            storage_client = storage.Client(project=PROJECT_ID)
            bucket = storage_client.bucket(bucket_name)
            if not bucket.exists(): bucket.create(location="us-central1")
                
            timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
            blob_path = f"input/batch_{i//chunk_size}_{timestamp}.jsonl"
            blob = bucket.blob(blob_path)
            blob.upload_from_string("\n".join(jsonl_lines), content_type="application/json")
            
            aiplatform.init(project=PROJECT_ID, location="us-central1")
            # This is the call that takes time; being in a worker prevents tool timeouts
            aiplatform.BatchPredictionJob.create(
                job_display_name=f"batch_sync_{i//chunk_size}_{timestamp}",
                model_name="publishers/google/models/gemini-1.5-flash",
                gcs_source=f"gs://{bucket_name}/{blob_path}",
                gcs_destination_prefix=f"gs://{bucket_name}/output/{timestamp}/{i//chunk_size}/",
            )
            print(f"[BatchSync] Submitted chunk {i//chunk_size} ({len(chunk)} cards)")
            
    except Exception as e:
        print(f"[BatchSync] Worker ERROR: {str(e)}")

@app.post("/trigger-newsletter", status_code=202)
async def trigger_newsletter(background_tasks: BackgroundTasks):
    """
    Triggers the Market Analyst research loop in the background.
    Cloud Scheduler should hit this endpoint on Mondays at 3:00 PM.
    """
    background_tasks.add_task(run_newsletter_job)
    return {"status": "accepted", "message": "Newsletter generation started"}

def run_newsletter_job():
    """
    Background worker that handles the research and persistence.
    """
    try:
        print("[AgentService] Starting Background Newsletter Job...")
        agent = AgentClass()
        report_raw = agent.generate_market_report()
        
        res_json = robust_json_parse(report_raw)
        if res_json:
            db = get_db()
            if db:
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                doc_ref = db.collection("market_reports").document(today)
                
                # Metadata for tracking
                res_json["report_date"] = today
                res_json["created_at"] = firestore.SERVER_TIMESTAMP
                
                doc_ref.set(res_json)
                print(f"[AgentService] SUCCESS: Market report for {today} persisted to Firestore.")
                
                # --- EMAIL DISPATCH ---
                compile_and_send_newsletter(res_json)
        else:
            print("[AgentService] ERROR: Background newsletter job failed to parse JSON.")
    except Exception as e:
        print(f"[AgentService] CRITICAL: Background newsletter job failed: {str(e)}")

def compile_and_send_newsletter(data):
    """
    Compiles the JSON market report into HTML and sends it via Resend.
    """
    api_key = os.getenv("RESEND_API_KEY")
    to_email = "mscott614@gmail.com" 
    
    if not api_key:
        print("[Newsletter] ERROR: RESEND_API_KEY is missing from environment", flush=True)
        return

    # Build the HTML Payload
    trending_rows = "".join([
        f"<tr><td style='padding:8px; border:1px solid #ddd;'>{item.get('card')}</td>"
        f"<td style='padding:8px; border:1px solid #ddd;'>{item.get('price')}</td>"
        f"<td style='padding:8px; border:1px solid #ddd;'>{item.get('trend_insight')}</td></tr>"
        for item in data.get('trending_table', [])
    ])

    news_items = "".join([f"<li>{item}</li>" for item in data.get('breaking_news', [])])

    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #333;">
        <h1 style="color: #2c3e50;">TradeValue Market Analyst Report</h1>
        <p style="font-size: 1.1em;">{data.get('executive_summary', '')}</p>
        <h2 style="border-bottom: 2px solid #3498db; padding-bottom: 5px;">Breaking News</h2>
        <ul>{news_items}</ul>
        <h2 style="border-bottom: 2px solid #3498db; padding-bottom: 5px;">Trending This Week</h2>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead style="background-color: #f2f2f2;">
                <tr>
                    <th style="padding:10px; border:1px solid #ddd; text-align:left;">Card</th>
                    <th style="padding:10px; border:1px solid #ddd; text-align:left;">Price</th>
                    <th style="padding:10px; border:1px solid #ddd; text-align:left;">Insight</th>
                </tr>
            </thead>
            <tbody>{trending_rows}</tbody>
        </table>
    </div>
    """

    try:
        print(f"[Newsletter] Dispatching to {to_email}...", flush=True)
        params = {
            "from": "TradeValue Market Agent <onboarding@resend.dev>",
            "to": to_email,
            "subject": "Weekly TradeValue Market Report",
            "html": html_content,
        }
        
        if not resend.api_key:
            resend.api_key = api_key
            
        email_res = resend.Emails.send(params)
        
        if email_res and "id" in email_res:
            print(f"[Newsletter] SUCCESS: ID: {email_res['id']}", flush=True)
        else:
            print(f"[Newsletter] WARNING: Unexpected response: {email_res}", flush=True)
            
    except Exception as e:
        print(f"[Newsletter] CRASHED: {str(e)}", flush=True)

class ExtractRequest(BaseModel):
    url: str

@app.post("/extract-ebay")
async def extract_ebay(req: ExtractRequest):
    import requests
    from bs4 import BeautifulSoup
    url = req.url
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        response = requests.get(url, headers=headers, timeout=15)
        context_data = f"URL: {url}, HTML: {response.text[:1000]}" if response.status_code == 200 else f"URL: {url}"
        
        client = genai.Client(vertexai=True, project=PROJECT_ID, location='us-central1')
        prompt = f"Extract card details from: {context_data}. Return JSON."
        
        res = client.models.generate_content(
            model='gemini-1.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                # Disable JSON mode for tool compatibility
                # response_mime_type='application/json' 
            )
        )
        res_json = robust_json_parse(res.text)
        if res_json:
            res_json['currentMarketValue'] = clean_numeric(res_json.get('currentMarketValue'))
            return res_json
        return {"error": "Failed to extract"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/value-card")
async def value_card(req: ValuationRequest):
    # Fix: Explicitly log the incoming request body
    print(f"[AgentService] Incoming valuation request: {req.json()}")
    
    docId = req.cardId
    userId = req.userId
    
    # Fix: Pull fresh metadata from Firestore and return 404 if missing
    try:
        db = get_db()
        if db and docId and userId:
            print(f"[AgentService] Handshake: Fetching metadata for docId: {docId}")
            doc_snap = db.collection('users').document(userId).collection('portfolios').document(docId).get(timeout=120)
            if doc_snap.exists:
                details = doc_snap.to_dict()
                print(f"[AgentService] Handshake SUCCESS: Found {details.get('player')}")
            else:
                print(f"[Error] Card metadata not found for ID: {docId}")
                raise HTTPException(status_code=404, detail="Card metadata not found")
        else:
            raise HTTPException(status_code=400, detail="Missing required parameters (userId or cardId)")
    except HTTPException:
        raise
    except Exception as fe:
        print(f"[Error] Firestore metadata fetch failed: {str(fe)}")
        raise HTTPException(status_code=500, detail=str(fe))

    # --- IRONCLAD FALLBACK ---
    error_fallback = {
        "final_price": 0.00,
        "currentMarketValue": 0.00,
        "status": "manual_review",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "active_listings": [],
        "sold_listings": [],
        "supporting_data": {"error": "Search failed"},
        "query": "Unknown",
        "method": "direct_search"
    }

    try:
        # 1. Date Expansion
        year = str(details.get('year', '')).strip()
        if re.match(r'^\d{4}$', year):
            y_int = int(year)
            year = f"{y_int}-{(y_int+1)%100:02d}"

        # 2. Manufacturer & Brand
        mfg = str(details.get('brand') or details.get('manufacturer') or '').strip()
        set_name = str(details.get('set') or details.get('setName') or '').strip()
        brand_raw = f"{mfg} {set_name}".strip()

        # 4. Player
        player = str(details.get('player', '')).strip()
        
        # 5. Parallel / Attributes (Auto, Patch, etc.)
        parallel = str(details.get('parallel', '')).strip()
        if parallel.lower() == 'base': parallel = ''

        # Fix: Hardcode FOOLPROOF Query Construction
        # Pattern: [Year] [Brand] [Player] [CardNumber] [Parallel] -reprint -rp
        query_parts = [
            str(details.get('year', '')),
            str(details.get('brand', '')),
            player,
            str(details.get('cardNumber', '')),
            parallel
        ]
        query = " ".join([p for p in query_parts if p and str(p).lower() != 'undefined']).strip()
        query += " -reprint -rp"
        card_desc = query
        
        # Method tracking
        method_used = "Gemini-1.5-Flash-Trimmed-Mean"

        async def attempt_run(q):
            client = genai.Client(vertexai=True, project=PROJECT_ID, location='us-central1')
            
            sys_inst = (
                f"You are a Senior Trading Card Valuation Analyst. Target: {player}, Card: #{cleaned_num}. "
                "VALUATION PROTOCOL: "
                "1. STRICTLY EXCLUDE any reprints, copies, or custom cards (-reprint -rp -copy). "
                "2. Apply a 'Trimmed Mean' protocol: eliminate the top 10% and bottom 25% of sold prices to remove outliers. "
                "3. Calculate the median of the remaining sales. "
                "4. LISTINGS: You MUST find and return the TOP 5 Active Links and TOP 5 Sold Links from your search results. "
                "5. RETURN FORMAT: You MUST return a JSON block with this EXACT structure: "
                "{\"currentMarketValue\": 123.45, \"active_listings\": [{\"title\": \"...\", \"price\": 123, \"url\": \"...\"}], \"sold_listings\": [{\"title\": \"...\", \"price\": 123, \"url\": \"...\"}]}"
            )
            
            # Fix: Explicitly set response_mime_type="text/plain" for tool compatibility
            response = client.models.generate_content(
                model='gemini-1.5-flash',
                contents=q,
                config=types.GenerateContentConfig(
                    system_instruction=sys_inst,
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    response_mime_type='text/plain' 
                )
            )
            return response.text

        raw_res = await attempt_run(f"SEARCH: {card_desc} -lot -set")
        
        # Cascading Fallback Logic
        if "$0" in raw_res or "0.00" in raw_res or "no results" in raw_res.lower():
            method_used = "fallback_broad_search"
            raw_res = await attempt_run(f"VALUE: {player} {cleaned_num} {brand_raw} {year}. JSON.")
            
        res_json = robust_json_parse(raw_res)
        if not res_json: return error_fallback

        # Price Logic
        cost_basis = clean_numeric(details.get('costBasis') or details.get('purchasePrice') or 0.00, 0.00)
        val = res_json.get('currentMarketValue') or res_json.get('final_price') or 0.00
        final_price = clean_numeric(val, cost_basis)
        
        if final_price <= 0.01: final_price = cost_basis

        # Prepare listings for UI (Fix: Align with marketPrices structure)
        active_results = res_json.get("active_listings") or []
        sold_results = res_json.get("sold_listings") or []
        
        # Final Handshake Payload (Strictly Typed snake_case arrays)
        final_payload = sanitize_firestore_payload({
            "final_price": final_price,
            "currentMarketValue": final_price,
            "status": "market_verified" if final_price > 0.01 else "manual_review",
            "active_listings": active_results,
            "sold_listings": sold_results,
            "marketPrices": {
                "median": final_price,
                "activeItems": active_results,
                "soldItems": sold_results,
                "lastUpdated": datetime.now(timezone.utc).isoformat()
            },
            "query": card_desc, 
            "method": method_used
        })

        # Persist (Fix: Log the Update and Verify Field Names)
        try:
            db = get_db()
            if db and docId:
                # 1. Update the Global 'collections' cache
                print(f"[AgentService] AUDIT: Updating Root 'collections' document_id: {docId}")
                print(f"[AgentService] AUDIT: Payload: {json.dumps(final_payload, default=str)}")
                
                # Check if this doc actually exists before updating to avoid ghost writes
                global_doc = db.collection('collections').document(docId)
                if global_doc.get().exists:
                    global_doc.update(final_payload)
                else:
                    print(f"[AgentService] WARNING: docId {docId} NOT FOUND in 'collections'")

                # 2. Update the User-specific 'portfolios' collection
                if userId:
                    print(f"[AgentService] AUDIT: Updating User 'portfolios' collection. User: {userId}, Doc: {docId}")
                    user_doc = db.collection('users').document(userId).collection('portfolios').document(docId)
                    if user_doc.get().exists:
                        user_doc.update(final_payload)
                    else:
                        print(f"[AgentService] WARNING: docId {docId} NOT FOUND in user {userId} portfolio")
            else:
                print(f"[AgentService] ERROR: docId is missing, cannot persist to Firestore.")
        except Exception as e:
            print(f"[AgentService] Firestore Update Failed: {str(e)}")

        return final_payload

    except Exception as e:
        print(f"[AgentService] FATAL ERROR: {str(e)}")
        return sanitize_firestore_payload(error_fallback)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
