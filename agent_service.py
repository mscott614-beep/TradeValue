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
    if mfg and set_name and mfg.lower() not in set_name.lower() and set_name.lower() not in mfg.lower():
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
    card_num_str = f"#{card_num}" if card_num else ""

    # 4. Player Name
    player = str(details.get('player', '')).strip()

    # 5. Parallel & Specialty Set Logic
    parallel = str(details.get('parallel', '')).strip()
    parallel_keywords = ['Rainbow', 'Traxx', 'Ice', 'Seismic', 'Gold', 'Emerald', 'Orange', 'Violet']
    is_platinum = any(x.lower() in brand.lower() for x in ['OPC Platinum', 'O-Pee-Chee Platinum'])
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
        card_desc = base_search
        query_context = f"RAW card: {card_desc}. Find recent Sold BIN for NM (ID 400010) and EX (ID 400011)."

    query = f"{query_context} Return ONLY a JSON object with final_price, price_raw_nm, price_raw_ex, valuation_method, alert_status, is_10_percent_diff."

    # --- AGENT EXECUTION ---
    async def attempt_run(model_name):
        agent_app = AgentClass(model_name=model_name)
        agent_app.set_up()
        full_response = ""
        async for chunk in agent_app.app.async_stream_query(message=query, user_id=user_id):
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
            return res_json
        except:
            return {"error": "Failed to parse JSON", "raw": json_str}
    
    return {"error": "No JSON found in response", "raw": full_response[:1000]}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
