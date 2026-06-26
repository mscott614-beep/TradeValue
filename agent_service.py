# REQUIRED_ENV (Secret Manager on Cloud Run): GOOGLE_GENAI_API_KEY, RESEND_API_KEY, EBAY_*
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import asyncio
import json
import re
import os
from market_watcher_agent import AgentClass, PROJECT_ID, LOCATION, get_vertex_client
from google.cloud import firestore
from google.cloud import aiplatform
from google.cloud import storage
from datetime import datetime, timezone
from google import genai
from google.genai import types
import resend
import base64
import requests
import time
from datetime import datetime, timezone, timedelta

# --- Local LLM Config ---
USE_LOCAL_LLM = os.getenv("USE_LOCAL_LLM") == "true"
LOCAL_LLM_URL = os.getenv("LOCAL_LLM_URL", "https://primary-villain-parking.ngrok-free.dev/v1")
if not LOCAL_LLM_URL.endswith("/v1") and not LOCAL_LLM_URL.endswith("/api"):
    LOCAL_LLM_URL = LOCAL_LLM_URL.rstrip("/") + "/v1"
LOCAL_LLM_MODEL = os.getenv("LOCAL_LLM_MODEL", "gemma4:12b")
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None
_last_scrape_time = 0.0

def firecrawl_scrape(url: str) -> str:
    """
    Scrape the full Markdown content of any web page.
    Use this tool to extract data from target URLs.
    """
    global _last_scrape_time
    
    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        return '{"error": "FIRECRAWL_API_KEY not configured."}'
        
    db = get_db()
    if not db:
        return '{"error": "Database not available for caching."}'
        
    # Check Daily Global Limit (max 30 per day)
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    limit_ref = db.collection('system_metadata').document(f'firecrawl_usage_{today_str}')
    limit_doc = limit_ref.get()
    
    usage_count = limit_doc.to_dict().get('count', 0) if limit_doc.exists else 0
        
    limit_max = 100 if USE_LOCAL_LLM else 30
    if usage_count >= limit_max:
        return f'{{"error": "Firecrawl daily limit of {limit_max} scrapes exceeded."}}'
        
    # Check cache in market_reports
    safe_url_id = base64.urlsafe_b64encode(url.encode('utf-8')).decode('utf-8').rstrip("=")
    cache_ref = db.collection('market_reports').document(f"scrape_cache_{safe_url_id}")
    cache_doc = cache_ref.get()
    
    if cache_doc.exists:
        data = cache_doc.to_dict()
        last_scraped_str = data.get('last_scraped')
        if last_scraped_str:
            try:
                last_scraped = datetime.fromisoformat(last_scraped_str)
                if datetime.now(timezone.utc) - last_scraped < timedelta(days=7):
                    print(f"[Firecrawl] CACHE HIT for {url}")
                    return data.get('content', '')
            except Exception:
                pass
                
    # Enforce 2-second delay
    elapsed = time.time() - _last_scrape_time
    if elapsed < 2.0:
        time.sleep(2.0 - elapsed)
        
    _last_scrape_time = time.time()
    
    # Perform Scrape
    print(f"[Firecrawl] Scraping {url}...")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "url": url,
        "formats": ["markdown"]
    }
    try:
        res = requests.post("https://api.firecrawl.dev/v1/scrape", headers=headers, json=payload, timeout=30)
        if res.status_code == 200:
            res_data = res.json()
            if res_data.get('success'):
                content = res_data.get('data', {}).get('markdown', '')
                
                # Update usage limit safely using set/update
                if limit_doc.exists:
                    limit_ref.update({'count': firestore.Increment(1)})
                else:
                    limit_ref.set({'count': 1, 'date': today_str})
                    
                # Update cache
                cache_ref.set({
                    'url': url,
                    'content': content,
                    'last_scraped': datetime.now(timezone.utc).isoformat()
                })
                return content
            else:
                return f'{{"error": "Firecrawl API returned failure: {res_data}"}}'
        else:
            return f'{{"error": "Firecrawl API HTTP {res.status_code}: {res.text}"}}'
    except Exception as e:
        return f'{{"error": "{str(e)}"}}'

def parse_ebay_markdown(content: str, is_sold: bool = False) -> list:
    """Parses raw Firecrawl markdown content from eBay search results to extract structured items."""
    if not content:
        return []
        
    itm_ids = []
    seen = set()
    for m in re.finditer(r"https://(?:www\.)?ebay\.com/itm/(\d+)", content):
        itm_id = m.group(1)
        if itm_id != "123456" and itm_id not in seen:
            itm_ids.append(itm_id)
            seen.add(itm_id)
            
    listings = []
    
    for itm_id in itm_ids:
        occurrences = [m.start() for m in re.finditer(itm_id, content)]
        
        title = None
        price = None
        url = f"https://www.ebay.com/itm/{itm_id}"
        image_url = ""
        end_date = None
        
        for occ in occurrences:
            sub = content[max(0, occ - 400):occ]
            
            # Match 1: [![Title](img_url)](https://www.ebay.com/itm/
            img_match = re.search(r"\[\!\[([^\]]+)\]\(([^)]+)\)\]\((?:https?://(?:www\.)?ebay\.com)?/itm/$", sub)
            if img_match:
                title = img_match.group(1).strip()
                image_url = img_match.group(2).strip()
                title = title.replace("Opens in a new window or tab", "").strip()
                break
                
            # Match 2: [TitleOpens in a new window or tab](https://www.ebay.com/itm/
            link_match = re.search(r"\[([^\]]+)\]\((?:https?://(?:www\.)?ebay\.com)?/itm/$", sub)
            if link_match:
                candidate_title = link_match.group(1).strip()
                candidate_title = candidate_title.replace("Opens in a new window or tab", "").strip()
                if candidate_title and not candidate_title.startswith("!["):
                    title = candidate_title
                    break
        
        if not image_url:
            for occ in occurrences:
                sub = content[max(0, occ - 400):occ]
                img_match = re.search(r"\!\[([^\]]*)\]\(([^)]+)\)", sub)
                if img_match:
                    image_url = img_match.group(2).strip()
                    break

        for occ in occurrences:
            sub = content[occ:min(len(content), occ + 1200)]
            price_match = re.search(r"\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)", sub)
            if price_match:
                price_str = price_match.group(1).replace(",", "")
                try:
                    price = float(price_str)
                    break
                except ValueError:
                    pass
                    
        if is_sold:
            for occ in occurrences:
                sub = content[max(0, occ - 400):occ]
                date_match = re.search(r"Sold\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})", sub)
                if date_match:
                    month_str = date_match.group(1)
                    day_str = date_match.group(2)
                    year_str = date_match.group(3)
                    
                    months = {"Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04", "May": "05", "Jun": "06",
                              "Jul": "07", "Aug": "08", "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12"}
                    month_num = months.get(month_str[:3].capitalize(), "01")
                    day_num = f"{int(day_str):02d}"
                    end_date = f"{year_str}-{month_num}-{day_num}"
                    break

        if title and price:
            item = {
                "title": title,
                "price": price,
                "url": url,
                "image_url": image_url
            }
            if is_sold:
                item["end_date"] = end_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
            listings.append(item)
            
    return listings

from series_context_cache import (
    build_card_valuation_instruction,
    get_or_create_series_cache,
    is_context_caching_enabled,
    log_cache_usage,
    resolve_series_profile_id,
    warm_all_series_caches,
)

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


# Valuation math (canonical for /value-card) — keep in sync with src/lib/pricing-extract.ts
def parse_price_optional(val):
    """Parse a price string/number; return None if unparseable (no default)."""
    if val is None or val == "":
        return None
    if isinstance(val, (int, float)):
        num = float(val)
        return num if num > 0 else None
    if isinstance(val, str):
        raw = val.strip().lower()
        if not raw or raw in ("n/a", "null", "undefined", "none"):
            return None
        clean_str = re.sub(r'[^\d.]', '', val)
        if not clean_str:
            return None
        try:
            num = float(clean_str)
            return num if num > 0 else None
        except ValueError:
            return None
    return None


def extract_prices_from_listings(listings):
    """Extract numeric prices from active/sold listing dicts."""
    prices = []
    for item in listings or []:
        if not isinstance(item, dict):
            continue
        candidates = [
            item.get("price"),
            item.get("currentBid"),
            item.get("current_bid"),
            item.get("value"),
            item.get("amount"),
        ]
        price_obj = item.get("price")
        if isinstance(price_obj, dict):
            candidates.insert(0, price_obj.get("value"))
            candidates.insert(0, price_obj.get("amount"))

        for candidate in candidates:
            parsed = parse_price_optional(candidate)
            if parsed:
                prices.append(parsed)

        title = str(item.get("title") or "")
        title_match = re.search(r'\$\s*([\d,]+\.?\d*)', title)
        if title_match:
            parsed = parse_price_optional(title_match.group(1))
            if parsed:
                prices.append(parsed)
    return prices


def median_price(prices):
    valid = sorted([p for p in prices if p and p > 0])
    if not valid:
        return None
    mid = len(valid) // 2
    if len(valid) % 2:
        return valid[mid]
    return (valid[mid - 1] + valid[mid]) / 2


def trimmed_mean_price(prices, trim_fraction=0.1):
    valid = sorted([p for p in prices if p and p > 0])
    if not valid:
        return None
    if len(valid) < 3:
        return median_price(valid)
    trim_count = max(1, int(len(valid) * trim_fraction))
    sliced = valid[trim_count: len(valid) - trim_count]
    if not sliced:
        return median_price(valid)
    return sum(sliced) / len(sliced)


def resolve_valuation_from_listings(final_price, active_listings, sold_listings, log_prefix="AgentService"):
    """Derive price from listings when header price is missing or zero."""
    print(f"[{log_prefix}] RAW active_listings ({len(active_listings or [])}): {json.dumps((active_listings or [])[:8], default=str)}")
    print(f"[{log_prefix}] RAW sold_listings ({len(sold_listings or [])}): {json.dumps((sold_listings or [])[:8], default=str)}")

    sold_prices = extract_prices_from_listings(sold_listings)
    active_prices = extract_prices_from_listings(active_listings)
    all_prices = sold_prices + active_prices

    print(f"[{log_prefix}] Parsed sold prices: {sold_prices}")
    print(f"[{log_prefix}] Parsed active prices: {active_prices}")
    print(f"[{log_prefix}] Combined price pool ({len(all_prices)}): {all_prices}")

    header = parse_price_optional(final_price)
    if header and header > 0.01:
        print(f"[{log_prefix}] Using header price: {header}")
        return header, "header_price"

    trimmed = trimmed_mean_price(all_prices)
    if trimmed and trimmed > 0.01:
        method = "trimmed_mean_sold" if sold_prices else "trimmed_mean_active"
        print(f"[{log_prefix}] Using trimmed mean: {trimmed} ({method})")
        return round(trimmed, 2), method

    med = median_price(all_prices)
    if med and med > 0.01:
        print(f"[{log_prefix}] Using listing median fallback: {med}")
        return round(med, 2), "listing_median_fallback"

    print(f"[{log_prefix}] No parseable listing prices — fallback_unpriced")
    return 0.00, "fallback_unpriced"

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
            
    # 4. Strictly enforce list type for listing arrays
    for key in ["active_listings", "sold_listings"]:
        if not isinstance(sanitized.get(key), list):
            sanitized[key] = []
            
    # 5. Sanitize marketPrices nested lists if present
    if "marketPrices" in sanitized and isinstance(sanitized["marketPrices"], dict):
        mp = sanitized["marketPrices"]
        if "activeItems" not in mp or not isinstance(mp["activeItems"], list):
            mp["activeItems"] = sanitized["active_listings"]
        if "soldItems" not in mp or not isinstance(mp["soldItems"], list):
            mp["soldItems"] = sanitized["sold_listings"]
        # Ensure activeItems and soldItems are lists
        if not isinstance(mp.get("activeItems"), list):
            mp["activeItems"] = []
        if not isinstance(mp.get("soldItems"), list):
            mp["soldItems"] = []
            
    return sanitized

app = FastAPI()

# Valuation cache: skip Gemini + Google Search when a fresh entry exists (default 48h).
VALUATION_CACHE_TTL_SECONDS = int(os.environ.get("VALUATION_CACHE_TTL_HOURS", "48")) * 3600

# Batch sync budget guards (scheduler / globalBatchSync → /batch-sync)
BATCH_SYNC_MAX_CARDS = max(10, int(os.environ.get("BATCH_SYNC_MAX_CARDS", "60")))
BATCH_SYNC_RETRY_HOURS = max(6, int(os.environ.get("BATCH_SYNC_RETRY_HOURS", "48")))


def batch_sync_should_skip_card(data: dict) -> tuple[bool, str]:
    """
    Skip Gemini + Google Search when a zero-value card was already valued recently
    and is still in manual_review / error (avoids daily re-burn on hopeless rows).
    """
    last = data.get("lastMarketValueUpdate") or data.get("last_updated")
    if not last:
        return False, ""
    try:
        last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
        age_h = (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600
    except (TypeError, ValueError):
        return False, ""
    if age_h >= BATCH_SYNC_RETRY_HOURS:
        return False, ""
    try:
        val = float(data.get("currentMarketValue") or 0)
    except (TypeError, ValueError):
        val = 0.0
    status = str(data.get("status") or "").lower()
    if val <= 0.01 or status in ("manual_review", "error", "failed"):
        return True, f"recent_attempt_{int(age_h)}h"
    return False, ""


class ValuationRequest(BaseModel):
    userId: str
    cardId: str
    cardDetails: dict
    deepSearch: bool = False
    forceRefresh: bool = False

# Scanner / CSV flows send synthetic IDs — metadata lives in cardDetails, not Firestore.
PREVIEW_CARD_IDS = frozenset({"SCAN_PREVIEW", "CSV_IMPORT"})


def normalize_card_details(card_details: dict | None) -> dict:
    """Map scanner/API payloads into the fields value_card expects."""
    if not card_details:
        return {}
    return {
        "year": str(card_details.get("year") or "").strip(),
        "brand": str(card_details.get("brand") or card_details.get("manufacturer") or "").strip(),
        "set": str(card_details.get("set") or card_details.get("setName") or "").strip(),
        "player": str(card_details.get("player") or "").strip(),
        "cardNumber": str(
            card_details.get("cardNumber")
            or card_details.get("number")
            or card_details.get("card_number")
            or ""
        ).strip(),
        "parallel": str(card_details.get("parallel") or "").strip(),
        "grade": str(
            card_details.get("grade")
            or card_details.get("estimatedGrade")
            or card_details.get("conditionHint")
            or ""
        ).strip(),
        "gradingCompany": str(
            card_details.get("gradingCompany")
            or card_details.get("grader")
            or ""
        ).strip(),
        "currentMarketValue": card_details.get("currentMarketValue", 0),
    }

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
        # MCP Timeout: Increased to 60s as requested
        # Wrap the fetch in a 60s timeout for longer batch runs
        cards_ref = (
            db.collection_group("portfolios")
            .where("currentMarketValue", "in", [0.0, 0.01])
            .limit(BATCH_SYNC_MAX_CARDS)
        )
        try:
            cards = await asyncio.wait_for(asyncio.to_thread(lambda: list(cards_ref.stream())), timeout=60.0)
        except asyncio.TimeoutError:
            print("[BatchSync] TIMEOUT: Firestore fetch exceeded 60s limit.")
            return
        
        if not cards:
            print("[BatchSync] No cards found needing sync.")
            return

        skipped_recent = 0
        skipped_incomplete = 0
        success_count = 0
        failed_count = 0
        
        # Chunk into groups of 20
        chunk_size = 20
        for i in range(0, len(cards), chunk_size):
            chunk = cards[i:i + chunk_size]
            jsonl_lines = []
            
            for card_doc in chunk:
                data = card_doc.to_dict()
                player = data.get('player', '')
                brand = data.get('brand', '')
                year = data.get('year', '')
                
                # --- METADATA VALIDATION (SKIP INCOMPLETE) ---
                if not player or not brand or not year:
                    print(f"[BatchSync] SKIP: Incomplete metadata for {card_doc.id}")
                    skipped_incomplete += 1
                    continue

                skip, reason = batch_sync_should_skip_card(data)
                if skip:
                    skipped_recent += 1
                    print(f"[BatchSync] SKIP: {card_doc.id} ({reason})")
                    continue

                # Trigger valuation using the grounded value_card logic for precision
                try:
                    print(f"[BatchSync] Processing: {year} {brand} {player}")
                    
                    # Extract userId from path: users/{userId}/portfolios/{cardId}
                    path_parts = card_doc.reference.path.split('/')
                    if len(path_parts) >= 2 and path_parts[0] == 'users':
                        u_id = path_parts[1]
                        # We use the live value_card logic to ensure google_search tool is used
                        res = await value_card(ValuationRequest(userId=u_id, cardId=card_doc.id, cardDetails=data))
                        if res and res.get("currentMarketValue", 0) > 0.01:
                            success_count += 1
                        else:
                            failed_count += 1
                    else:
                        print(f"[BatchSync] ERROR: Could not resolve userId from path: {card_doc.reference.path}")
                        failed_count += 1
                except Exception as ve:
                    print(f"[BatchSync] Error processing card {card_doc.id}: {str(ve)}")
                    failed_count += 1
                
                # Small sleep to prevent rate limits on the search tool
                await asyncio.sleep(1.0)
            
            print(f"[BatchSync] Completed chunk {i//chunk_size}")

        print(
            f"[BatchSync] Done. max={BATCH_SYNC_MAX_CARDS} retry_cooldown={BATCH_SYNC_RETRY_HOURS}h "
            f"skipped_recent={skipped_recent} success={success_count} failed={failed_count}"
        )
        
        # --- SEND COMPLETION EMAIL REPORT ---
        api_key = os.getenv("RESEND_API_KEY")
        email_to = "mscott614@gmail.com"
        if api_key:
            try:
                print(f"[BatchSync] Dispatching batch sync completion email to {email_to}...")
                status_icon = "✅" if failed_count == 0 else "⚠️"
                today = datetime.now().strftime("%Y-%m-%d")
                
                html_content = f"""
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #1f2937; border: 1px solid #e5e7eb; border-radius: 8px; padding: 25px; background: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                    <h2 style="color: #1e3a8a; margin-top: 0; display: flex; align-items: center; gap: 8px; font-size: 20px;">
                        <span style="font-size: 24px;">{status_icon}</span> TradeValue Global Batch Sync Complete
                    </h2>
                    <p style="font-size: 14px; color: #6b7280; margin-top: -8px; margin-bottom: 20px;">Date: {today}</p>
                    <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
                    
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr style="border-bottom: 1px solid #f3f4f6;">
                            <td style="padding: 10px 0; font-weight: bold; color: #4b5563; font-size: 14px;">Total Cards Streamed:</td>
                            <td style="padding: 10px 0; text-align: right; color: #111827; font-weight: bold; font-size: 14px;">{len(cards)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f3f4f6;">
                            <td style="padding: 10px 0; color: #4b5563; font-size: 14px;">Successfully Valued:</td>
                            <td style="padding: 10px 0; text-align: right; color: #16a34a; font-weight: bold; font-size: 14px;">{success_count}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f3f4f6;">
                            <td style="padding: 10px 0; color: #4b5563; font-size: 14px;">Valuation Failed / Unpriced:</td>
                            <td style="padding: 10px 0; text-align: right; color: { '#dc2626' if failed_count > 0 else '#4b5563' }; font-weight: bold; font-size: 14px;">{failed_count}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f3f4f6;">
                            <td style="padding: 10px 0; color: #4b5563; font-size: 14px;">Skipped (Recent):</td>
                            <td style="padding: 10px 0; text-align: right; color: #6b7280; font-size: 14px;">{skipped_recent}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f3f4f6;">
                            <td style="padding: 10px 0; color: #4b5563; font-size: 14px;">Skipped (Incomplete Metadata):</td>
                            <td style="padding: 10px 0; text-align: right; color: #6b7280; font-size: 14px;">{skipped_incomplete}</td>
                        </tr>
                    </table>
                    
                    <p style="font-size: 13px; color: #4b5563; line-height: 1.5; margin-top: 15px;">
                        This sync has updated the Root collections cache and your users' portfolios in real-time. Unpriced/manual review cards have been logged.
                    </p>
                    <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 25px 0;" />
                    <p style="font-size: 11px; color: #9ca3af; text-align: center;">
                        TradeValue Automated Cloud Agent.<br/>
                        This is an automated completion email triggered by Vertex / FastAPI.
                    </p>
                </div>
                """
                
                resend.api_key = api_key
                resend.Emails.send({
                    "from": "TradeValue Sync Agent <onboarding@resend.dev>",
                    "to": email_to,
                    "subject": f"{status_icon} Daily Global Batch Sync Report — {today}",
                    "html": html_content
                })
                print("[BatchSync] Completion email dispatched successfully!")
            except Exception as se:
                print(f"[BatchSync] ERROR sending completion email: {str(se)}")
            
    except Exception as e:
        print(f"[BatchSync] Worker ERROR: {str(e)}")

@app.post("/warm-series-context-caches", status_code=202)
async def warm_series_context_caches():
    """
    Pre-create Gemini explicit context caches for high-volume series corpora.
    Call from Cloud Scheduler (e.g. daily 5 AM) or after deploy to avoid cold-cache latency.
    """
    if not is_context_caching_enabled():
        return {"status": "disabled", "message": "ENABLE_CONTEXT_CACHING is off"}
    api_key = os.environ.get("GOOGLE_GENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_GENAI_API_KEY not configured")
    client = genai.Client(api_key=api_key)
    results = warm_all_series_caches(client, db=get_db())
    return {
        "status": "ok",
        "series": results,
        "count": len(results),
    }


class AnalyzeCardBody(BaseModel):
    card: dict


def normalize_analysis_payload(raw: dict | None) -> dict:
    """Ensure CardAnalysisResult JSON shape for the Next.js compare / insights UI."""
    raw = raw or {}

    def outlook_field(key: str, allowed: tuple, default: str = "Neutral"):
        v = raw.get("investmentOutlook", {}).get(key) if isinstance(raw.get("investmentOutlook"), dict) else None
        return v if v in allowed else default

    grading = raw.get("gradingRoi") if isinstance(raw.get("gradingRoi"), dict) else {}
    grades = raw.get("gradeProbabilities") if isinstance(raw.get("gradeProbabilities"), dict) else {}
    outlook = raw.get("investmentOutlook") if isinstance(raw.get("investmentOutlook"), dict) else {}

    return {
        "gradingRoi": {
            "isRecommended": bool(grading.get("isRecommended", False)),
            "estimatedCost": float(grading.get("estimatedCost") or 30),
            "potentialValueIncreasePercent": float(grading.get("potentialValueIncreasePercent") or 0),
            "reasoning": str(grading.get("reasoning") or "Insufficient data for grading ROI."),
        },
        "gradeProbabilities": {
            "psa10_percent": float(grades.get("psa10_percent") or 0),
            "psa9_percent": float(grades.get("psa9_percent") or 0),
            "psa8_or_lower_percent": float(grades.get("psa8_or_lower_percent") or 0),
            "commonConditionIssues": str(
                grades.get("commonConditionIssues") or "Typical centering and surface issues for this era."
            ),
        },
        "investmentOutlook": {
            "shortTerm": outlook_field("shortTerm", ("Bearish", "Neutral", "Bullish")),
            "longTerm": outlook_field("longTerm", ("Bearish", "Neutral", "Bullish")),
            "riskLevel": outlook_field("riskLevel", ("Low", "Medium", "High"), "Medium"),
        },
        "historicalSignificance": str(
            raw.get("historicalSignificance")
            or "Historical context unavailable for this card."
        ),
        "comparisonMatchup": raw.get("comparisonMatchup"),
    }


@app.post("/analyze-card")
async def analyze_card_endpoint(body: AnalyzeCardBody):
    """
    Investment / grading analysis for compare tool and card insights (no eBay search).
    """
    card = body.card or {}
    api_key = os.environ.get("GOOGLE_GENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_GENAI_API_KEY not configured")

    player = str(card.get("player") or "Unknown").strip()
    year = str(card.get("year") or "").strip()
    brand = str(card.get("brand") or "").strip()
    set_name = str(card.get("set") or "").strip()
    parallel = str(card.get("parallel") or "None").strip()
    condition = str(card.get("condition") or "Unknown").strip()
    value = card.get("currentMarketValue") or 0
    grade = str(card.get("estimatedGrade") or card.get("grade") or "Raw").strip()

    prompt = f"""You are an expert sports card evaluator, historian, and investment analyst.
Analyze this card and return ONLY valid JSON (no markdown fences).

Card:
- Title: {card.get('title') or ''}
- Player: {player}
- Year: {year}
- Brand/Set: {brand} {set_name}
- Parallel: {parallel}
- Condition: {condition}
- Current market value (USD): {value}
- Estimated grade: {grade}

Cover: grading ROI ($25-$40 typical submit cost), realistic PSA 10/9/8+ probabilities for this era/set,
short/long investment outlook, and historical significance.

JSON schema:
{{
  "gradingRoi": {{
    "isRecommended": boolean,
    "estimatedCost": number,
    "potentialValueIncreasePercent": number,
    "reasoning": "string"
  }},
  "gradeProbabilities": {{
    "psa10_percent": number,
    "psa9_percent": number,
    "psa8_or_lower_percent": number,
    "commonConditionIssues": "string"
  }},
  "investmentOutlook": {{
    "shortTerm": "Bearish" | "Neutral" | "Bullish",
    "longTerm": "Bearish" | "Neutral" | "Bullish",
    "riskLevel": "Low" | "Medium" | "High"
  }},
  "historicalSignificance": "string"
}}"""

    try:
        if USE_LOCAL_LLM and OpenAI:
            openai_client = OpenAI(base_url=LOCAL_LLM_URL, api_key="ollama", default_headers={"ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true"})
            resp = openai_client.chat.completions.create(
                model=LOCAL_LLM_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            res_text = resp.choices[0].message.content or ""
        else:
            raise Exception("Gemini API calls are disabled. This application is configured to only use the local LLM.")
        parsed = robust_json_parse(res_text) if res_text else None
        if not parsed:
            raise HTTPException(status_code=502, detail="Analysis model returned unparseable JSON")
        return {"analysis": normalize_analysis_payload(parsed)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[AgentService] analyze-card failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trigger-newsletter")
async def trigger_newsletter():
    """
    Triggers the Market Analyst research loop synchronously to prevent Cloud Run scale-down.
    """
    print("[AgentService] Starting newsletter job synchronously...", flush=True)
    try:
        await asyncio.to_thread(run_newsletter_job)
        return {"status": "success", "message": "Newsletter generated and sent successfully"}
    except Exception as e:
        print(f"[AgentService] ERROR: Synchronous newsletter trigger failed: {str(e)}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sync-ebay-sheets", status_code=200)
def sync_ebay_sheets():
    """
    Triggers the headless eBay to Google Sheets sync pipeline synchronously.
    """
    try:
        print("[AgentService] Running eBay Google Sheets Sync pipeline synchronously...", flush=True)
        import ebay_sheets_sync
        ebay_sheets_sync.main()
        print("[AgentService] eBay Google Sheets Sync pipeline complete!", flush=True)
        return {"status": "success", "message": "eBay Sheets Synchronization completed successfully."}
    except Exception as e:
        print(f"[AgentService] ERROR in eBay Google Sheets Sync pipeline: {str(e)}", flush=True)
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {str(e)}")


def run_newsletter_job():
    """
    Background worker that handles the research and persistence.
    """
    try:
        print("[AgentService] Starting Background Newsletter Job...")
        agent = AgentClass()
        report_raw = agent.generate_market_report()
        
        res_json = robust_json_parse(report_raw)
        is_institutional_report = res_json and (
            "full_report_markdown" in res_json
            or "macro_market_sentiment" in res_json
            or "executive_summary" in res_json  # legacy fallback
        )
        if is_institutional_report:
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
            print(f"[AgentService] ERROR: Background newsletter job failed validation. Parsed JSON: {res_json}", flush=True)
            print(f"[AgentService] Raw report output: {report_raw[:2000]}...", flush=True)
    except Exception as e:
        print(f"[AgentService] CRITICAL: Background newsletter job failed: {str(e)}")

def _render_table_html(rows, columns):
    """Render a list of dict rows as an HTML table."""
    if not rows:
        return "<p><em>No rows available for this section.</em></p>"
    headers = columns or list(rows[0].keys())
    header_html = "".join(
        f"<th style='padding:10px; border:1px solid #ddd; text-align:left;'>{h.replace('_', ' ').title()}</th>"
        for h in headers
    )
    body_html = ""
    for row in rows:
        cells = "".join(
            f"<td style='padding:8px; border:1px solid #ddd;'>{row.get(col, '')}</td>"
            for col in headers
        )
        body_html += f"<tr>{cells}</tr>"
    return f"""
    <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
        <thead style="background-color: #f2f2f2;"><tr>{header_html}</tr></thead>
        <tbody>{body_html}</tbody>
    </table>
    """


def _markdown_to_email_html(markdown_text: str) -> str:
    """Lightweight Markdown → HTML for newsletter sections."""
    if not markdown_text:
        return ""
    html = markdown_text
    html = re.sub(r'^### (.+)$', r'<h4>\1</h4>', html, flags=re.M)
    html = re.sub(r'^## (.+)$', r'<h3>\1</h3>', html, flags=re.M)
    html = re.sub(r'^# (.+)$', r'<h2>\1</h2>', html, flags=re.M)
    html = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html)
    html = html.replace('\n---\n', '<hr style="border:none;border-top:1px solid #ccc;margin:24px 0;" />')
    html = html.replace('\n', '<br/>')
    return html





def compile_and_send_newsletter(data):
    """
    Compiles the institutional market report JSON into HTML and sends it via Resend.
    """
    api_key = os.getenv("RESEND_API_KEY")
    to_email = "mscott614@gmail.com" 
    
    if not api_key:
        print("[Newsletter] ERROR: RESEND_API_KEY is missing from environment", flush=True)
        return

    report_title = data.get(
        "report_title",
        "TradeValue Institutional Alternative-Asset Market Report",
    )
    report_date = data.get("report_date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    macro = data.get("macro_market_sentiment", {}) or {}
    velocity = data.get("high_velocity_tracker", {}) or {}
    blue_chip = data.get("blue_chip_registry", {}) or {}
    slab_raw = data.get("slab_raw_multiplier_matrix", {}) or {}

    # Institutional four-section layout (preferred)
    if data.get("full_report_markdown") or macro or velocity or blue_chip or slab_raw:
        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 720px; margin: auto; color: #1f2937; line-height: 1.5;">
            <h1 style="color: #0f172a; margin-bottom: 4px;">{report_title}</h1>
            <p style="color:#64748b; margin-top:0;">Report Date: {report_date}</p>
            <hr style="border:none;border-top:2px solid #2563eb;margin:20px 0;" />

            <h2 style="color:#1e3a8a;">1. Macro Market Sentiment &amp; Liquidity</h2>
            <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 14px;margin:12px 0;">
                <strong>Market Velocity Alert:</strong>
                {macro.get('market_velocity_alert', 'N/A')}
            </div>
            {_markdown_to_email_html(macro.get('section_markdown', ''))}
            {_render_table_html(macro.get('liquidity_metrics_table', []), ['metric', 'current_reading', 'wow_change', 'interpretation'])}

            <hr style="border:none;border-top:1px solid #cbd5e1;margin:28px 0;" />

            <h2 style="color:#1e3a8a;">2. High-Velocity Modern &amp; Prospect Tracker</h2>
            {_markdown_to_email_html(velocity.get('section_markdown', ''))}
            {_render_table_html(velocity.get('velocity_table', []), ['asset', '7d_change_pct', 'liquidity_score', 'game_to_game_note', 'catalyst'])}

            <hr style="border:none;border-top:1px solid #cbd5e1;margin:28px 0;" />

            <h2 style="color:#1e3a8a;">3. Blue-Chip &amp; Registry Asset Analysis</h2>
            {_markdown_to_email_html(blue_chip.get('section_markdown', ''))}
            {_render_table_html(blue_chip.get('registry_table', []), ['asset', 'psa10_population', 'auction_house_baseline', 'volatility_profile', 'stability_note'])}

            <hr style="border:none;border-top:1px solid #cbd5e1;margin:28px 0;" />

            <h2 style="color:#1e3a8a;">4. Slab-to-Raw Premium Multipliers Matrix</h2>
            {_markdown_to_email_html(slab_raw.get('section_markdown', ''))}
            {_render_table_html(slab_raw.get('multiplier_table', []), ['card', 'raw_median_usd', 'psa10_median_usd', 'multiplier_x', 'data_source_note'])}
        </div>
        """
    else:
        # Legacy newsletter fallback
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
            <h2>Breaking News</h2><ul>{news_items}</ul>
            <h2>Trending This Week</h2>
            <table style="width:100%; border-collapse:collapse;">
                <thead><tr><th>Card</th><th>Price</th><th>Insight</th></tr></thead>
                <tbody>{trending_rows}</tbody>
            </table>
        </div>
        """

    try:
        print(f"[Newsletter] Dispatching to {to_email}...", flush=True)
        params = {
            "from": "TradeValue Market Agent <onboarding@resend.dev>",
            "to": to_email,
            "subject": f"Weekly TradeValue Institutional Market Report — {report_date}",
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
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    }
    try:
        response = requests.get(url, headers=headers, timeout=20)
        if response.status_code != 200:
            return {"error": f"eBay returned HTTP {response.status_code}"}
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # --- STRUCTURED EXTRACTION FROM HTML ---
        # 1. Title
        title_el = soup.find('h1', class_='x-item-title__mainTitle') or soup.find('h1')
        listing_title = title_el.get_text(strip=True) if title_el else ""
        
        # 2. Price
        price_el = soup.find('div', class_='x-price-primary') or soup.find('span', {'itemprop': 'price'})
        listing_price = price_el.get_text(strip=True) if price_el else ""
        # Fallback: search for price in meta tags
        if not listing_price:
            meta_price = soup.find('meta', {'itemprop': 'price'})
            if meta_price:
                listing_price = f"${meta_price.get('content', '0')}"
        
        # 3. Condition
        condition_el = soup.find('div', class_='x-item-condition-text') or soup.find('span', {'class': 'ux-textspans', 'id': lambda x: x and 'cond' in str(x).lower()})
        listing_condition = condition_el.get_text(strip=True) if condition_el else ""
        
        # 4. Item Specifics (the table with Year, Brand, Sport, etc.)
        item_specifics = {}
        spec_sections = soup.find_all('div', class_='ux-layout-section-evo__col')
        for section in spec_sections:
            label_el = section.find('span', class_='ux-textspans--BOLD')
            value_el = section.find('span', class_='ux-textspans--SECONDARY') if label_el else None
            if not value_el:
                # Try next sibling span
                spans = section.find_all('span', class_='ux-textspans')
                if len(spans) >= 2:
                    label_el = spans[0]
                    value_el = spans[1]
            if label_el and value_el:
                key = label_el.get_text(strip=True).rstrip(':')
                val = value_el.get_text(strip=True)
                if key and val and key != val:
                    item_specifics[key] = val
        
        # 5. Seller description snippet
        desc_el = soup.find('div', {'id': 'desc_div'}) or soup.find('iframe', {'id': 'desc_ifr'})
        description_text = desc_el.get_text(strip=True)[:500] if desc_el else ""
        
        # Build structured context for Gemini
        structured_text = f"""
eBay Listing URL: {url}
LISTING TITLE: {listing_title}
PRICE: {listing_price}
CONDITION: {listing_condition}
ITEM SPECIFICS: {json.dumps(item_specifics, indent=2) if item_specifics else 'None found'}
DESCRIPTION SNIPPET: {description_text[:300] if description_text else 'N/A'}
"""
        print(f"[ExtractEbay] Structured context: {structured_text[:500]}")
        
        prompt = f"""You are an expert sports card appraiser. Extract the card metadata from this eBay listing.

{structured_text}

STRICT RULES:
1. The "player" field is the athlete or character on the card (e.g., "Wayne Gretzky", "Charizard").
2. The "brand" is the manufacturer (e.g., "Topps", "Upper Deck", "Panini", "Pokemon").
3. The "cardNumber" comes from item specifics or the title. Do NOT confuse the year with the card number.
4. If the listing mentions PSA, BGS, SGC, or CGC with a grade, set condition to that (e.g., "PSA 10"), grader to the company, and estimatedGrade to the number.
5. If NOT graded, set condition to "Raw", grader to "None".
6. Parse the actual asking price from PRICE field above.

Return ONLY a JSON object with these exact fields:
{{
  "title": "full card title",
  "player": "athlete or character name",
  "year": 2023,
  "brand": "manufacturer",
  "set": "set or series name",
  "cardNumber": "card number",
  "condition": "Raw or PSA 10 etc",
  "grader": "None or PSA/BGS/SGC/CGC",
  "estimatedGrade": "grade number or empty",
  "parallel": "parallel variant or empty",
  "features": ["Rookie", "Autograph", etc],
  "currentMarketValue": 123.45
}}"""
        
        if USE_LOCAL_LLM and OpenAI:
            openai_client = OpenAI(base_url=LOCAL_LLM_URL, api_key="ollama", default_headers={"ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true"})
            resp = openai_client.chat.completions.create(
                model=LOCAL_LLM_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            res_text = resp.choices[0].message.content or ""
        else:
            raise Exception("Gemini API calls are disabled. This application is configured to only use the local LLM.")
        
        res_json = robust_json_parse(res_text)
        if res_json:
            # Ensure price is a number
            res_json['currentMarketValue'] = clean_numeric(res_json.get('currentMarketValue'))
            # Fallback: if AI missed the price, parse it from the HTML directly
            if res_json['currentMarketValue'] <= 0.01 and listing_price:
                price_match = re.search(r'[\d,]+\.?\d*', listing_price.replace(',', ''))
                if price_match:
                    res_json['currentMarketValue'] = float(price_match.group())
            print(f"[ExtractEbay] SUCCESS: {res_json.get('player')} - ${res_json.get('currentMarketValue')}")
            return res_json
        return {"error": "Failed to extract card details from listing"}
    except Exception as e:
        print(f"[ExtractEbay] ERROR: {str(e)}")
        return {"error": str(e)}

@app.post("/value-card")
async def value_card(req: ValuationRequest):
    # Synchronized Fix: Initialize ALL variables at the absolute top
    is_graded = False
    cleaned_num = "Unknown"
    query = ""
    method_used = "direct_search"
    details = {}
    
    # Fix: Explicitly log the incoming request body
    print(f"[AgentService] Incoming valuation request: {req.json()}")
    
    docId = req.cardId
    userId = req.userId
    
    # Scanner preview / CSV import: use request body. Collection cards: load from Firestore.
    try:
        db = get_db()
        if not docId or not userId:
            raise HTTPException(status_code=400, detail="Missing required parameters (userId or cardId)")

        if docId in PREVIEW_CARD_IDS:
            details = normalize_card_details(req.cardDetails)
            print(f"[AgentService] Preview handshake for {docId}: {details.get('player')}")
        elif db:
            print(f"[AgentService] Handshake: Fetching metadata for docId: {docId}")
            doc_snap = db.collection('users').document(userId).collection('portfolios').document(docId).get(timeout=120)
            if doc_snap.exists:
                details = doc_snap.to_dict()
                print(f"[AgentService] Handshake SUCCESS: Found {details.get('player')}")
            elif req.cardDetails:
                details = normalize_card_details(req.cardDetails)
                print(f"[AgentService] Using inline cardDetails for {docId}")
            else:
                print(f"[Error] Card metadata not found for ID: {docId}")
                raise HTTPException(status_code=404, detail="Card metadata not found")
        else:
            details = normalize_card_details(req.cardDetails)
    except HTTPException:
        raise
    except Exception as fe:
        print(f"[Error] Firestore metadata fetch failed: {str(fe)}")
        raise HTTPException(status_code=500, detail=str(fe))

    required_fields = ['year', 'brand', 'player']
    missing = [f for f in required_fields if not details.get(f)]
    if missing:
        print(f"[AgentService] SKIP: Card {docId} has incomplete metadata: {missing}")
        return sanitize_firestore_payload({
            "currentMarketValue": 0.00,
            "status": "manual_review",
            "supporting_data": {"error": f"Incomplete metadata: missing {missing}"}
        })

    # --- IRONCLAD FALLBACK ---
    error_fallback = {
        "final_price": details.get('currentMarketValue', 0.00),
        "currentMarketValue": details.get('currentMarketValue', 0.00),
        "status": "manual_review",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "active_listings": [],
        "sold_listings": [],
        "supporting_data": {"error": "Search failed"},
        "query": "Manual Search Required",
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

        # 3. Universal Card Number Sanitizer
        raw_num = str(details.get('cardNumber') or details.get('number') or '').strip()
        cleaned_num = re.sub(r'^(#|No\.|No|c)+', '', raw_num, flags=re.IGNORECASE).strip()

        # 4. Player
        player = str(details.get('player', '')).strip()
        
        # 5. Parallel / Attributes (Auto, Patch, etc.)
        parallel = str(details.get('parallel', '')).strip()
        if parallel.lower() == 'base': parallel = ''
        
        # 6. Graded State (Fix: explicitly check for grader labels)
        grader_val = str(details.get('gradingCompany') or details.get('grader') or '').upper()
        grade_val = str(details.get('grade') or details.get('estimatedGrade') or '').upper()
        title_val = str(details.get('title') or '').upper()
        
        is_graded = any(x in grader_val or x in grade_val or x in title_val for x in ['PSA', 'BGS', 'SGC', 'CGC'])
        
        # If we detect a grade number (10, 9, 8.5) in a slab-like context
        if not is_graded and re.search(r'(PSA|BGS|SGC|CGC)\s*(10|9|8|7)', title_val):
            is_graded = True

        # Fix: Use cleaned player and parallel variables
        query_parts = [
            str(details.get('year') or '').strip(),
            str(details.get('brand') or '').strip(),
            str(details.get('set') or details.get('setName') or '').strip(),
            player,
            str(details.get('cardNumber') or details.get('number') or '').strip(),
            parallel
        ]
        query = sanitize_query_parts(query_parts)
        
        if is_graded:
            # Include the company and grade in search for precision
            best_grader = next((x for x in ['PSA', 'BGS', 'SGC', 'CGC'] if x in grader_val or x in title_val), "PSA")
            query += f" {best_grader} {grade_val}"
        else:
            # Per MARKET_ENGINE_SPEC.md: Use negative keywords for raw cards instead of just "raw"
            query += " -psa -bgs -sgc -cgc -graded -slab"
            
        # Per GEMINI.md: Strict filtering for reprints
        query += " -reprint -rp -copy -facsimile"
        card_desc = query
        print(f"[AgentService] Optimized Search Query: {card_desc}")
        
        # --- VALUATION CACHE (Firestore, TTL via VALUATION_CACHE_TTL_HOURS, default 48h) ---
        # Skips google_search + Gemini when hit. Bypass with forceRefresh or deepSearch.
        import hashlib
        cache_key_material = f"{card_desc}|graded={is_graded}|grader={grader_val}|grade={grade_val}"
        cache_id = hashlib.md5(cache_key_material.encode('utf-8')).hexdigest()
        skip_cache = req.forceRefresh or req.deepSearch or USE_LOCAL_LLM
        if skip_cache:
            print(f"[AgentService] CACHE BYPASS: forceRefresh={req.forceRefresh} deepSearch={req.deepSearch} USE_LOCAL_LLM={USE_LOCAL_LLM}")
        try:
            db = get_db()
            if db and not skip_cache:
                cache_ref = db.collection('valuation_cache').document(cache_id)
                cache_snap = cache_ref.get()
                if cache_snap.exists:
                    cache_data = cache_snap.to_dict()
                    cache_time_str = cache_data.get('timestamp')
                    if cache_time_str:
                        cache_time = datetime.fromisoformat(cache_time_str.replace('Z', '+00:00'))
                        age_seconds = (datetime.now(timezone.utc) - cache_time).total_seconds()
                        if age_seconds < VALUATION_CACHE_TTL_SECONDS:
                            print(
                                f"[AgentService] CACHE HIT ({int(age_seconds)}s old, "
                                f"ttl={VALUATION_CACHE_TTL_SECONDS}s): '{card_desc}'"
                            )
                            cached_payload = cache_data.get('payload')
                            fresh_now = datetime.now(timezone.utc).isoformat()
                            cached_payload['last_updated'] = fresh_now
                            if 'marketPrices' in cached_payload:
                                cached_payload['marketPrices']['lastUpdated'] = fresh_now
                            
                            try:
                                if docId:
                                    global_doc = db.collection('collections').document(docId)
                                    if global_doc.get().exists:
                                        global_doc.update(cached_payload)
                                    if userId:
                                        user_doc = db.collection('users').document(userId).collection('portfolios').document(docId)
                                        if user_doc.get().exists:
                                            user_doc.update(cached_payload)
                            except Exception as ce:
                                print(f"[AgentService] Firestore cache-hit local update failed: {str(ce)}")
                            
                            return cached_payload
        except Exception as e:
            print(f"[AgentService] Cache lookup failed (proceeding to live search): {str(e)}")

        # Method tracking
        method_used = "Gemini-3.5-Flash-Trimmed-Mean"

        # --- Gemini explicit context cache (series-level baselines) ---
        series_id = None
        cached_content_name = None
        if is_context_caching_enabled() and not skip_cache:
            series_id = resolve_series_profile_id(details)
            if series_id:
                try:
                    cache_client = genai.Client(api_key=os.environ.get("GOOGLE_GENAI_API_KEY"))
                    cached_content_name = get_or_create_series_cache(
                        cache_client, series_id, db=get_db(), tools=[firecrawl_scrape]
                    )
                    if cached_content_name:
                        method_used = "Gemini-3.5-Flash-Context-Cache"
                        print(f"[AgentService] Using series context cache: {series_id}")
                except Exception as cache_err:
                    print(f"[AgentService] Context cache unavailable: {cache_err}")

        async def attempt_run(q):
            api_key = os.environ.get("GOOGLE_GENAI_API_KEY")
            client = genai.Client(api_key=api_key)

            if cached_content_name:
                sys_inst = build_card_valuation_instruction(
                    player, cleaned_num, card_desc, series_id=series_id
                )
                # Cannot set system_instruction when using cached_content, but tools are supported/required at runtime
                q = f"{sys_inst}\n\nUSER REQUEST: {q}"
                gen_config = types.GenerateContentConfig(
                    cached_content=cached_content_name,
                    tools=[firecrawl_scrape],
                )
            else:
                sys_inst = (
                    f"You are a Senior Trading Card Valuation Analyst. Target: {player}, Card: #{cleaned_num}. "
                    "CRITICAL INSTRUCTION: You MUST use the provided `firecrawl_scrape` tool to find live and sold listings by searching for URLs. "
                    "DO NOT USE GOOGLE SEARCH GROUNDING. "
                    "VALUATION PROTOCOL: "
                    "1. STRICTLY EXCLUDE reprints, copies, or custom cards. "
                    "2. Find at least 5 active listings and 5 sold listings if possible using the tool. If no real active or sold listings are found, return an empty array [] for that field. Do NOT generate placeholder/fake listings or URLs under any circumstances. "
                    "3. If no exact title matches are found, allow minor variations (e.g., 'Series 1' vs 'S1') as long as the Year, Brand, Player, and Card Number match. "
                    "4. Calculate the median price after removing outliers. "
                    "5. RETURN FORMAT: You MUST return ONLY a JSON block with this structure: "
                    "{\"currentMarketValue\": 123.45, \"active_listings\": [{\"title\": \"...\", \"price\": 123, \"url\": \"...\", \"image_url\": \"...\"}], \"sold_listings\": [{\"title\": \"...\", \"price\": 123, \"url\": \"...\", \"image_url\": \"...\", \"end_date\": \"YYYY-MM-DD\"}]}. "
                    "CRITICAL FORMAT RULE: If no active_listings or sold_listings are found in the search results, you MUST return an empty array [] for that field. Under no circumstances should you generate dummy, placeholder, or fake listings or URLs (such as \"https://www.ebay.com/itm/123456789011\" or using \"...\" strings as values)."
                )
                gen_config = types.GenerateContentConfig(
                    system_instruction=sys_inst,
                    # tools=[types.Tool(google_search=types.GoogleSearch())],
                    tools=[firecrawl_scrape],
                )

            # Implementation of exponential backoff for 429 errors
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    print(f"[AgentService] AI Sync Attempt {attempt+1}/{max_retries} for query: {q}")
                    
                    if USE_LOCAL_LLM and OpenAI:
                        import urllib.parse
                        active_query_url = f"https://www.ebay.com/sch/i.html?_nkw={urllib.parse.quote(card_desc)}&_ipg=240"
                        sold_query_url = f"https://www.ebay.com/sch/i.html?_nkw={urllib.parse.quote(card_desc)}&LH_Sold=1&LH_Complete=1&_ipg=240"
                        
                        active_content = ""
                        sold_content = ""
                        
                        try:
                            print(f"[AgentService] Local LLM mode. Scraping active listings from: {active_query_url}")
                            active_content = firecrawl_scrape(active_query_url)
                        except Exception as se:
                            print(f"[AgentService] Active listings scrape failed: {se}")
                            
                        try:
                            print(f"[AgentService] Local LLM mode. Scraping sold listings from: {sold_query_url}")
                            sold_content = firecrawl_scrape(sold_query_url)
                        except Exception as se:
                            print(f"[AgentService] Sold listings scrape failed: {se}")
                        
                        parsed_active = parse_ebay_markdown(active_content, is_sold=False)
                        parsed_sold = parse_ebay_markdown(sold_content, is_sold=True)
                        
                        print(f"[AgentService] Parsed {len(parsed_active)} active and {len(parsed_sold)} sold candidates.")
                        
                        local_prompt = (
                            f"You are a Senior Trading Card Valuation Analyst.\n"
                            f"Target Card: {player}, Card Number: #{cleaned_num}.\n\n"
                            f"Below are candidate listings scraped from eBay for this card.\n"
                            f"Verify them and filter out any items that are reprints, copies, custom cards, different parallel versions, or do not match the target card.\n\n"
                            f"Candidate Active Listings:\n"
                            f"{json.dumps(parsed_active[:15], indent=2)}\n\n"
                            f"Candidate Sold Listings:\n"
                            f"{json.dumps(parsed_sold[:15], indent=2)}\n\n"
                            f"VALUATION PROTOCOL:\n"
                            f"1. Filter candidate listings to ensure they are exact matches for the target card.\n"
                            f"2. Keep up to 10 matching active listings and up to 10 matching sold listings.\n"
                            f"3. Calculate the median price of the matching sold listings (or active listings if no sold are found).\n"
                            f"4. RETURN FORMAT: You MUST return ONLY a JSON block with this structure:\n"
                            f"{{\n"
                            f"  \"currentMarketValue\": 123.45,\n"
                            f"  \"active_listings\": [{{\"title\": \"...\", \"price\": 123.45, \"url\": \"...\", \"image_url\": \"...\"}}],\n"
                            f"  \"sold_listings\": [{{\"title\": \"...\", \"price\": 123.45, \"url\": \"...\", \"image_url\": \"...\", \"end_date\": \"YYYY-MM-DD\"}}]\n"
                            f"}}\n"
                            f"Format instructions: Do not output markdown code blocks (like ```json) or explanation. Return ONLY the raw JSON string."
                        )
                        
                        openai_client = OpenAI(base_url=LOCAL_LLM_URL, api_key="ollama", default_headers={"ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true"})
                        try:
                            resp = openai_client.chat.completions.create(
                                model=LOCAL_LLM_MODEL,
                                messages=[
                                    {"role": "system", "content": "You are a valuation assistant that outputs raw JSON."},
                                    {"role": "user", "content": local_prompt}
                                ],
                                response_format={"type": "json_object"},
                                timeout=90.0
                            )
                            res_text = resp.choices[0].message.content or ""
                            print(f"[AgentService] Success after {attempt+1} attempts.")
                            return res_text
                        except Exception as e:
                            print(f"[AgentService] Local LLM call timed out or failed ({e}). Falling back to pure Python local valuation.")
                            filtered_active = []
                            player_words = set(player.lower().split())
                            for item in parsed_active:
                                title_lower = item['title'].lower()
                                if not any(w in title_lower for w in player_words):
                                    continue
                                if cleaned_num and cleaned_num.lower() not in title_lower:
                                    continue
                                filtered_active.append(item)
                                
                            filtered_sold = []
                            for item in parsed_sold:
                                title_lower = item['title'].lower()
                                if not any(w in title_lower for w in player_words):
                                    continue
                                if cleaned_num and cleaned_num.lower() not in title_lower:
                                    continue
                                filtered_sold.append(item)
                                
                            sold_prices = [item['price'] for item in filtered_sold if item.get('price')]
                            if sold_prices:
                                sold_prices.sort()
                                n = len(sold_prices)
                                if n % 2 == 1:
                                    current_value = sold_prices[n // 2]
                                else:
                                    current_value = (sold_prices[n // 2 - 1] + sold_prices[n // 2]) / 2.0
                            else:
                                active_prices = [item['price'] for item in filtered_active if item.get('price')]
                                if active_prices:
                                    active_prices.sort()
                                    n = len(active_prices)
                                    if n % 2 == 1:
                                        current_value = active_prices[n // 2]
                                    else:
                                        current_value = (active_prices[n // 2 - 1] + active_prices[n // 2]) / 2.0
                                else:
                                    current_value = 0.00
                                    
                            res_payload = {
                                "currentMarketValue": current_value,
                                "active_listings": filtered_active[:10],
                                "sold_listings": filtered_sold[:10]
                            }
                            return json.dumps(res_payload)
                    else:
                        raise Exception("Gemini API calls are disabled. This application is configured to only use the local LLM.")
                        log_cache_usage(response, series_id)
                    # Gemini 3.5 Flash + google_search returns multi-part responses.
                    # The JSON answer is often in a later part, after grounding chunks.
                    # We must concatenate ALL text parts to find the actual valuation JSON.
                    res_text = ""
                    if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
                        for part in response.candidates[0].content.parts:
                            if hasattr(part, 'text') and part.text:
                                res_text += part.text + "\n"
                    if not res_text:
                        res_text = response.text or ""
                    
                    if res_text:
                        print(f"[AgentService] Success after {attempt+1} attempts.")
                        return res_text
                except Exception as re:
                    error_msg = str(re)
                    if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
                        wait_time = (2 ** attempt) * 2 # 2s, 4s, 8s
                        print(f"[AgentService] Rate limit hit (429). Retrying in {wait_time}s...")
                        await asyncio.sleep(wait_time)
                    else:
                        print(f"[AgentService] ERROR in attempt {attempt+1}: {error_msg}")
                        if attempt == max_retries - 1:
                            raise re
                        await asyncio.sleep(1)
            return ""

        raw_res = await attempt_run(f"Search eBay for active and sold listings for: {card_desc}")
        print(f"[AgentService] Raw Response Preview: {raw_res[:200] if raw_res else 'EMPTY'}")
        
        res_json = robust_json_parse(raw_res)
        
        # Cascading fallback: second google_search only when primary parse fails or returns 0 (cost guard)
        # DISABLED: This was causing $0.07 per card double-billing on hard to find cards
        # if not req.deepSearch and (
        #     not res_json or res_json.get('currentMarketValue', 0) == 0 or "no results" in (raw_res or "").lower()
        # ):
        #     print(f"[AgentService] Triggering Fallback Search for {player}...")
        #     method_used = "fallback_broad_search"
        #     raw_res = await attempt_run(f"VALUE: {card_desc}. JSON.")
        #     print(f"[AgentService] Fallback Response Preview: {raw_res[:200] if raw_res else 'EMPTY'}")
        #     res_json = robust_json_parse(raw_res)
            
        if not res_json: 
            print(f"[AgentService] WARNING: JSON parse failed. Raw: {(raw_res or '')[:500]}")
            return error_fallback

        # Prepare listings for UI (Fix: Align with marketPrices structure)
        active_results = res_json.get("active_listings")
        if not isinstance(active_results, list):
            active_results = []
            
        sold_results = res_json.get("sold_listings")
        if not isinstance(sold_results, list):
            sold_results = []

        header_val = res_json.get('currentMarketValue') or res_json.get('final_price') or 0.00
        final_price, pricing_method = resolve_valuation_from_listings(
            header_val,
            active_results,
            sold_results,
            log_prefix="AgentService",
        )
        if pricing_method != "header_price":
            method_used = pricing_method

        if final_price <= 0.01:
            final_price = 0.00
            print(f"[AgentService] WARNING: No market data found for {card_desc}. Enforcing 0.00.")
        
        # Final Handshake Payload (Strictly Typed snake_case arrays)
        final_payload = sanitize_firestore_payload({
            "final_price": final_price,
            "currentMarketValue": final_price,
            "status": "market_verified" if final_price > 0.01 else "manual_review",
            "active_listings": active_results,
            "sold_listings": sold_results,
            "marketPrices": {
                "median": final_price,
                "avgSoldPrice": final_price, 
                "activeItems": active_results,
                "soldItems": sold_results,
                "lastUpdated": datetime.now(timezone.utc).isoformat()
            },
            "avg_sold_price": final_price, 
            "query": card_desc,
            "method": method_used,
            "context_cache_series": series_id,
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

        # --- VALUATION CACHE WRITE ---
        try:
            db = get_db()
            if db:
                cache_ref = db.collection('valuation_cache').document(cache_id)
                cache_ref.set({
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'query': card_desc,
                    'payload': final_payload
                })
                print(f"[AgentService] CACHE WRITE: Cached valuation for '{card_desc}'")
        except Exception as ce:
            print(f"[AgentService] Cache write failed: {str(ce)}")
 
        return final_payload

    except Exception as e:
        import traceback
        print(f"[AgentService] FATAL ERROR: {str(e)}")
        print(f"[AgentService] TRACEBACK: {traceback.format_exc()}")
        return sanitize_firestore_payload(error_fallback)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
