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
LOCATION = os.getenv("LOCATION", "us-east4")  # Align with Cloud Run + Firebase Functions
# ---------------------

# Lazy Google Gen AI Client for Vertex AI (prevents block-hangs during local imports)
_client = None
def get_vertex_client():
    global _client
    if _client is None:
        try:
            print("[MarketWatcher] Initializing Vertex AI Client...")
            _client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
        except Exception as e:
            print(f"[MarketWatcher] Warning: Vertex AI client failed: {e}")
            return None
    return _client


VertexAiSessionService = in_memory_session_service.InMemorySessionService

import datetime

class AgentClass:

  def __init__(self, model_name='gemini-3.5-flash'):
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
    
    agent_instance = self.model_name
    root_agent = llm_agent.LlmAgent(
      name='MarketSyncAgent',
      model=agent_instance,
      tools=[search_market_data]
    )

    self.root_agent = root_agent
    self.app = AdkApp(
        name='MarketWatcherApp',
        root_agent=root_agent,
    )

  def generate_market_report(self):
    """
    Performs research using Google Gen AI SDK and returns an institutional-grade
    alternative-asset market report (JSON + embedded Markdown sections).
    """
    current_month = datetime.datetime.now().strftime("%B %Y")
    report_date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")

    INSTITUTIONAL_REPORT_SCHEMA = """
{
  "report_title": "TradeValue Institutional Alternative-Asset Market Report",
  "report_date": "YYYY-MM-DD",
  "full_report_markdown": "Complete Markdown report with --- between major sections",
  "macro_market_sentiment": {
    "market_velocity_alert": "High-frequency transactional velocity summary",
    "liquidity_metrics_table": [
      {"metric": "string", "current_reading": "string", "wow_change": "string", "interpretation": "string"}
    ],
    "section_markdown": "Markdown body for Section 1"
  },
  "high_velocity_tracker": {
    "section_markdown": "Markdown body for Section 2",
    "velocity_table": [
      {"asset": "string", "7d_change_pct": "string", "liquidity_score": "string", "game_to_game_note": "string", "catalyst": "string"}
    ]
  },
  "blue_chip_registry": {
    "section_markdown": "Markdown body for Section 3",
    "registry_table": [
      {"asset": "string", "psa10_population": "string", "auction_house_baseline": "string", "volatility_profile": "string", "stability_note": "string"}
    ]
  },
  "slab_raw_multiplier_matrix": {
    "section_markdown": "Markdown body for Section 4",
    "multiplier_table": [
      {"card": "string", "raw_median_usd": "number|string", "psa10_median_usd": "number|string", "multiplier_x": "number|string", "data_source_note": "string"}
    ]
  }
}
"""

    try:
        # Modern Tooling
        # Google Search Grounding disabled due to high cost. Use custom tools instead.
        # search_tool = types.Tool(google_search=types.GoogleSearch())

        system_instruction = f"""You are the TradeValue Institutional Research Desk (Gemini 3.5 Flash).
Author an institutional-grade ALTERNATIVE-ASSET market report for high-net-worth collectors and allocators.

DO NOT write a broad, generic macro blog post. DO NOT open with vague market commentary.
Use provided data and tools to ground all pricing in recent eBay sold/active comps and auction house baselines.

Reporting period: {current_month} (report date: {report_date}).

MANDATORY REPORT ARCHITECTURE — produce ALL four sections in `full_report_markdown` using clean Markdown,
with explicit horizontal rules (`---`) between each major section, and Markdown tables for all pricing arrays.

## 1. Macro Market Sentiment & Liquidity
- Institutional tone: liquidity regimes, bid-ask behavior, capital flows in sports cards/TCG as alternative assets.
- REQUIRED subsection: **Market Velocity Alert** — summarize high-frequency transactional data, sell-through speed,
  and whether velocity is accelerating or decelerating week-over-week.

## 2. High-Velocity Modern & Prospect Tracker
- Group highly liquid, volatile performers (active rookie hype, playoff breakout stars e.g. Wembanyama, Skenes, elite modern prospects).
- Emphasize game-to-game value swings and short holding-period liquidity.

## 3. Blue-Chip & Registry Asset Analysis
- Segment low-volatility, long-term portfolio anchors (e.g. Mickey Mantle, Wayne Gretzky, LeBron James).
- Focus on population caps (PSA/BGS/SGC), registry scarcity, and auction-house baseline tracking (Goldin, PWCC, Heritage).

## 4. Slab-to-Raw Premium Multipliers Matrix
- Explicitly compare raw listings vs PSA 10 (or top grade) for the same card using recent market data.
- Express each relationship as a clear numerical multiplier (e.g. "PSA 10 copies command a 20x premium over raw equivalents").
- Populate `multiplier_table` with numeric multipliers derived from cited medians.

FORMATTING RULES:
- `full_report_markdown` must include all four section headings exactly as numbered above.
- Place `---` on its own line between sections 1-2, 2-3, and 3-4.
- Every pricing array field in JSON must also appear as a Markdown table in the relevant section.
- Use concise, data-dense prose suitable for a weekly institutional newsletter."""

        prompt = f"""Generate this week's institutional alternative-asset market report for TradeValue subscribers.

Research using provided tools or context. Prioritize:
- High-velocity modern rookies and breakout performers with measurable weekly price deltas
- Blue-chip registry assets with population and auction baseline references
- Recent eBay sold BIN data to build raw vs PSA 10 multiplier math (show your medians)

Return JSON ONLY matching this schema (no extra keys, no markdown fences outside JSON values):
{INSTITUTIONAL_REPORT_SCHEMA}

Set report_date to "{report_date}".
Ensure multiplier_x values are computed from stated raw_median_usd and psa10_median_usd when possible."""

        print(f"[MarketAnalyst] Starting institutional report for {current_month}...")
        
        use_local_llm = os.getenv("USE_LOCAL_LLM") == "true"
        local_llm_url = os.getenv("LOCAL_LLM_URL", "https://primary-villain-parking.ngrok-free.dev/v1")
        local_llm_model = os.getenv("LOCAL_LLM_MODEL", "gemma4:26b")

        if use_local_llm:
            try:
                from openai import OpenAI
            except ImportError:
                raise Exception("openai package not installed but USE_LOCAL_LLM is true")
            
            openai_client = OpenAI(base_url=local_llm_url, api_key="ollama")
            print(f"[MarketAnalyst] Using Local Model for report: {local_llm_model}")
            
            resp = openai_client.chat.completions.create(
                model=local_llm_model,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            res_text = resp.choices[0].message.content or ""
        else:
            # Use API key client — proven path with gemini-3.5-flash.
            # The Vertex AI client has region/grounding compatibility issues with 3.5 Flash.
            api_key = os.environ.get("GOOGLE_GENAI_API_KEY")
            if api_key:
                report_client = genai.Client(api_key=api_key)
            else:
                report_client = get_vertex_client()  # Fall back to module-level Vertex AI client

            config = types.GenerateContentConfig(
                temperature=0.25,
                system_instruction=system_instruction,
            )
                
            response = report_client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=config
            )
            
            # Gemini 3.5 Flash + google_search returns multi-part responses.
            # The JSON answer is often in a later part, after grounding chunks.
            # We must concatenate ALL text parts to find the actual report JSON.
            res_text = ""
            if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, 'text') and part.text:
                        res_text += part.text + "\n"
            if not res_text:
                res_text = response.text or ""

            
        if not res_text:
            raise ValueError("Empty response from model")
            
        # Self-Healing JSON Pipeline: Verify and repair JSON output if corrupted
        import re
        import json
        
        json_match = re.search(r'(\{[\s\S]*\})', res_text)
        is_valid = False
        if json_match:
            try:
                json.loads(json_match.group(1).replace('```json', '').replace('```', '').strip())
                is_valid = True
            except:
                pass
                
        if not is_valid:
            print("[MarketAnalyst] JSON was invalid or corrupted. Running repair model...")
            repair_prompt = f"""You are a JSON repair tool. Repair the corrupted string into valid JSON matching this institutional report schema exactly.

SCHEMA:
{INSTITUTIONAL_REPORT_SCHEMA}

CORRUPTED JSON STRING TO REPAIR:
{res_text}"""
            
            repair_response = report_client.models.generate_content(
                model=self.model_name,
                contents=repair_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.0
                )
            )
            res_text = repair_response.text
            
        return res_text
        
    except Exception as e:
        print(f"[MarketAnalyst] Report generation failed or throttled: {str(e)}")
        # Graceful fallback: return a basic cached-style structure
        return json.dumps({
            "report_title": "TradeValue Institutional Alternative-Asset Market Report",
            "report_date": report_date,
            "full_report_markdown": (
                "# TradeValue Institutional Alternative-Asset Market Report\n\n"
                "Market data is currently being updated. Please check back shortly.\n\n---\n"
                "*Systems refresh in progress*"
            ),
            "macro_market_sentiment": {
                "market_velocity_alert": "Data refresh in progress.",
                "liquidity_metrics_table": [],
                "section_markdown": "Liquidity metrics unavailable during refresh."
            },
            "high_velocity_tracker": {
                "section_markdown": "Velocity tracker unavailable during refresh.",
                "velocity_table": []
            },
            "blue_chip_registry": {
                "section_markdown": "Registry analysis unavailable during refresh.",
                "registry_table": []
            },
            "slab_raw_multiplier_matrix": {
                "section_markdown": "Multiplier matrix unavailable during refresh.",
                "multiplier_table": []
            },
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
        max_retries = 3
        
        use_local_llm = os.getenv("USE_LOCAL_LLM") == "true"
        local_llm_url = os.getenv("LOCAL_LLM_URL", "https://primary-villain-parking.ngrok-free.dev/v1")
        local_llm_model = os.getenv("LOCAL_LLM_MODEL", "gemma4:26b")

        for attempt in range(max_retries):
            try:
                if use_local_llm:
                    try:
                        from openai import AsyncOpenAI
                    except ImportError:
                        raise Exception("openai package not installed but USE_LOCAL_LLM is true")
                    
                    openai_client = AsyncOpenAI(base_url=local_llm_url, api_key="ollama")
                    print(f"[Python] Using Local Model: {local_llm_model}")
                    resp = await openai_client.chat.completions.create(
                        model=local_llm_model,
                        messages=[{"role": "user", "content": query}],
                        response_format={"type": "json_object"}
                    )
                    if resp and resp.choices and resp.choices[0].message.content:
                        return resp.choices[0].message.content
                    return ""
                else:
                    api_key = os.environ.get("GOOGLE_GENAI_API_KEY")
                    if api_key:
                        client = genai.Client(api_key=api_key)
                    else:
                        client = get_vertex_client()

                    config = types.GenerateContentConfig(
                        # google_search tool removed to comply with cost and grounding policies
                        temperature=0.0
                    )
                
                print(f"[Python] Using Model: {model_name}")
                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=query,
                    config=config
                )
                
                if response and response.text:
                    return response.text
                return ""
            except Exception as e:
                error_msg = str(e)
                if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
                    wait_time = (2 ** attempt) * 2
                    print(f"[Python] Rate limit hit (429). Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    if attempt == max_retries - 1:
                        raise e
                    await asyncio.sleep(1)
        return ""

    enable_pro_fallback = os.environ.get("ENABLE_PRO_VALUATION_FALLBACK", "").lower() in (
        "1", "true", "yes",
    )

    try:
        # Tier 1: Use stable primary model (gemini-3.5-flash)
        full_response = await attempt_run('gemini-3.5-flash')
    except Exception as e:
        if not enable_pro_fallback:
            print(f"[Python] gemini-3.5-flash failed and pro fallback disabled: {str(e)}")
            print(json.dumps({"error": f"Valuation failed: {str(e)}", "final_price": 0.0}))
            return
        # Tier 2 (opt-in only): expensive reasoning model — set ENABLE_PRO_VALUATION_FALLBACK=true
        print(f"[Python] gemini-3.5-flash issue: {str(e)}. Attempting Tier 2 calibration (opt-in)...")
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