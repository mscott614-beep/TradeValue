# Market Engine Specification (Lead Data Architect)

This document is the **Ground Truth** for the TradeValue pricing engine. Any modifications to the eBay search or valuation logic *must* adhere to this specification.

## Core Objective
Generate precise eBay API search queries to determine the current market value of sports cards using **Active Listings** only, specifically targeting the "Market Floor."

---

## Step 1: Classification Logic
Analyze input card details for **Feature Keywords**:
- `Silver, Prizm, Refractor, Holo, /#, Auto, Patch, Color/Mojo variants, Young Guns, Canvas, Jumbo, Glossy`.

**Routing:**
1. If NO features found: Route to **Base Card Logic**.
2. If features found: Route to **Parallel Logic**.

---

## Step 2: Search String Construction
Construct the `q` (query) parameter for the eBay Browse API:

### Base Card Query
- Format: `{Year} {Brand} {Player} {Card #} -parallel -refractor -silver -prizm -auto -jersey -patch`
- **Mandatory**: Use negative keywords to exclude high-value parallels and noise.

### Parallel Query
- Format: `{Year} {Brand} {Player} {Specific Feature} {Card #} -sold -completed`
- **Mandatory**: The specific feature name (e.g., "Silver Prizm") must be included.

---

## Step 3: API Request Configuration
- **API Endpoint**: `item_summary/search`
- **Filter**: `buyingOptions:{FIXED_PRICE|AUCTION}`
- **FieldGroups**: `EXTENDED` (Mandatory to see listing types).
- **Sort**: `price` (Ascending) — Aim to find the "Market Floor."
- **Limit**: 10

---

## Step 4: Value Calculation (The TradeValue Rule)
When processing the API response:

1. **Fixed Price Priority**: Prioritize `FIXED_PRICE` listings over `AUCTIONS` to avoid low-bid noise.
2. **Identify the Floor**: Select the **3 lowest-priced** Fixed Price listings that match criteria.
3. **Outlier Protection**: Discard any listing that is **>50% lower** than the average of others (reprints/digital scams).
4. **Final TradeValue**: The **Median** of the remaining "Floor Pool" items (typically 3).

---

## Anchoring & Safety
- **Unit Tests**: All logic must be validated by `src/lib/ebay-pricing.test.ts`. 
- **Environment**: Must strictly use `production` eBay environment for live valuations.
- **Persistence**: Database writes must use the **Admin SDK** to ensure atomic, authorized updates.
