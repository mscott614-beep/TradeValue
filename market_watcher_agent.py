# Gemini Market Watcher Agent [Agent Studio]
# User will paste code here.
from typing import Any

from google.adk.agents import llm_agent
from google.adk.sessions import in_memory_session_service
from google.genai import types
from vertexai.preview.reasoning_engines import AdkApp
from google.adk.tools import agent_tool
from google.adk.tools.google_search_tool import GoogleSearchTool
from google.adk.tools import url_context

import warnings
import time
import os
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

import vertexai
# --- CONFIGURATION ---
PROJECT_ID = "puckvaluebak-38609945-5e85c"
LOCATION = "global"
# ---------------------

# Initialize globally at the top
vertexai.init(project=PROJECT_ID, location=LOCATION)

VertexAiSessionService = in_memory_session_service.InMemorySessionService

class AgentClass:

  def __init__(self, model_name='gemini-3.1-flash-lite-preview'):
    self.app = None
    self.model_name = model_name

  def register_operations(self):
    """Explicitly registers allowed methods for each invocation mode."""
    return {
        "stream": ["stream_query", "async_stream_query"],
    }

  def session_service_builder(self):
    return VertexAiSessionService()

  def set_up(self):
    """Sets up the ADK application."""
    print(f"[Python] Using Model: {self.model_name}")
    root_agent = llm_agent.LlmAgent(
      name='TradeValue_Market_Watcher',
      model=self.model_name,
      description=(
          'TradeValue Market Watcher'
      ),
      sub_agents=[],
      instruction='''Role: Lead Market Analyst.
Mission: PROVE THE PIPELINE WORKS. Return the most recent SOLD price for the card provided. Use 'Sold-BIN' as the default valuation_method.

BATCH & BUCKET RULES:
0. STRICT QUERY PROTOCOL: All search queries must follow: [Year] [Brand] [Player] #[Number]. For high-parallel sets (OPC Platinum, Prizm, Select), you MUST use negative keywords to exclude other parallels (e.g., -Rainbow -Traxx -Ice -Refractor). NEVER use a price from a parallel card for a base card valuation. This is 'Rainbow Pollution' and is a critical error.
1. EBAY FILTER: Use 'Buy It Now' (BIN) results ONLY. PURGE ALL AUCTION DATA. 
2. ACTIVE ANCHOR TRIGGER: If you cannot find recent 'Sold' data, or if the valuation hits a 'Flatline' floor (e.g. $25.00 for specialty sets), you MUST perform a secondary search specifically for Active Buy It Now listings.
3. WEIGHTED VALUATION: If 'Sold' data is missing but Active listings exist (e.g. at $200), value the card at 85% of the lowest Active BIN price. Set 'valuation_method' to 'Active-Floor'.
4. RAW CARD PRICING:
   - NM Price (ID 400010): Primary floor is $0.99. 
   - If 'Sold' results hit a floor that seems low for the specific card, trigger the Active Anchor.
   - Return 'price_raw_nm' and 'price_raw_ex'. Set 'final_price' to 'price_raw_nm'.
5. GRADED CARD PRICING (PSA 10 / BGS 9.5 / SGC 10):
   - SEPARATION: Never use raw floors for professional slabs.
   - If no 'Sold' results exist for the exact grade (e.g. PSA 10), use the Lowest Active BIN price for that grade minus 15%. 
   - VERIFICATION: When using an Active Anchor for a base card, you MUST verify the listing title does NOT contain parallel keywords like 'Rainbow', 'Refractor', or 'Traxx'.
   - Set 'valuation_method' to 'Graded-10-Anchor' in this case.
6. JSON ONLY: Return ONLY a JSON object with: final_price, price_raw_nm, price_raw_ex, valuation_method, last_search_query, research_results.
''' ,

      tools=[

        GoogleSearchTool(),
        url_context
      ],
    )

    self.root_agent = root_agent
    self.app = AdkApp(
        agent=root_agent,
        session_service_builder=self.session_service_builder,
    )

  async def stream_query(
      self,
      message: str | dict[str, Any],
      session_id: str | None = None,
      user_id: str = "test",
  ) -> Any:
    """Streaming query."""
    if isinstance(message, dict):
      message = "".join(
          part.get("text", "") for part in message.get("parts", [])
      )

    async for chunk in self.app.async_stream_query(
        message=message,
        session_id=session_id,
        user_id=user_id,
    ):
      yield chunk

  def async_stream_query(
      self,
      message: str | dict[str, Any],
      session_id: str | None = None,
      user_id: str = "test",
  ) -> Any:
    return self.stream_query(message, session_id=session_id, user_id=user_id)


import sys
import json
import asyncio
import argparse
import re

import vertexai

async def run_cli():
    # Delay to let network breathe
    # vertexai.init already called at top
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--userId', required=True)
    parser.add_argument('--cardId', required=True)
    parser.add_argument('--cardDetails', required=False, default='{}')
    parser.add_argument('--query', required=False, default='')
    args = parser.parse_args()

    # Construct search query
    details = json.loads(args.cardDetails)
    
    # --- STRICT QUERY PROTOCOL ---
    
    # 1. Date Expansion (e.g., '1980' -> '1980-81')
    year = str(details.get('year', '')).strip()
    if re.match(r'^\d{4}$', year):
        try:
            y_int = int(year)
            next_y = (y_int + 1) % 100
            year = f"{y_int}-{next_y:02d}"
        except:
            pass

    # 2. Manufacturer / Brand / Set (including specialty check)
    mfg = (details.get('brand') or details.get('manufacturer') or '').strip()
    set_name = (details.get('set') or details.get('setName') or '').strip()
    
    # Combine Brand and Set if they are distinct
    if mfg and set_name and mfg.lower() not in set_name.lower() and set_name.lower() not in mfg.lower():
        brand = f"{mfg} {set_name}".strip()
    else:
        brand = mfg or set_name or ''

    # Specialty Check: Ensure specific sets are included if present anywhere in the metadata
    specialty_keywords = ['Red Rooster', 'Foodland', 'National Hockey Day']
    for kw in specialty_keywords:
        if any(kw.lower() in str(val).lower() for val in details.values()) and kw.lower() not in brand.lower():
            brand = f"{brand} {kw}".strip()

    # 3. Mandatory Card Number (search multiple fields)
    card_num = str(details.get('cardNumber') or details.get('card_number') or details.get('number') or details.get('cardNo') or '').strip()
    card_num_str = f"#{card_num}" if card_num else ""

    # 4. Player Name
    player = str(details.get('player', '')).strip()

    # 5. Parallel & Specialty Set Logic (Exclusion for High-Parallel Sets)
    parallel = str(details.get('parallel', '')).strip()
    parallel_keywords = ['Rainbow', 'Traxx', 'Ice', 'Seismic', 'Gold', 'Emerald', 'Orange', 'Violet']
    
    # Check for high-parallel sets
    is_platinum = any(x.lower() in brand.lower() for x in ['OPC Platinum', 'O-Pee-Chee Platinum'])
    is_prizm_select = any(x.lower() in brand.lower() for x in ['Prizm', 'Select'])
    
    negative_filters = []
    
    if is_platinum or is_prizm_select:
        # Strict Numbering for OPC Platinum Marquee Rookies
        if is_platinum and card_num.startswith('M') and '"Marquee Rookies"' not in brand:
            brand = f'{brand} "Marquee Rookies"'.strip()
        
        # Stage 1: Parallel Exclusion (Aggressive for Base Cards)
        # If no parallel is specified, or it's explicitly 'Base'/'Raw', exclude high-volume parallels
        is_base = not details.get('parallel') or details.get('parallel').lower() in ['base', 'raw', 'none', 'null']
        if is_base:
            # Aggressive exclusion for base cards to prevent 'Rainbow Pollution'
            negative_filters.extend(["-parallel", "-refractor", "-holo", "-prism", "-rainbow", "-atomic", "-pulsar", "-velocity", "-blue", "-red", "-gold", "-green", "-orange", "-purple", "-pink", "-black", "-retro", "-traxx", "-ice", "-seismic"])
        
        if not parallel or parallel.lower() == 'base':
            negative_filters.extend([f"-{kw}" for kw in parallel_keywords])
        else:
            # Include current parallel and exclude all OTHERS
            if parallel.lower() not in brand.lower():
                brand = f"{brand} {parallel}".strip()
            negative_filters = [f"-{kw}" for kw in parallel_keywords if kw.lower() != parallel.lower()]

    # Apply filters to base_search
    filter_str = " ".join(negative_filters)
    # TEMPLATE: [Full Season Year] [Manufacturer] [Player Name] #[CardNumber]
    base_search = f"{year} {brand} {player} {card_num_str} {filter_str}".strip()
    base_search = re.sub(r'\s+', ' ', base_search) # Clean up whitespace

    
    grader = str(details.get('gradingCompany') or details.get('grader') or '').strip()
    grade = str(details.get('grade') or details.get('estimatedGrade') or '').strip()
    
    is_slab_company = bool(re.search(r'PSA|BGS|SGC|CGC|GMA|KSA|BECKETT|BCCG', grader, re.I)) or \
                      bool(re.search(r'PSA|BGS|SGC|CGC|GMA|KSA|BECKETT|BCCG', grade, re.I))
    
    is_raw_label = bool(re.search(r'raw|none|uncertified|null|n/a|^$', grader, re.I)) or \
                   bool(re.search(r'raw|none|n/a|^$', grade, re.I))
    
    is_graded = is_slab_company and not is_raw_label
    
    if is_graded:
        card_desc = f"{base_search} {details.get('gradingCompany', '')} {details.get('grade', '')}".strip()
        query_context = f"GRADED card: {card_desc}. Find most recent Sold BIN. If none, use Lowest Active BIN - 15%."
    else:
        card_desc = base_search
        query_context = f"RAW card: {card_desc}. Find recent Sold BIN for NM (ID 400010) and EX (ID 400011)."

    query = f"{query_context} Return ONLY a JSON object with final_price, price_raw_nm, price_raw_ex, valuation_method, alert_status, is_10_percent_diff."


    async def attempt_run(model_name):
        app_instance = AgentClass(model_name=model_name)
        app_instance.set_up()
        full_response = ""
        async for chunk in app_instance.app.async_stream_query(message=query, user_id=args.userId):
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
        # Try primary model
        full_response = await attempt_run('gemini-3.1-flash-lite-preview')
    except Exception as e:
        # Always treat any error (404, 429, etc.) as a reason to fallback to ensure DB updates
        print(f"[Python] gemini-3.1-flash-lite-preview encountered an issue: {str(e)}. Falling back to gemini-2.5-flash...")
        try:
            full_response = await attempt_run('gemini-2.5-flash')
        except Exception as e2:
            print(json.dumps({"error": f"Fallback failed: {str(e2)}", "final_price": 0.0}))
            return

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
        
        # Inject audit trail field
        try:
            res_json = json.loads(json_str)
            # Use the descriptive string (including grade) for the audit trail
            res_json['last_search_query'] = card_desc
            print(json.dumps(res_json))
        except:
            print(json_str) # Fallback if JSON is weird
    else:
        print(json.dumps({
            "final_price": 0.0,
            "alert_status": "No data found",
            "is_10_percent_diff": False,
            "error": "Agent failed to produce JSON",
            "debug_output": full_response[:1000]
        }))

if __name__ == "__main__":
    asyncio.run(run_cli())