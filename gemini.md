# TradeValue: Project Context & AI Governance (Updated May 20, 2026)

## 🏗️ System Architecture

- **Core AI:** **Gemini 3.5 Flash** (Model ID: `gemini-3.5-flash`; standardized for high-speed tool calling, advanced parallel agentic reasoning, 1M input context, and up to 64K output token generation).
- **Tool Protocol:** Native **Google Search Grounding** (`Google Search`).
- **Backend:** Python (Flask) on **Google Cloud Run** (`market-agent`, region `us-east4`).
- **Frontend:** Next.js 14+ (App Router) on Firebase App Hosting (`tradevalue-app`, region `us-east4`).
- **Database:** Firestore (Production-ready).
- **Region:** `us-east4` for agent, Functions, and App Hosting. Cloud Run URLs may use the `-uk.a.run.app` hostname suffix even when the service region is `us-east4` — that is normal for this project; do not treat `-uk` as a UK deployment.
- **Agent URL:** Set only via Secret Manager `AGENT_SERVICE_URL` (referenced in `apphosting.yaml` and Firebase Functions). Never hardcode `run.app` URLs in application code.
- **Gemini API key:** Canonical secret is `GOOGLE_GENAI_API_KEY`. App Hosting maps it to runtime `GEMINI_API_KEY`; Functions and Cloud Run use `GOOGLE_GENAI_API_KEY` directly.
- **Resend:** `RESEND_API_KEY` in Secret Manager (Cloud Run `market-agent`); never commit or log keys.
- **Ignore hygiene:** `.gitignore`, `.geminiignore`, and `.dockerignore` exclude `.ebay_browser_context/`, build artifacts, and debug HTML.

## 📦 Shared modules (P3)

- **Canonical TS:** `src/lib/hockey-card-year.ts`, `src/lib/pricing-extract.ts`, `src/lib/ebay-pricing.ts`.
- **Functions mirror:** `functions/src/hockey-card-year.ts` and `pricing-extract.ts` are auto-copied on `functions` prebuild (`scripts/sync-shared-libs.mjs`). Do not edit the copies.
- **Valuation authority:** Python `agent_service.py` `/value-card` computes price; Firebase Functions use `valuationFromAgent()` on success and `resolveValuationFromListings()` only for eBay-only fallback.

## 🤝 The "3.5 Handshake" (Validated)

To maintain UI stability and prevent "Application Error" crashes, follow these contract rules:

1. **Initialization:** `agent_service.py` -> `value_card` must initialize variables at the absolute top of the function:
   - `is_graded = False`
   - `query = ""`
   - `method_used = "direct_search"`
2. **Payload Keys:** The backend must return:
   - **`final_price`**: Primary valuation result (synchronized with `currentMarketValue`).
   - **`query`**: The exact search string used for eBay.
   - **`method`**: The logic applied (e.g., "Trimmed Mean" or "Search Grounding").
   - **`active_listings` / `sold_listings`**: Must be an `[]` (empty array), never `null`.

## 🛡️ Security & Environment

- **Secrets:** Zero hardcoded API keys. All secrets must use `process.env.NEXT_PUBLIC_FIREBASE_*` or `os.environ`.
- **Git Hygiene:** Respect `.geminiignore` and `.gitignore` to prevent indexing of `node_modules`, `.next`, and `.env` files.

## 🔧 Operations (P5)

- **Secrets:** Run `node scripts/secrets-hygiene.mjs` to sync `GEMINI_API_KEY` ← `GOOGLE_GENAI_API_KEY`. Use `--prune` to remove unused `OPENROUTER_API_KEY`.
- **Morning refresh:** `scheduledMarketRefresh` skips cards updated within 24h (Pass B) and caps enqueues (`MAX_DAILY_REFRESH_ENQUEUES`, default 50).
- **Reports:** On-demand UI, `marketReportV2`, and weekly newsletter share `src/lib/institutional-report-prompt.ts` (synced to Functions).
- **Regions:** Agent + Functions + Vertex default `us-east4`; `ingestBatchResults` stays `us-central1` (GCS bucket locality).

## 🧑‍💻 Local development (P4)

- Copy [`.env.example`](.env.example) → `.env.local`; see [DEVELOPING.md](DEVELOPING.md) for the full matrix.
- Verify API access: `npm run check:models` (3.5 Flash → 2.5 Flash fallback; no 1.5 probe).
- Sync shared TS before Functions work: `npm run sync:libs` (also runs on `functions` prebuild).

## 💰 Cost Controls (P1)

- **`refreshMarketCardTask`**: `maxConcurrentDispatches: 2` (was 10) to cap parallel agent valuations.
- **`marketReportV2`**: Primary `gemini-3.5-flash`, fallback `gemini-2.5-flash` (not 1.5); `maxInstances: 2`.
- **Valuation cache**: Firestore `valuation_cache` with TTL `VALUATION_CACHE_TTL_HOURS` (default 48). Bypass with `forceRefresh` or `deepSearch` on `/value-card`.
- **Pro fallback**: `gemini-3.1-pro-preview` only when `ENABLE_PRO_VALUATION_FALLBACK=true` on Cloud Run (default off).

## 🧠 Context Caching & Compute Optimization

### Explicit series context caches (Native)

High-volume series (1999 Pokémon Base, late-80s OPC Hockey, modern Prizm basketball) use **Gemini explicit context caching** via `series_context_cache.py`:

- Static corpora (baselines, pop tiers, comp rules) are stored in `client.caches.create()` with TTL (`CONTEXT_CACHE_TTL`, default 6h).
- Registry persisted in Firestore `gemini_series_context_caches/{series_id}`.
- `/value-card` attaches `cached_content` when `resolve_series_profile_id()` matches; live **Google Search** still runs per card.
- Warm caches: `POST /warm-series-context-caches` (scheduler-friendly).
- Disable: `ENABLE_CONTEXT_CACHING=false`.

- **Prompt Order:** Always structure long system instructions and static repository context at the beginning of the request sequence to leverage 3.5 Flash's native context caching mechanisms.
- **Thinking Effort Strategy:** Use "Medium" or "Low" thinking effort thresholds for basic file modifications and template changes. Only escalate to "High" thinking depth when debugging complex data structures or race conditions.
- **Deduplication:** Never duplicate large arrays or structured payloads (e.g., repeating active/sold arrays inside nested `marketPrices` objects) within a single API context window to avoid unnecessary token multiplication.

## 🃏 Card Industry & Valuation Logic

- **Search Hygiene:** Always append `-reprint -rp -copy -facsimile` to all queries to filter fakes.
- **Batching:** Use **20-card chunking** for batch syncs to prevent timeouts.
- **Defensive Rendering:** Use **Optional Chaining** (`?.`) for all card data and gain/loss calculations in the frontend (specifically `[id]/page.tsx`).

## ⚙️ Operational Cleanup

- **Pointer Events:** All async save/sync functions must include a `finally` block restoring `document.body.style.pointerEvents = 'auto'`.
- **Search Protocol:** With Gemini 3.5, **do not** use `response_mime_type="application/json"` if using the search tool. Use the native `Google Search` configuration to avoid "Controlled Generation" conflicts.

## 🛑 Compute Guardrails & Execution Limits

To prevent automated "thrashing loops" and unintended compute/quota consumption under the new token model, you MUST stop and ask the user for explicit text confirmation before executing any of the following:

1. **Terminal Test Suites:** Do NOT automatically execute backend or automated test runners (`npm test`, `pytest`, etc.) unless the current prompt explicitly commands it.
2. **Deep Directory Scans:** Do NOT perform deep, recursive repository indexing or bulk file-content searches across the entire directory structure without explicit permission.
3. **Multi-File Refactors:** If a task requires modifying more than two files, present your planned step-by-step changes in text first and await user approval before making file edits.
4. **Context Preservation:** Strictly respect the `.geminiignore` file. Do not read, parse, or index large debug snapshots or raw HTML files (such as `ebay_headed_debug.html` or the `.ebay_browser_context/` folder) to prevent instant context window saturation.