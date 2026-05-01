from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import asyncio
import json
import re
import os
from market_watcher_agent import AgentClass

app = FastAPI()

class ValuationRequest(BaseModel):
    userId: str
    cardId: str
    cardDetails: dict

@app.get("/health")
def health():
    return {"status": "healthy"}

class ExtractRequest(BaseModel):
    url: str

@app.post("/extract-ebay")
async def extract_ebay(req: ExtractRequest):
    import requests
    from bs4 import BeautifulSoup
    
    url = req.url
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'max-age=0',
        'Connection': 'keep-alive',
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=15)
        if response.status_code == 403:
            # Try one more time with a different UA
            headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            response = requests.get(url, headers=headers, timeout=15)
            
        if response.status_code != 200:
            return {"success": False, "error": f"eBay returned status {response.status_code}"}
            
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Extract basic info
        title = ""
        title_tag = soup.find(class_="x-item-title__mainTitle") or soup.find(id="itemTitle")
        if title_tag:
            title = title_tag.get_text().replace("Details about", "").strip()
            
        price = ""
        price_tag = soup.find(class_="x-price-primary") or soup.find(class_="x-bin-price__content")
        if price_tag:
            price = price_tag.get_text().strip()
            
        # AI Parsing
        agent_app = AgentClass(model_name='gemini-3.1-flash-lite-preview')
        agent_app.set_up()
        
        prompt = f"Parse this eBay listing into a JSON card object: Title: {title}, Price: {price}. " \
                 f"HTML Content Snippet: {response.text[:2000]}. " \
                 f"Return JSON: {{'year': '', 'brand': '', 'player': '', 'cardNumber': '', 'set': '', 'parallel': '', 'condition': '', 'grader': '', 'estimatedGrade': '', 'currentMarketValue': 0}}"
        
        full_response = ""
        async for chunk in agent_app.app.async_stream_query(message=prompt, user_id="system"):
            if hasattr(chunk, 'text'):
                full_response += chunk.text
            elif isinstance(chunk, str):
                full_response += chunk
                
        match = re.search(r'(\{[\s\S]*\})', full_response)
        if match:
            json_str = match.group(1).replace('```json', '').replace('```', '').strip()
            return json.loads(json_str)
            
        return {"title": title, "currentMarketValue": 0}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/value-card")
async def value_card(req: ValuationRequest):
    details = req.cardDetails
    user_id = req.userId
    
    # --- MIRROR STRICT QUERY PROTOCOL ---
    
    # 1. Date Expansion
    year = str(details.get('year', '')).strip()
    if re.match(r'^\d{4}$', year):
        try:
            y_int = int(year)
            next_y = (y_int + 1) % 100
            year = f"{y_int}-{next_y:02d}"
        except:
            pass

    # 2. Manufacturer / Brand / Set
    mfg = (details.get('brand') or details.get('manufacturer') or '').strip()
    set_name = (details.get('set') or details.get('setName') or '').strip()
    if mfg and set_name:
        if mfg.lower() in set_name.lower():
            brand = set_name
        elif set_name.lower() in mfg.lower():
            brand = mfg
        else:
            brand = f"{mfg} {set_name}".strip()
    else:
        brand = mfg or set_name or ''

    # Specialty Check
    specialty_keywords = ['Red Rooster', 'Foodland', 'National Hockey Day']
    for kw in specialty_keywords:
        if any(kw.lower() in str(val).lower() for val in details.values()) and kw.lower() not in brand.lower():
            brand = f"{brand} {kw}".strip()

    # 3. Card Number
    card_num = str(details.get('cardNumber') or details.get('card_number') or details.get('number') or details.get('cardNo') or '').strip()
    card_num_str = card_num if card_num else ""

    # 4. Player Name
    player = str(details.get('player', '')).strip()

    # 5. Parallel & Specialty Set Logic
    parallel = str(details.get('parallel', '')).strip()
    parallel_keywords = ['Rainbow', 'Traxx', 'Ice', 'Seismic', 'Gold', 'Emerald', 'Orange', 'Violet']
    is_platinum = any(x.lower() in brand.lower() for x in ['platinum', 'opc platinum', 'o-pee-chee platinum'])
    is_prizm_select = any(x.lower() in brand.lower() for x in ['Prizm', 'Select'])
    
    negative_filters = []
    if is_platinum or is_prizm_select:
        if is_platinum and card_num.startswith('M') and 'Marquee Rookies' not in brand:
             brand = f"{brand} Marquee Rookies".strip()
        if not parallel or parallel.lower() == 'base':
            negative_filters = [f"-{kw}" for kw in parallel_keywords]
        else:
            if parallel.lower() not in brand.lower():
                brand = f"{brand} {parallel}".strip()
            negative_filters = [f"-{kw}" for kw in parallel_keywords if kw.lower() != parallel.lower()]

    # --- IRONCLAD BASE-CARD PROTECTION ---
    if is_platinum and (not parallel or parallel.lower() == 'base'):
        # For OPC Platinum base, we MUST be aggressive. 
        # These parallels often "hide" in base searches.
        filter_str = "-rainbow -traxx -ice -retro -auto -lot -bundle"
    else:
        filter_str = " ".join(negative_filters)

    base_search = f"{year} {brand} {player} {card_num_str} {filter_str}".strip()
    base_search = re.sub(r'\s+', ' ', base_search)

    # Graded check
    grader = str(details.get('gradingCompany') or details.get('grader') or '').strip()
    grade = str(details.get('grade') or details.get('estimatedGrade') or '').strip()
    is_slab_company = bool(re.search(r'PSA|BGS|SGC|CGC|GMA|KSA|BECKETT|BCCG', grader, re.I)) or \
                      bool(re.search(r'PSA|BGS|SGC|CGC|GMA|KSA|BECKETT|BCCG', grade, re.I))
    is_raw_label = bool(re.search(r'raw|none|uncertified|null|n/a|^$', grader, re.I)) or \
                   bool(re.search(r'raw|none|n/a|^$', grade, re.I))
    is_graded = is_slab_company and not is_raw_label
    
    if is_graded:
        card_desc = f"{base_search} {grader} {grade}".strip()
        query_context = f"GRADED card: {card_desc}. Find most recent Sold BIN. If none, use Lowest Active BIN - 15%."
    else:
        # STRICT RAW ISOLATION: Exclude all graded noise
        card_desc = f"{base_search} -PSA -BGS -SGC -CGC -Graded".strip()
        query_context = f"RAW card: {card_desc}. Find recent Sold BIN for NM (ID 400010) and EX (ID 400011)."

    # EMERGENCY BRAKE: Force Platinum for M1 McDavid
    if card_num == "M1" and "McDavid" in player:
        if "platinum" not in card_desc.lower():
            card_desc = f"{card_desc} Platinum".strip()

    # YOUNG GUNS PROTECTION: Prevent confusion between Box Sets and flagship Young Guns
    if "McDavid" in player and "2015-16" in year:
        is_yg = card_num == "201" or "Young Guns" in brand
        if not is_yg:
            if "-Young" not in filter_str:
                filter_str = f"{filter_str} -Young -Guns -Canvas -Refractor".strip()
            # Re-build base_search with the new filters
            base_search = f"{year} {brand} {player} #{card_num_str} {filter_str}".strip()
            base_search = re.sub(r'\s+', ' ', base_search)
            card_desc = base_search

    # DIRECT SNIPER QUERY
    query = f"SEARCH AND VALUE: {card_desc} -lot -bundle -set. " \
            f"RULES: 1. MUST BE card #{card_num_str}. 2. MUST NOT be Young Guns. 3. BIN ONLY. 4. Return JSON."

    # BRUTE FORCE LOGGING
    print(f"!!!DIAGNOSTIC!!! Query: {query}", flush=True)
    print(f"!!!DIAGNOSTIC!!! Desc: {card_desc}", flush=True)

    # --- AGENT EXECUTION ---
    async def attempt_run(model_name):
        agent_app = AgentClass(model_name=model_name)
        agent_app.set_up()
        
        # Override system prompt to be extremely strict about JSON format
        schema_instruction = "\n\nCRITICAL: Your response MUST be valid JSON. research_results MUST be an object containing a list called 'top_listings' with at least 5 examples: {\"final_price\": 0, \"valuation_method\": \"\", \"research_results\": {\"top_listings\": [{\"title\": \"\", \"price\": 0, \"url\": \"\", \"image_url\": \"\"}]}}"
        
        full_response = ""
        async for chunk in agent_app.app.async_stream_query(message=query + schema_instruction, user_id=user_id):
            if isinstance(chunk, dict):
                if 'content' in chunk and isinstance(chunk['content'], dict):
                    parts = chunk['content'].get('parts', [])
                    for part in parts:
                        if 'text' in part:
                            full_response += part['text']
                elif 'text' in chunk:
                    full_response += chunk['text']
                elif 'actions' in chunk and chunk['actions'].get('content'):
                    full_response += chunk['actions']['content']
            else:
                text = getattr(chunk, 'text', str(chunk))
                full_response += text
        return full_response

    try:
        # Use primary model
        full_response = await attempt_run('gemini-3.1-flash-lite-preview')
    except Exception as e:
        print(f"[AgentService] Fallback triggered due to: {str(e)}")
        try:
            full_response = await attempt_run('gemini-2.5-flash')
        except Exception as e2:
            raise HTTPException(status_code=500, detail=f"Agent fallback failed: {str(e2)}")

    # Clean up and parse response
    match = re.search(r'(\{[\s\S]*\})', full_response)
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
            res_json = json.loads(json_str)
            res_json['last_search_query'] = card_desc
            
            # --- DATE SAFETY BRUTE FORCE ---
            import datetime
            today = datetime.date.today().strftime("%Y-%m-%d")
            
            if "research_results" in res_json and isinstance(res_json["research_results"], dict):
                sold_list = res_json["research_results"].get("sold_listings", [])
                if isinstance(sold_list, list):
                    for item in sold_list:
                        if "endDate" not in item or not item["endDate"]:
                            item["endDate"] = today
            # -------------------------------

            # BRUTE FORCE RESPONSE LOGGING
            print(f"!!!DIAGNOSTIC!!! Response: {json.dumps(res_json)}", flush=True)
            return res_json
        except:
            return {"error": "Failed to parse JSON", "raw": json_str}
    
    return {"error": "No JSON found in response", "raw": full_response[:1000]}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
