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
    """Finds and parses the first JSON block in a string."""
    match = re.search(r'(\{[\s\S]*\})', raw_text)
    if not match:
        return None
    
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
    background_tasks.add_task(run_batch_sync_job, req.userId)
    return {"status": "accepted"}

def run_batch_sync_job(userId: str):
    try:
        db = get_db()
        cards_ref = db.collection_group("portfolios").where("currentMarketValue", "in", [0.0, 0.01]).limit(1000)
        cards = cards_ref.stream()
        
        jsonl_lines = []
        bucket_name = f"{PROJECT_ID}-batch-sync"
        
        for card_doc in cards:
            data = card_doc.to_dict()
            player = data.get('player', 'Unknown')
            card_num = data.get('cardNumber', '')
            brand = data.get('brand', '')
            year = data.get('year', '')
            
            prompt = f"SEARCH AND VALUE: {year} {brand} {player} #{card_num}. Return JSON."
            
            metadata = {
                "userId": userId,
                "cardId": card_doc.id,
                "path": card_doc.reference.path
            }
            
            jsonl_lines.append(json.dumps({
                "request": {"contents": [{"role": "user", "parts": [{"text": prompt}]}]},
                "metadata": metadata
            }))
        
        if not jsonl_lines: return

        storage_client = storage.Client(project=PROJECT_ID)
        bucket = storage_client.bucket(bucket_name)
        if not bucket.exists(): bucket.create(location="us-central1")
            
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        blob = bucket.blob(f"input/batch_sync_{timestamp}.jsonl")
        blob.upload_from_string("\n".join(jsonl_lines), content_type="application/json")
        
        aiplatform.init(project=PROJECT_ID, location="us-central1")
        aiplatform.BatchPredictionJob.create(
            job_display_name=f"batch_sync_{timestamp}",
            model_name="publishers/google/models/gemini-1.5-flash",
            gcs_source=f"gs://{bucket_name}/{blob.name}",
            gcs_destination_prefix=f"gs://{bucket_name}/output/{timestamp}/",
        )
    except Exception as e:
        print(f"[BatchSync] ERROR: {str(e)}")

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
            config=types.GenerateContentConfig(response_mime_type='application/json')
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
    details = req.cardDetails
    docId = req.cardId
    
    # --- IRONCLAD FALLBACK ---
    error_fallback = {
        "currentMarketValue": 0.00,
        "status": "manual_review",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "active_listings": [],
        "sold_listings": [],
        "supporting_data": {"error": "Search failed"}
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

        # 3. Universal Card Number Sanitizer
        raw_num = str(details.get('cardNumber') or details.get('number') or '').strip()
        # Strip #, No., No, c
        cleaned_num = re.sub(r'^(#|No\.|No|c)+', '', raw_num, flags=re.IGNORECASE).strip()
        
        # Serial Number Logic
        sn = str(details.get('serialNumber') or details.get('serial_number') or '0').strip()
        is_serial = sn != '0' and sn != 'None' and sn != ''
        
        # Omit alphabetical prefixes for serial/complex cards
        if is_serial or re.search(r'[A-Za-z]+-', cleaned_num):
            match = re.search(r'\d+', cleaned_num)
            cleaned_num = match.group() if match else ""

        # 4. Player
        player = str(details.get('player', '')).strip()

        # 5. Build Sanitized Query
        query_parts = [year, brand_raw, player, cleaned_num]
        if is_serial: query_parts.append(f"/{sn}")
        sanitized_base = sanitize_query_parts(query_parts)

        # Graded check (Initialize from request or calculate)
        is_graded_req = details.get('isGraded') or details.get('is_graded') or False
        grader = str(details.get('gradingCompany') or '').upper()
        grade = str(details.get('grade') or '').upper()
        is_graded_calc = any(x in grader or x in grade for x in ['PSA', 'BGS', 'SGC', 'CGC'])
        is_graded = is_graded_req or is_graded_calc
        
        # Negative Keywords for authenticity
        neg_keywords = "-reprint -RP -facsimile -copy -sticker -custom"
        card_desc = f"{sanitized_base} {grader} {grade} {neg_keywords}".strip() if is_graded else f"{sanitized_base} -PSA -BGS -SGC -CGC {neg_keywords}".strip()
        
        # Fallback Queries (Simplified for Flash)
        fallback_query = f"VALUE: {player} {cleaned_num} {brand_raw} {year}. JSON."
        ultra_broad_query = f"VALUE: {year} {brand_raw} {player}. JSON."

        async def attempt_run(q):
            client = genai.Client(vertexai=True, project=PROJECT_ID, location='us-central1')
            sys_inst = (
                f"Analyst. Player: {player}, Card: #{cleaned_num}. "
                "RULES: Ignore bottom 25% of 'Sold' comps. Median of rest. "
                "No Sold? Use 80% of active median. Return JSON {currentMarketValue, active_listings, sold_listings}."
            )
            response = client.models.generate_content(
                model='gemini-1.5-flash',
                contents=q,
                config=types.GenerateContentConfig(
                    system_instruction=sys_inst,
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    response_mime_type='application/json'
                )
            )
            return response.text

        raw_res = await attempt_run(f"SEARCH: {card_desc} -lot -set")
        
        # Cascading Fallback Logic
        if "$0" in raw_res or "0.00" in raw_res or "no results" in raw_res.lower():
            print("[AgentService] Tier 2 Fallback Triggered...")
            raw_res = await attempt_run(fallback_query)
            
        if "$0" in raw_res or "0.00" in raw_res or "no results" in raw_res.lower():
            print("[AgentService] Tier 3 Ultra-Broad Fallback Triggered...")
            raw_res = await attempt_run(ultra_broad_query)

        res_json = robust_json_parse(raw_res)
        if not res_json: return error_fallback

        # Price Logic
        cost_basis = clean_numeric(details.get('costBasis') or details.get('purchasePrice') or 0.00, 0.00)
        val = res_json.get('currentMarketValue') or res_json.get('final_price') or 0.00
        final_price = clean_numeric(val, cost_basis)
        
        if final_price <= 0.01: final_price = cost_basis

        res_json['currentMarketValue'] = final_price
        if 'final_price' in res_json: del res_json['final_price']
        
        # Final Sanitization & No-Fail Defaults
        final_payload = sanitize_firestore_payload({
            "currentMarketValue": final_price,
            "status": "market_verified" if final_price > 0.01 else "manual_review",
            "active_listings": res_json.get("active_listings"),
            "sold_listings": res_json.get("sold_listings"),
            "supporting_data": res_json.get("supporting_data")
        })

        # Persist
        try:
            db = get_db()
            if db:
                db.collection('collections').document(docId).update(final_payload)
                if req.userId:
                    db.collection('users').document(req.userId).collection('portfolios').document(docId).update(final_payload)
        except Exception as e:
            print(f"[AgentService] Firestore Update Failed: {str(e)}")

        return final_payload

    except Exception as e:
        print(f"[AgentService] FATAL ERROR: {str(e)}")
        try:
            db = get_db()
            if db and docId:
                fail_payload = sanitize_firestore_payload(error_fallback)
                db.collection('collections').document(docId).update(fail_payload)
        except: pass
        return sanitize_firestore_payload(error_fallback)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
