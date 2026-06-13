import os
import sys
import re
import argparse
from google.cloud import firestore

PROJECT_ID = "puckvaluebak-38609945-5e85c"
SERVICE_ACCOUNT_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "service-account.json")

# List of sequential number strings commonly used in hallucinated/placeholder URLs
SEQUENTIAL_PATTERNS = [
    '123456789', '23456789', '3456789', '4567890', 
    '5678901', '6789012', '7890123', '8901234',
    '12345678', '23456788', # extra check for shorter variants
    '112233445566', '223344556677', # double repeating placeholder patterns
    '33445566', '44556677', '55667788', '66778899' # extra repeating pairs
]

def is_placeholder_url(url: str) -> bool:
    if not url:
        return False
    url_str = str(url).strip()
    
    # Check if any sequential pattern matches
    for pattern in SEQUENTIAL_PATTERNS:
        if pattern in url_str:
            return True
            
    # Also check if it's literally just "..." or empty hashes
    if url_str in ("#", "...", ""):
        return True
        
    return False

def clean_listings_array(listings: list, field_name: str, card_title: str) -> tuple[list, int]:
    if not isinstance(listings, list):
        return [], 0
        
    cleaned = []
    removed_count = 0
    for item in listings:
        if not isinstance(item, dict):
            cleaned.append(item)
            continue
            
        url = item.get("url", "")
        if is_placeholder_url(url):
            removed_count += 1
            print(f"    [REMOVE] Placeholder in {field_name}: '{item.get('title')}' -> URL: {url}")
        else:
            cleaned.append(item)
            
    return cleaned, removed_count

def process_document(doc_ref, data: dict, execute: bool) -> int:
    path = doc_ref.path
    card_title = data.get("title", "Untitled")
    
    # Fields to clean
    active = data.get("active_listings", [])
    sold = data.get("sold_listings", [])
    market_prices = data.get("marketPrices", {})
    
    new_active, act_removed = clean_listings_array(active, "active_listings", card_title)
    new_sold, sold_removed = clean_listings_array(sold, "sold_listings", card_title)
    
    mp_changed = False
    new_mp_active = []
    new_mp_sold = []
    
    if isinstance(market_prices, dict):
        mp_active = market_prices.get("activeItems", [])
        mp_sold = market_prices.get("soldItems", [])
        
        new_mp_active, mp_act_removed = clean_listings_array(mp_active, "marketPrices.activeItems", card_title)
        new_mp_sold, mp_sold_removed = clean_listings_array(mp_sold, "marketPrices.soldItems", card_title)
        
        if mp_act_removed > 0 or mp_sold_removed > 0:
            mp_changed = True
            
    total_removed = act_removed + sold_removed + (mp_act_removed if mp_changed else 0) + (mp_sold_removed if mp_changed else 0)
    
    if total_removed > 0:
        print(f"  Document: {path} ('{card_title}') - Removed {total_removed} placeholder(s)")
        
        if execute:
            updates = {
                "active_listings": new_active,
                "sold_listings": new_sold
            }
            if mp_changed:
                # Copy marketPrices and update inner lists to preserve other keys like median, avgSoldPrice
                updated_market_prices = dict(market_prices)
                updated_market_prices["activeItems"] = new_mp_active
                updated_market_prices["soldItems"] = new_mp_sold
                updates["marketPrices"] = updated_market_prices
                
            doc_ref.update(updates)
            print(f"    [SUCCESS] Document updated in database.")
            
        return 1
    return 0

def main():
    parser = argparse.ArgumentParser(description="Cleanup placeholder/dummy listings in Firestore database.")
    parser.add_argument("--execute", action="store_true", help="Perform real writes to the database. Without this flag, script runs in dry-run mode.")
    args = parser.parse_args()
    
    execute = args.execute
    if not execute:
        print("=== DRY RUN MODE: No changes will be written to the database ===")
    else:
        print("=== EXECUTION MODE: Updates will be written to the database ===")
        
    try:
        if os.path.exists(SERVICE_ACCOUNT_PATH):
            db = firestore.Client.from_service_account_json(SERVICE_ACCOUNT_PATH)
        else:
            db = firestore.Client(project=PROJECT_ID)
            
        print("Connected to Firestore. Starting scan...")
        
        modified_portfolios = 0
        modified_collections = 0
        
        # 1. Scan User Portfolios
        print("\nScanning user portfolios...")
        # Since they are nested in users/{userId}/portfolios, we stream all via collection_group
        portfolios_ref = db.collection_group("portfolios")
        portfolio_docs = list(portfolios_ref.stream())
        print(f"Found {len(portfolio_docs)} total portfolios across all users.")
        
        for doc in portfolio_docs:
            data = doc.to_dict()
            if process_document(doc.reference, data, execute):
                modified_portfolios += 1
                
        # 2. Scan Global Collections Cache
        print("\nScanning global collections cache...")
        collections_ref = db.collection("collections")
        collection_docs = list(collections_ref.stream())
        print(f"Found {len(collection_docs)} global collections documents.")
        
        for doc in collection_docs:
            data = doc.to_dict()
            if process_document(doc.reference, data, execute):
                modified_collections += 1
                
        print("\n=== Cleanup Job Summary ===")
        print(f"User Portfolios modified: {modified_portfolios}")
        print(f"Global Collections modified: {modified_collections}")
        print(f"Total documents updated: {modified_portfolios + modified_collections}")
        
    except Exception as e:
        print(f"CRITICAL ERROR during cleanup: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
