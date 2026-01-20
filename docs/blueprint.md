# **App Name**: TradeValue

## Core Features:

- AI Card Scanner: Upload a hockey card image, trigger a Firebase Cloud Function that sends the image to Vertex AI (Gemini) for identification, and automatically save the metadata (year, brand, player, card_number, estimated_grade) to the user's portfolio.
- Smart Portfolio Dashboard: Display a dashboard showing 'Total Portfolio Value', '24h Change', and 'Top Gainers'.
- Value History Chart: Implement a chart using recharts showing portfolio value history over 6 months.
- Auction Watchlist: Create a 'Watchlist' feature for tracking live auctions (mocked from eBay/Goldin) and add a visual indicator for 'Win Probability' on active auctions. LLM serves as a tool for predicting win probabilities.
- Price Alerts: Implement a setting for 'Price Alerts' (e.g., 'Notify me if Gretzky RC drops below $500').
- User Authentication: Implement Firebase Authentication with Google & Email/Password login.
- Responsive Layout: Ensure the design is fully responsive for mobile devices.

## Style Guidelines:

- Use a dark background (#121212) to create a premium/investor feel.
- Primary color: Electric blue (#7DF9FF) to reflect innovation and real-time value changes.
- Accent color: Analogous cyan (#00FFFF) to provide clear highlights and call to actions.
- Body and headline font: 'Inter', a sans-serif font for a modern, machined, objective feel.
- Implement a sidebar navigation with links: Dashboard, Collection, Scanner, Market, Alerts.
- Use Lucide React icons for a clean and consistent look.
- Use subtle transitions and animations to enhance user experience.