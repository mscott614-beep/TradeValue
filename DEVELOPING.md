# TradeValue — local development

## Quick start

1. **Node 22** (matches `package.json` engines).

2. **Environment**
   ```bash
   cp .env.example .env.local
   ```
   Fill at minimum:
   - `GOOGLE_GENAI_API_KEY` or `GEMINI_API_KEY` (same Google AI Studio / GCP key)
   - `NEXT_PUBLIC_FIREBASE_*` from the Firebase console
   - `AGENT_SERVICE_URL` — canonical agent URL (see `gemini.md`)

3. **Install & run**
   ```bash
   npm install
   npm run dev
   ```
   App: http://localhost:9002

4. **Verify Gemini**
   ```bash
   npm run check:models
   ```
   Uses `gemini-3.5-flash`, then `gemini-2.5-flash` if primary fails (no 1.5 probe).

## Secret naming (do not mix up)

| Surface | Env var | Secret Manager ID |
|---------|---------|-------------------|
| Next.js / App Hosting | `GEMINI_API_KEY` | `GOOGLE_GENAI_API_KEY` (aliased in `apphosting.yaml`) |
| Firebase Functions | `GOOGLE_GENAI_API_KEY` | `GOOGLE_GENAI_API_KEY` |
| Cloud Run `market-agent` | `GOOGLE_GENAI_API_KEY` | `GOOGLE_GENAI_API_KEY` |
| Agent URL (all callers) | `AGENT_SERVICE_URL` | `AGENT_SERVICE_URL` |
| Newsletter email | `RESEND_API_KEY` | `RESEND_API_KEY` |

`src/ai/genkit.ts` accepts `GOOGLE_GENAI_API_KEY || GEMINI_API_KEY`.

## Firebase Functions

Shared libs are copied before build:

```bash
npm run sync:libs          # manual
cd functions && npm run build   # runs prebuild sync automatically
```

Edit canonical sources only:

- `src/lib/hockey-card-year.ts`
- `src/lib/pricing-extract.ts`
- `src/lib/ebay-pricing.ts`
- `src/lib/arbitrage.ts`

Do **not** hand-edit `functions/src/hockey-card-year.ts`, `pricing-extract.ts`, `ebay-pricing.ts`, or `arbitrage.ts` (auto-generated).

### Slab-to-raw arbitrage scanner

- **Function:** `scheduledArbitrageScan` — 8:30 AM & 8:30 PM America/New_York (`us-east4`).
- **Firestore:** `arbitrage_signals` (auth read; Functions write only).
- **UI:** Market Hub → **Arbitrage** tab, or `/market/arbitrage`.
- **Env (optional):** `ARBITRAGE_SIGNAL_TTL_HOURS` (default `48`).

Deploy:

```bash
npx firebase deploy --only functions --project puckvaluebak-38609945-5e85c
```

## Cloud Run agent

```bash
gcloud run deploy market-agent --source . --region us-east4 --project puckvaluebak-38609945-5e85c
```

Valuation authority: Python `agent_service.py` `/value-card`. Functions use `valuationFromAgent()` on success; TS `resolveValuationFromListings()` is **eBay fallback only**.

### Gemini series context caching

For heavy scan categories (Pokémon 1999 Base, OPC hockey 1986–89, modern Prizm NBA), the agent pre-caches large reference corpora:

```bash
curl -X POST "$AGENT_SERVICE_URL/warm-series-context-caches"
```

Env: `ENABLE_CONTEXT_CACHING`, `CONTEXT_CACHE_TTL` (default `21600s`). Firestore collection: `gemini_series_context_caches`.

## Secret Manager hygiene

```bash
node scripts/secrets-hygiene.mjs          # sync GEMINI_API_KEY alias from canonical key
node scripts/secrets-hygiene.mjs --prune  # also delete unused OPENROUTER_API_KEY
```

Canonical Gemini secret: **`GOOGLE_GENAI_API_KEY`**. App Hosting runtime `GEMINI_API_KEY` reads that secret via `apphosting.yaml`.

After changing `apphosting.yaml`, trigger a new App Hosting rollout and verify Firebase console → App Hosting → Environment does not override secrets with stale values.

## Useful scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next.js dev server |
| `npm run check:models` | Test Gemini API key + models |
| `npm run sync:libs` | Copy `src/lib` → `functions/src` |
| `npm run typecheck` | TypeScript check (app) |
| `node scripts/secrets-hygiene.mjs` | GCP secret sync / audit |
| `node functions/list-queues.js` | List task queues (`us-east4`) |

## More context

- AI / architecture rules: [`gemini.md`](gemini.md)
- Agent instructions: [`AGENTS.md`](AGENTS.md) (repo parent) / workspace rules
