# TradeValue

Sports card portfolio manager with Gemini 3.5 Flash valuation, eBay market data, and Firebase (App Hosting + Functions + Cloud Run).

## Stack

- **Frontend:** Next.js (App Router) on Firebase App Hosting
- **API / valuation:** Python `market-agent` on Cloud Run
- **Background jobs:** Firebase Functions (`us-east4`)
- **Data:** Firestore

## Development

See **[DEVELOPING.md](DEVELOPING.md)** for local setup, env vars, and deploy commands.

See **[gemini.md](gemini.md)** for AI model conventions, cost controls, and shared-module rules.

## Environment template

Copy [`.env.example`](.env.example) to `.env.local` before running locally.
