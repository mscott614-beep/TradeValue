# Gemini Market Watcher Agent [Agent Studio]
# User will paste code here.
from typing import Any

from google.adk.agents import llm_agent
from google.adk.sessions import in_memory_session_service
from google import genai
from google.genai import types
from google.adk.apps import App as AdkApp
from google.adk.tools import url_context

def search_market_data(query: str):
    """Search the live web for card auction results and market trends."""
    return None # The Gemini 2.5/3 engine handles the actual grounding

import warnings
import time
import os
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# --- CONFIGURATION ---
PROJECT_ID = os.getenv("PROJECT_ID", "puckvaluebak-38609945-5e85c")
LOCATION = os.getenv("LOCATION", "us-central1") # Standardizing to central1 as requested
# ---------------------

# Initialize Google Gen AI Client for Vertex AI
client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)

VertexAiSessionService = in_memory_session_service.InMemorySessionService

import datetime

class AgentClass:

  def __init__(self, model_name='gemini-1.5-flash'):
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
    
    # Modern Tooling for Sync Agent
    search_tool = types.Tool(google_search=types.GoogleSearch())
    
    agent_instance = self.model_name
    root_agent = llm_agent.LlmAgent(
      name='MarketSyncAgent',
      agent=agent_instance,
      tools=[search_market_data]
    )

    self.root_agent = root_agent
    self.app = AdkApp(
        agent=root_agent,
        session_service_builder=self.session_service_builder,
    )

  def generate_market_report(self):
    """
    Performs research using Google Gen AI SDK and returns a structured market report.
    """
    current_month = datetime.datetime.now().strftime("%B %Y")
    
    try:
        # Modern Tooling
        search_tool = types.Tool(google_search=types.GoogleSearch())
        
        prompt = f"""
        You are a professional Market Analyst for TradeValue.
        
        Perform research on these topics using your 'Google Search' ability. Specifically for the 2015-16 O-Pee-Chee Platinum Connor McDavid, you MUST prioritize recent eBay Sold listings for PSA 10 graded copies to capture the true slabbed premium:
        1. 'upcoming {current_month} card releases'
        2. 'top 5 trending sports card sales this week'
        3. 'trading card market sentiment 2026'
        
        STRICT OUTPUT FORMAT (JSON ONLY):
        {{
          "executive_summary": "Concise overview...",
          "breaking_news": ["Headline 1", "Headline 2"],
          "trending_table": [{{"card": "...", "price": "...", "trend_insight": "..."}}],
          "drop_calendar": [{{"product_name": "...", "release_date": "..."}}]
        }}
        """
        
        print(f"[MarketAnalyst] Starting research for {current_month}...")
        
        # Refactored Generate Call using Google Gen AI SDK
        # Calibrate configuration based on model tier
        if '3.1-pro' in self.model_name:
            config = types.GenerateContentConfig(
                tools=[search_tool], 
                temperature=1.0,
                thinking_level='medium'
            )
        else:
            config = types.GenerateContentConfig(tools=[search_tool], temperature=1.0)
            
        response = client.models.generate_content(
            model=self.model_name,
            contents=prompt,
            config=config
        )
        
        if not response or not response.text:
            raise ValueError("Empty response from model")
            
        return response.text
        
    except Exception as e:
        print(f"[MarketAnalyst] Report generation failed or throttled: {str(e)}")
        # Graceful fallback: return a basic cached-style structure
        return json.dumps({
            "executive_summary": "Market data is currently being updated. Please check back in a few minutes.",
            "breaking_news": ["Market systems refreshing..."],
            "trending_table": [],
            "drop_calendar": [],
            "error": f"Search tool throttled or unavailable: {str(e)}"
        })

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

async def run_cli():
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
    base_search = f"{year} {brand} {player} {card_num_str} {filter_str}".strip()
    base_search = re.sub(r'\s+', ' ', base_search)
    card_desc = base_search
    # YOUNG GUNS PROTECTION: Prevent confusion between Box Sets and flagship Young Guns
    if "McDavid" in player and "2015-16" in year:
        is_yg = card_num == "201" or "Young Guns" in brand
        if not is_yg:
            if "-Young" not in filter_str:
                filter_str = f"{filter_str} -Young -Guns -Canvas -Refractor".strip()
            # Re-build base_search with the new filters
            base_search = f"{year} {brand} {player} {card_num_str} {filter_str}".strip()
            base_search = re.sub(r'\s+', ' ', base_search)
            card_desc = base_search

    # DIRECT SNIPER QUERY
    query = f"SEARCH AND VALUE: {card_desc} -lot -bundle -set. " \
            f"RULES: 1. MUST BE card #{card_num_str}. 2. MUST NOT be Young Guns. 3. BIN ONLY. 4. Return JSON."

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
        # Tier 1: Use stable primary model (gemini-2.5-flash)
        full_response = await attempt_run('gemini-2.5-flash')
    except Exception as e:
        # Tier 2 Fallback: Attempt Reasoning Upgrade
        print(f"[Python] gemini-2.5-flash issue: {str(e)}. Attempting Tier 2 calibration...")
        try:
            full_response = await attempt_run('gemini-3.1-pro-preview')
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