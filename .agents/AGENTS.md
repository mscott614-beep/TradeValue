# TradeValue Workspace Rules

- **Local LLM Preference**: Always keep the local LLM proxy enabled (`USE_LOCAL_LLM=true` in `.env.local`) for card valuations. Do not disable it or switch back to the direct Gemini API for local valuation runs, regardless of how long the local LLM inference takes.
