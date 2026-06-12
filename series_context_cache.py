"""
Gemini explicit context caching for high-volume card series.

Caches large, static reference corpora (baselines, pop tiers, comp notes) so per-card
valuation calls only pay full input price once per TTL window — subsequent scans in
the same series reuse cached_content tokens at reduced rates.

Requires Gemini 2.5+ / 3.5 Flash and google-genai SDK caches API.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from google import genai
from google.genai import types

DEFAULT_CACHE_MODEL = os.getenv("CONTEXT_CACHE_MODEL", "models/gemini-3.5-flash")
DEFAULT_CACHE_TTL = os.getenv("CONTEXT_CACHE_TTL", "21600s")  # 6 hours
FIRESTORE_COLLECTION = "gemini_series_context_caches"

# Shared valuation JSON contract (kept in cache system instruction)
VALUATION_JSON_CONTRACT = """
RETURN FORMAT: Return ONLY a JSON object (no markdown fences) with this structure:
{
  "currentMarketValue": 123.45,
  "active_listings": [{"title": "...", "price": 123, "url": "...", "image_url": "..."}],
  "sold_listings": [{"title": "...", "price": 123, "url": "...", "image_url": "...", "end_date": "YYYY-MM-DD"}]
}
CRITICAL FORMAT RULE: If no active_listings or sold_listings are found in the search results, you MUST return an empty array [] for that field. Under no circumstances should you generate dummy, placeholder, or fake listings or URLs (such as "https://www.ebay.com/itm/123456789011" or using "..." strings as values).
"""

SERIES_BASE_INSTRUCTION = """You are the TradeValue Series Valuation Engine.
You have access to a cached institutional reference corpus for this card series (baselines, population tiers, liquidity notes).
ALWAYS use the provided `firecrawl_scrape` tool to find live and sold listings by searching for URLs.
Use the cached corpus to interpret comps, reject reprints, and anchor outliers — never skip live search.
VALUATION PROTOCOL:
1. STRICTLY EXCLUDE reprints, copies, custom cards, and lots unless the user query asks for lots.
2. Find at least 5 active and 5 sold listings when available. If no real active or sold listings are found, return an empty array [] for that field. Do NOT generate placeholder/fake listings or URLs under any circumstances.
3. Allow minor title variants (S1 vs Series 1) when year, brand, player, and card number match.
4. Prefer trimmed-median sold pricing after removing top/bottom outliers.
5. Apply series-specific baseline tables from the cached reference when judging if a comp is an outlier.
""" + VALUATION_JSON_CONTRACT


def _pokemon_1999_base_context() -> str:
    return """
# CACHED REFERENCE: 1999 Pokémon Base Set (WOTC) — TradeValue Series Corpus

## Scope
English Wizards of the Coast 1999 Base Set and Base Set 2 reprints context. Focus: holos, rares, and high-volume commons/uncommons scanned in bulk.

## Liquidity tiers (typical eBay BIN / auction, raw NM unless noted)
| Tier | Examples | Raw NM broad band (USD) | PSA 10 multiplier vs raw |
| :--- | :--- | :--- | :--- |
| S | Charizard #4/102 | 250–600+ (edition dependent) | 8x–25x |
| A | Blastoise, Venusaur, Clefairy holo | 40–120 | 5x–12x |
| B | Dragonite, Gyarados, other holos | 15–60 | 4x–10x |
| C | Rare non-holo, popular trainers | 3–25 | 3x–6x |
| Bulk | Commons/uncommons | 0.25–3 | 2x–4x |

## Population / slab notes
- PSA dominates; CGC growing on modern reholder crossovers.
- Base Set Charizard: distinguish 1st Edition, Shadowless, Unlimited — wrong bucket causes 300%+ error.
- #4/102 and #6/102 frequently mislabeled; verify stamp and shadow on OCR.

## Search hygiene (always append mentally)
-reprint -rp -copy -facsimile -custom -lot -proxy -digital

## Historical baseline anchors (Q1 2026 institutional desk — refresh via live search)
- Charizard unlimited holo raw NM: often 280–420; PSA 10: 2500–8000+ wide variance by subgrade.
- Blastoise/Venusaur holo raw: 45–90 typical cluster.
- Pikachu yellow cheeks vs red cheeks: massive spread; never mix.

## Comp rejection rules
- Graded slabs in raw query unless graded search requested.
- "Celebration" or modern reprint sets.
- Non-English unless query specifies Japanese.

## Game-to-game velocity
High-velocity: Charizard, Gengar holo, Mewtwo promo overlap listings.
Low-velocity: uncommon trainers, energy cards.

## Institutional note
This corpus is static reference only. Live Search must confirm current week comps.

## Appendix: Base Set holo checklist (1–102, WOTC 1999)
1 Alakazam | 2 Blastoise | 3 Chansey | 4 Charizard | 5 Clefairy | 6 Gyarados | 7 Hitmonchan | 8 Machamp
9 Magneton | 10 Mewtwo | 11 Nidoking | 12 Ninetales | 13 Poliwrath | 14 Raichu | 15 Venusaur | 16 Zapdos
17 Beedrill | 18 Dragonair | 19 Dugtrio | 20 Electabuzz | 21 Electrode | 22 Pidgeotto | 23 Arcanine
24 Charmeleon | 25 Dewgong | 26 Dodrio | 27 Dragonite | 28 Fearow | 29 Growlithe | 30 Haunter
31 Ivysaur | 32 Jynx | 33 Kadabra | 34 Kakuna | 35 Lickitung | 36 Machoke | 37 Magmar | 38 Nidorino
39 Poliwhirl | 40 Porygon | 41 Raticate | 42 Seel | 43 Wartortle | 44 Abra | 45 Bulbasaur
46 Caterpie | 47 Charmander | 48 Clefairy Doll | 49 Computer Search | 50 Devolution Spray
51 Imposter Professor Oak | 52 Item Finder | 53 Lass | 54 Pokémon Breeder | 55 Pokémon Trader
56 Scoop Up | 57 Super Energy Removal | 58 Defender | 59 Energy Retrieval | 60 Full Heal
61 Maintenance | 62 PlusPower | 63 Pokémon Center | 64 Pokémon Flute | 65 Pokédex | 66 Professor Oak
67 Revive | 68 Super Potion | 69 Bill | 70 Energy Removal | 71 Potion | 72 Switch | 73 Double Colorless Energy
Use checklist only for disambiguation; pricing must come from live comps.
"""


def _opc_hockey_1980s_context() -> str:
    return """
# CACHED REFERENCE: Late-1980s O-Pee-Chee / Topps Hockey — TradeValue Series Corpus

## Scope
OPC and Topps hockey 1986-87 through 1989-90 product years. Includes Gretzky #99/57 variants, Mario Lemieux rookies, Bourque, Fedorov-era precursors, and high-volume team base.

## Year / SKU disambiguation (critical)
| Card | Correct OPC season | Common OCR error |
| :--- | :--- | :--- |
| Gretzky #99 Kings white jersey | 1988-89 OPC #120 | 1979, 1980-81, 1987-88 |
| Gretzky #57 Oilers | 1980-81 OPC / Topps | 1988-89 |
| Lemieux #57 | 1985-86 OPC | mis-year |
| Bourque #1 RC | 1979-80 OPC | |

Never apply pre-1979 years to white-jersey Kings Gretzky OPC.

## Liquidity tiers (raw NM, USD bands)
| Tier | Player / card | Raw band | PSA 10 multiplier |
| :--- | :--- | :--- | :--- |
| S | Gretzky OPC #120 88-89 | 40–120 | 6x–15x |
| A | Lemieux RC, Bourque RC | 80–400+ | 5x–12x |
| B | Hawerchuk, Fedorov RC (era dependent) | 15–80 | 4x–8x |
| C | Team leaders, second-year stars | 5–30 | 3x–6x |

## Population notes
- PSA registry populations drive institutional bids on Gretzky #120 and Lemieux #57.
- OPC vs Topps: OPC often 1.5x–2.5x Topps for same player/year in Canadian markets.

## Search hygiene
-reprint -rp -copy -facsimile -custom -lot -psa -bgs -sgc -graded -slab (when raw search)

## Baseline anchors
- 1988-89 OPC Gretzky #120 raw NM: often 50–95 USD cluster; PSA 10: 400–1200+.
- Centering-sensitive; low-grade comps should not anchor NM valuation.

## Velocity
High: Gretzky #120, Lemieux RC.
Moderate: Bourque, Coffey rookies depending year.

## Institutional note
Use live eBay sold BIN for current week; this file prevents broad fallback from re-learning entire OPC taxonomy each call.

## Appendix: OPC year matrix (product structure)
1986-87 OPC: Bourque #1 RC cluster, high institutional demand.
1987-88 OPC: Gretzky Oilers #57 continuity, Lemieux second-year overlap listings.
1988-89 OPC: Gretzky Kings #120 white jersey — highest mis-OCR risk in entire hockey desk.
1989-90 OPC: transition toward early 90s rookies; thinner liquidity than 88-89 peak.
Topps parallels: generally trade at discount vs OPC except U.S. regional demand spikes.
Parkhurst and Pro Set are out-of-scope unless query explicitly names them.
When card number and player conflict with year, defer to hockey-card-year normalization rules.
"""


def _modern_prizm_basketball_context() -> str:
    return """
# CACHED REFERENCE: Modern Prizm / Select Basketball Rookies (2018–2026) — TradeValue Series Corpus

## Scope
Panini Prizm, Select, Donruss optic-class basketball rookies and sophomores. High scan volume: Wembanyama, Luka, LeBron inserts, Victor Wembanyama Prizm #275, etc.

## Liquidity / volatility
| Segment | Behavior | Pricing approach |
| :--- | :--- | :--- |
| Rookie Prizm base | High velocity, 10–40% monthly swings on hype | Trimmed mean sold, 7-day window |
| Silver / scope parallels | 3x–15x base | Match parallel string exactly |
| Color /99 /10 | Thin markets | Use top 3 sold, flag low confidence |
| Autos | Extreme variance | Require autograph match |

## Search hygiene
-presto -reprint -lot -custom -psa -bgs -sgc (raw pulls)

## Baseline multipliers (indicative)
- Base rookie raw to PSA 10: often 4x–10x for stable stars; 15x+ for hype rookies in season.
- Wembanyama Prizm base raw vs PSA 10: highly time-sensitive — live search required.

## Rejection rules
- Wrong year Prizm (2023 vs 2024).
- "Instant impact" mislabeled parallels.
- Mystery packs / repacks.

## Velocity alert pattern
Game-to-game NBA performance moves Prizm base 5–25% in 48h for rookies.

## Institutional note
Cached taxonomy only; always pull live sold listings for the exact parallel string.

## Appendix: Prizm parallel taxonomy (2018–2026)
Base Silver: most common liquidity layer.
Scope / Glitter / Shimmer: 2x–4x base for rookies.
Red/White/Blue Ice: team-color variants — never substitute for Silver comps.
/auto: on-card vs sticker; sticker autos trade at fraction of on-card.
Wembanyama 2023-24 Prizm #275 base: treat as hyper-liquid; use 14-day sold window minimum 8 comps.
Luka Dončić 2018-19 #280: stable blue-chip modern; lower monthly vol than rookies.
LeBron Prizm annual inserts: verify year on every comp — 2012 vs 2013 vs 2020 spans wide.
Always match print run on serial numbered cards (/99 /49 /25).
## Appendix: Rookie liquidity watchlist (2020–2026)
Anthony Edwards 2020-21 Prizm #258 | LaMelo Ball 2020-21 #278 | Cade Cunningham 2021-22 #282
Evan Mobley 2021-22 #224 | Paolo Banchero 2022-23 #249 | Victor Wembanyama 2023-24 #275
Cooper Flagg 2024-25 incoming hype cycle — verify product year before anchoring comps.
Sophomore-year Prizm base often re-prices 30–60% after All-Star break; widen sold window to 21 days.
Playoff elimination losses can compress Prizm bases 15% in 72 hours — flag velocity risk in output JSON notes.
International prizm (NBA Hoops cross-listings) are out of scope unless query specifies.
"""


SERIES_PROFILES: dict[str, dict[str, Any]] = {
    "pokemon_1999_base": {
        "display_name": "TradeValue | Pokemon 1999 Base Set",
        "system_instruction": SERIES_BASE_INSTRUCTION,
        "static_context": _pokemon_1999_base_context(),
        "match": lambda d: _match_pokemon_1999(d),
    },
    "opc_hockey_1980s": {
        "display_name": "TradeValue | OPC Hockey 1986-89",
        "system_instruction": SERIES_BASE_INSTRUCTION,
        "static_context": _opc_hockey_1980s_context(),
        "match": lambda d: _match_opc_hockey_1980s(d),
    },
    "modern_prizm_basketball": {
        "display_name": "TradeValue | Modern Prizm Basketball",
        "system_instruction": SERIES_BASE_INSTRUCTION,
        "static_context": _modern_prizm_basketball_context(),
        "match": lambda d: _match_modern_prizm_basketball(d),
    },
}


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _match_pokemon_1999(details: dict) -> bool:
    brand = _norm(str(details.get("brand") or details.get("manufacturer") or ""))
    set_name = _norm(str(details.get("set") or details.get("setName") or ""))
    year = _norm(str(details.get("year") or ""))
    title = _norm(str(details.get("title") or ""))
    blob = f"{brand} {set_name} {year} {title}"
    if "pokemon" in blob or "pokémon" in blob:
        return True
    if "base set" in blob and ("1999" in year or "1999" in blob):
        return True
    if re.search(r"\b(1st|first)\s*edition\b", blob) and "charizard" in blob:
        return True
    return False


def _match_opc_hockey_1980s(details: dict) -> bool:
    brand = _norm(str(details.get("brand") or details.get("manufacturer") or ""))
    year = _norm(str(details.get("year") or ""))
    if not re.search(r"198[6-9]", year) and "198" not in year:
        # Also match known OPC Gretzky #120 without year in OCR
        player = _norm(str(details.get("player") or ""))
        num = _norm(str(details.get("cardNumber") or details.get("number") or ""))
        if "gretzky" in player and "120" in num:
            return True
        return False
    if any(x in brand for x in ("o-pee-chee", "opc", "topps", "parkhurst")):
        return True
    if "hockey" in _norm(str(details.get("set") or "")):
        return True
    return "gretzky" in _norm(str(details.get("player") or ""))


def _match_modern_prizm_basketball(details: dict) -> bool:
    brand = _norm(str(details.get("brand") or details.get("manufacturer") or ""))
    set_name = _norm(str(details.get("set") or details.get("setName") or ""))
    year = _norm(str(details.get("year") or ""))
    if not re.search(r"20(1[89]|2[0-6])", year):
        return False
    blob = f"{brand} {set_name}"
    return any(
        k in blob
        for k in (
            "prizm",
            "select",
            "donruss",
            "optic",
            "mosaic",
            "nba",
            "basketball",
        )
    )


def is_context_caching_enabled() -> bool:
    if os.getenv("USE_LOCAL_LLM") == "true":
        return False
    return os.getenv("ENABLE_CONTEXT_CACHING", "true").lower() in ("1", "true", "yes")


def resolve_series_profile_id(details: dict) -> Optional[str]:
    """Return series profile id if card maps to a cached corpus."""
    if not details:
        return None
    # Priority: hockey OPC > pokemon > modern basketball (avoid cross-match)
    order = ("opc_hockey_1980s", "pokemon_1999_base", "modern_prizm_basketball")
    for sid in order:
        if SERIES_PROFILES[sid]["match"](details):
            return sid
    return None


def _parse_expire_time(expire_time: Any) -> Optional[datetime]:
    if not expire_time:
        return None
    if isinstance(expire_time, datetime):
        return expire_time if expire_time.tzinfo else expire_time.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(expire_time).replace("Z", "+00:00"))
    except ValueError:
        return None


def get_or_create_series_cache(
    client: genai.Client,
    series_id: str,
    db=None,
    tools: list = None,
    log_prefix: str = "ContextCache",
) -> Optional[str]:
    """
    Return Gemini cached_content resource name for series_id, creating or refreshing as needed.
    """
    if series_id not in SERIES_PROFILES:
        return None

    profile = SERIES_PROFILES[series_id]
    model = DEFAULT_CACHE_MODEL
    ttl = DEFAULT_CACHE_TTL

    if db is not None:
        doc_ref = db.collection(FIRESTORE_COLLECTION).document(series_id)
        snap = doc_ref.get()
        if snap.exists:
            data = snap.to_dict() or {}
            cache_name = data.get("cache_name")
            expire_dt = _parse_expire_time(data.get("expire_time"))
            if cache_name and expire_dt and expire_dt > datetime.now(timezone.utc):
                print(f"[{log_prefix}] HIT Firestore registry for {series_id} -> {cache_name}")
                return cache_name

    print(f"[{log_prefix}] Creating Gemini explicit cache for {series_id} (ttl={ttl})...")
    try:
        cache = client.caches.create(
            model=model,
            config=types.CreateCachedContentConfig(
                display_name=profile["display_name"],
                system_instruction=profile["system_instruction"],
                tools=tools,
                contents=[profile["static_context"]],
                ttl=ttl,
            ),
        )
    except Exception as e:
        print(f"[{log_prefix}] CREATE failed for {series_id}: {e}")
        return None

    cache_name = cache.name
    expire_time = getattr(cache, "expire_time", None)
    usage = getattr(cache, "usage_metadata", None)
    total_tokens = getattr(usage, "total_token_count", None) if usage else None

    print(
        f"[{log_prefix}] CREATED {series_id}: {cache_name} "
        f"tokens={total_tokens} expire={expire_time}"
    )

    if db is not None:
        db.collection(FIRESTORE_COLLECTION).document(series_id).set(
            {
                "cache_name": cache_name,
                "model": model,
                "display_name": profile["display_name"],
                "expire_time": str(expire_time) if expire_time else None,
                "total_token_count": total_tokens,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            merge=True,
        )

    return cache_name


def build_card_valuation_instruction(
    player: str,
    cleaned_num: str,
    card_desc: str,
    series_id: Optional[str] = None,
) -> str:
    """Per-request instruction (small — large series body lives in cached_content)."""
    series_note = (
        f"Series cache active: {series_id}. Use cached baselines for outlier detection.\n"
        if series_id
        else ""
    )
    return (
        f"{series_note}"
        f"You are valuing ONE card. Target player: {player}, card number: #{cleaned_num}.\n"
        f"Optimized eBay query context: {card_desc}\n"
        "Use Google Search for live active and sold eBay listings for this exact card.\n"
        + VALUATION_JSON_CONTRACT
    )


def log_cache_usage(response: Any, series_id: Optional[str], log_prefix: str = "ContextCache") -> None:
    """Log cached token counts from usage_metadata when present."""
    if not series_id or not response:
        return
    meta = getattr(response, "usage_metadata", None)
    if not meta:
        return
    cached = getattr(meta, "cached_content_token_count", None)
    prompt = getattr(meta, "prompt_token_count", None)
    if cached is not None:
        print(
            f"[{log_prefix}] series={series_id} cached_content_token_count={cached} "
            f"prompt_token_count={prompt}"
        )


def warm_all_series_caches(client: genai.Client, db=None) -> dict[str, str]:
    """Pre-create caches for all defined series (scheduler / manual warm)."""
    results = {}
    for series_id in SERIES_PROFILES:
        name = get_or_create_series_cache(client, series_id, db=db)
        if name:
            results[series_id] = name
    return results
