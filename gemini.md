# TradeValue: Project Context & AI Governance (Updated May 8, 2026)

## 🏗️ System Architecture

- **Core AI:** **Gemini 3.5 Flash** (GA release; standardized for high-speed tool calling, advanced agentic reasoning, and long-horizon tasks).
- **Tool Protocol:** Native **Google Search Grounding** (`google_search`).
- **Backend:** Python (Flask) on **Google Cloud Run** (`market-agent`).
- **Frontend:** Next.js 14+ (App Router).
- **Database:** Firestore (Production-ready).
- **Region:** `us-east4` (Vertex AI & Cloud Run alignment).

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

## 🃏 Card Industry & Valuation Logic

- **Search Hygiene:** Always append `-reprint -rp -copy -facsimile` to all queries to filter fakes.
- **Batching:** Use **20-card chunking** for batch syncs to prevent timeouts.
- **Defensive Rendering:** Use **Optional Chaining** (`?.`) for all card data and gain/loss calculations in the frontend (specifically `[id]/page.tsx`).

## ⚙️ Operational Cleanup

- **Pointer Events:** All async save/sync functions must include a `finally` block restoring `document.body.style.pointerEvents = 'auto'`.
- **Search Protocol:** With Gemini 2.5/3.5, **do not** use `response_mime_type="application/json"` if using the search tool. Use the native `google_search` configuration to avoid "Controlled Generation" conflicts.
