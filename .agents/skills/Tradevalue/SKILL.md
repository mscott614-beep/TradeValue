Visual Identity
Primary Palette: Dark Mode strictly. Background: #0a0a0a. Accents: Emerald Green (#10b981) for gains, Rose Red (#f43f5e) for losses.

Components: All UI elements must use Tailwind CSS.

Ticker Component: Use the animate-marquee utility. Ensure it is fixed at bottom-0 and has a z-index of 50+.

📊 Data Architecture (Firebase)
Collection: market_prices

Document Schema: { cardId: string, currentPrice: number, change24h: number, lastUpdated: timestamp }

Subscription Pattern: Use onSnapshot for real-time dashboard updates to ensure the ticker reflects live trade values.

🛠️ Developer Rules
Efficiency: Prioritize TOON notation for data passing.

Safety: Never hardcode Firebase API keys; always reference the initialized firebase-config.js.

Optimization: When building the dashboard ticker, implement a "Virtual Scroll" if the card list exceeds 50 items to save client-side memory.
