import os
import sys
import csv
import re
import time
import urllib.parse
import gspread
from datetime import datetime
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv

# Load local environment variables from .env
load_dotenv()

# Google Sheets Configuration
SERVICE_ACCOUNT_FILE = "service-account.json"
TARGET_SHEET_NAME = "TradeValue_Daily_Report"
FALLBACK_CSV_NAME = "TradeValue_Daily_Report.csv"
SHARE_EMAIL = "mscott614@gmail.com"  # Shared from agent_service.py

# Directory to store user browser cookies/session persistently
USER_DATA_DIR = os.path.join(os.getcwd(), ".ebay_browser_context")

def sync_to_google_sheets(data_by_query):
    """Programmatically writes parsed eBay data straight to Google Sheets."""
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]
    
    try:
        if os.path.exists(SERVICE_ACCOUNT_FILE):
            print(f"[Google Sheets] Authenticating using service account file '{SERVICE_ACCOUNT_FILE}'...", flush=True)
            creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
            gc = gspread.authorize(creds)
            print(f"[Google Sheets] Authenticated successfully. Service Account Email: {creds.service_account_email}", flush=True)
        else:
            print("[Google Sheets] Credential file 'service-account.json' not found.", flush=True)
            print("[Google Sheets] Authenticating using ambient GCP Service Account credentials...", flush=True)
            import google.auth
            creds, project = google.auth.default(scopes=scopes)
            gc = gspread.authorize(creds)
            
            # Auto-detect service account email
            sa_email = "103832809240-compute@developer.gserviceaccount.com"
            try:
                import urllib.request
                req = urllib.request.Request(
                    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
                    headers={"Metadata-Flavor": "Google"}
                )
                with urllib.request.urlopen(req, timeout=3) as response:
                    sa_email = response.read().decode("utf-8").strip()
            except Exception:
                pass
            print(f"[Google Sheets] Authenticated ambiently. Share sheet with: {sa_email}", flush=True)
        
        # Open or create spreadsheet
        try:
            print(f"[Google Sheets] Attempting to open '{TARGET_SHEET_NAME}'...", flush=True)
            sh = gc.open(TARGET_SHEET_NAME)
        except gspread.SpreadsheetNotFound:
            print(f"[Google Sheets] Spreadsheet '{TARGET_SHEET_NAME}' not found. Creating a new one...", flush=True)
            sh = gc.create(TARGET_SHEET_NAME)
            
            try:
                sh.share(SHARE_EMAIL, perm_type="user", role="writer")
                print(f"[Google Sheets] Spreadsheet shared with {SHARE_EMAIL}.", flush=True)
            except Exception as se:
                print(f"[Google Sheets] WARNING: Could not share spreadsheet: {str(se)}", flush=True)

        # Get all existing worksheets
        existing_worksheets = sh.worksheets()
        
        # Determine the first active tab name
        first_query = data_by_query[0]["query"]
        first_tab_title = re.sub(r'[\\/:\?\*\[\]]', '', first_query)[:30].strip()
        if not first_tab_title:
            first_tab_title = "Search 1"
            
        # Rename the first worksheet to a temporary dummy name to avoid naming collisions
        first_ws = existing_worksheets[0]
        first_ws.update_title("__temp_overwrite__")
        first_ws.clear()
        print(f"[Google Sheets] Initialized first tab with temporary name", flush=True)
        
        # Delete all other worksheets in the spreadsheet to guarantee a complete overwrite
        for old_ws in existing_worksheets[1:]:
            try:
                sh.del_worksheet(old_ws)
                print(f"[Google Sheets] Removed old tab: '{old_ws.title}'", flush=True)
                time.sleep(1.5)  # Rate limit mitigation for old tab deletions
            except Exception as de:
                print(f"[Google Sheets] Skipping deletion of tab '{old_ws.title}': {str(de)}", flush=True)
                
        # Now rename the temporary sheet to the first tab's title (no collision possible)
        first_ws.update_title(first_tab_title)
        print(f"[Google Sheets] Renamed first tab to: '{first_tab_title}'", flush=True)

        # Process each saved search
        for index, item in enumerate(data_by_query):
            query = item["query"]
            listings = item["listings"]
            
            # Sanitize tab name: max 30 chars, no forbidden characters
            tab_title = re.sub(r'[\\/:\?\*\[\]]', '', query)[:30].strip()
            if not tab_title:
                tab_title = f"Search {index+1}"
            
            worksheet = None
            if index == 0:
                worksheet = first_ws
            else:
                print(f"[Google Sheets] Creating tab '{tab_title}'...", flush=True)
                worksheet = sh.add_worksheet(title=tab_title, rows=100, cols=5)

            # Set headers with Clickable Column
            worksheet.append_row(["Title (Clickable)", "Price", "Date", "Raw eBay URL"])
            
            # Format header row to look professional (Premium Navy Steel Blue)
            try:
                worksheet.format("A1:D1", {
                    "backgroundColor": {
                        "red": 0.1,
                        "green": 0.3,
                        "blue": 0.6
                    },
                    "horizontalAlignment": "CENTER",
                    "textFormat": {
                        "foregroundColor": {
                            "red": 1.0,
                            "green": 1.0,
                            "blue": 1.0
                        },
                        "bold": True
                    }
                })
            except Exception as fe:
                print(f"[Google Sheets] Skipping style formatting on '{tab_title}': {str(fe)}", flush=True)

            # Build rows using Google Sheets HYPERLINK formula
            new_rows = []
            for row in listings:
                escaped_title = row["title"].replace('"', "'")
                clickable_formula = f'=HYPERLINK("{row["url"]}", "{escaped_title}")'
                new_rows.append([clickable_formula, row["price"], row["date"], row["url"]])
            
            if new_rows:
                worksheet.append_rows(new_rows, value_input_option="USER_ENTERED")
                print(f"[Google Sheets] Successfully synced {len(new_rows)} clickable listings to tab '{tab_title}'.", flush=True)
            else:
                print(f"[Google Sheets] No listings available for tab '{tab_title}'.", flush=True)

            # Rate limit mitigation: sleep 2.5 seconds between sheet operations to prevent Google Sheets API 429 rate limit exceptions
            time.sleep(2.5)

        return True

    except Exception as e:
        print("\n" + "="*80, flush=True)
        print("[Google Sheets] EXCEPTION during synchronization:", flush=True)
        print(f"  Error: {str(e)}", flush=True)
        print("="*80 + "\n", flush=True)
        return False

def sync_to_local_csv(data_by_query):
    """Fallback function to write all queries into a structured local CSV file."""
    try:
        print(f"[CSV Fallback] Writing parsed data locally to '{FALLBACK_CSV_NAME}'...")
        with open(FALLBACK_CSV_NAME, mode='w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(["Saved Search Query", "Title", "Price", "Date", "eBay URL"])
            
            total_rows = 0
            for item in data_by_query:
                query = item["query"]
                listings = item["listings"]
                for row in listings:
                    writer.writerow([query, row["title"], row["price"], row["date"], row["url"]])
                    total_rows += 1
                
        print(f"[CSV Fallback] Successfully appended {total_rows} listings to local file: {os.path.abspath(FALLBACK_CSV_NAME)}")
        return True
    except Exception as e:
        print(f"[CSV Fallback] ERROR writing local CSV: {str(e)}")
        return False

def scrape_ebay_saved_searches():
    """Uses Playwright to log into eBay, extract saved searches, and fetch top 10 listings for each."""
    from playwright.sync_api import sync_playwright

    print("[Playwright] Launching Chromium persistent browser session...", flush=True)
    print(f"[Playwright] Storing session cookies in directory: {USER_DATA_DIR}", flush=True)

    all_query_data = []

    with sync_playwright() as p:
        # Launch Chromium with persistent context to save credentials/cookies
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            headless=False,  # Headed so the user can interactively log in if needed
            args=["--disable-blink-features=AutomationControlled"]  # Bypass basic bot-detection flags
        )
        
        page = context.new_page()
        page.set_default_timeout(60000)  # High timeout for manual logins

        # Step 1: Navigate to eBay Saved Searches page
        print("[Playwright] Navigating to eBay Saved Searches page...", flush=True)
        page.goto("https://www.ebay.com/myb/SavedSearches")

        # Step 2: Check if login is required
        # If redirected to a sign-in or login URL, prompt the user in the console
        current_url = page.url
        if "signin" in current_url.lower() or "login" in current_url.lower() or "pass" in current_url.lower():
            print("\n" + "#"*100, flush=True)
            print("  ACTION REQUIRED: YOU ARE NOT LOGGED INTO EBAY!", flush=True)
            print("  Please log into your eBay account in the opened browser window now.", flush=True)
            print("  Once you are fully signed in and on your 'Saved Searches' page, press [ENTER] in this terminal...", flush=True)
            print("#"*100 + "\n", flush=True)
            
            # Wait for user input
            input("Press [ENTER] after you have successfully signed into eBay and navigated to your Saved Searches page...")
            
            # Safely verify and navigate if not already on the correct page
            try:
                page.wait_for_load_state("load", timeout=5000)
            except Exception:
                pass
                
            try:
                if "savedsearches" not in page.url.lower():
                    print("[Playwright] Navigating to Saved Searches page post-login...", flush=True)
                    page.goto("https://www.ebay.com/myb/SavedSearches", timeout=30000)
            except Exception as ne:
                print(f"[Playwright] Warning during navigation: {str(ne)}. Continuing with current page...", flush=True)
        
        # Wait for the page to stabilize and show content
        print("[Playwright] Loading Saved Searches page...", flush=True)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)  # Wait an extra 3 seconds for dynamic content

        # Step 3: Extract Saved Search queries from the page
        print("[Playwright] Scraping saved search queries...", flush=True)
        
        # Strategy A: Extract from URLs containing "_nkw="
        links = page.locator("a").element_handles()
        queries_found = set()
        
        for link in links:
            try:
                href = link.get_attribute("href")
                if href and ("_nkw=" in href or "nkw" in href):
                    parsed_url = urllib.parse.urlparse(href)
                    params = urllib.parse.parse_qs(parsed_url.query)
                    nkw = params.get("_nkw") or params.get("nkw")
                    if nkw and nkw[0].strip():
                        queries_found.add(nkw[0].strip())
            except Exception:
                pass

        # Strategy B: Extract from card list labels or grid elements
        try:
            texts = page.locator(".saved-search-item, .saved-search-link, .title, .search-title").all_inner_texts()
            for text in texts:
                clean_text = text.strip()
                if clean_text and len(clean_text) < 100:  # Valid query length
                    queries_found.add(clean_text)
        except Exception:
            pass

        # Fallback if no searches are parsed: scan all anchor links text on the page for common search formats
        if not queries_found:
            for link in links:
                try:
                    text = link.inner_text().strip()
                    href = link.get_attribute("href")
                    if href and ("/sch/i.html" in href or "ebay.com/sch/" in href) and len(text) > 3 and len(text) < 80:
                        queries_found.add(text)
                except Exception:
                    pass

        saved_queries = list(queries_found)
        print(f"[Playwright] Found {len(saved_queries)} saved search queries: {saved_queries}", flush=True)

        if not saved_queries:
            print("[Playwright] WARNING: No saved searches found. Are you signed into eBay in the opened browser window?", flush=True)
            context.close()
            return []

        # Step 4: Execute each search and extract top 10 items
        for q_index, query in enumerate(saved_queries):
            print(f"\n[Playwright] Executing Saved Search {q_index+1}/{len(saved_queries)}: '{query}'...", flush=True)
            
            # Format the URL safely
            search_url = f"https://www.ebay.com/sch/i.html?_nkw={urllib.parse.quote_plus(query)}&_sop=10"  # Sorted by Newly Listed
            page.goto(search_url)
            page.wait_for_load_state("domcontentloaded")
            try:
                page.wait_for_selector(".s-card, .s-item, .su-card-container", timeout=4000)
            except Exception:
                pass
            page.wait_for_timeout(1000)

            listings = []
            
            # Diagnostic prints
            print(f"  [DEBUG] Page Title: '{page.title()}'")
            print(f"  [DEBUG] Page URL: '{page.url}'")
            
            # Dump the page HTML on the first search to inspect selectors
            if q_index == 0:
                with open("ebay_headed_debug.html", "w", encoding="utf-8") as f:
                    f.write(page.content())
                print("  [DEBUG] Wrote page HTML to 'ebay_headed_debug.html'")
                
            # Support both card view and list view
            total_cards = page.locator(".s-card").count()
            total_items = page.locator(".s-item").count()
            print(f"  [DEBUG] Total '.s-card' found: {total_cards}, '.s-item' found: {total_items}")
            items = page.locator(".s-card, .s-item, .su-card-container").element_handles()
            if q_index == 0 and len(items) > 0:
                try:
                    first_html = items[0].evaluate("el => el.outerHTML")
                    print(f"  [DEBUG] First item outerHTML (truncated):\n{first_html[:1500]}")
                except Exception as he:
                    print(f"  [DEBUG] Could not get outerHTML: {str(he)}")
            
            seen_urls = set()
            for item in items:
                try:
                    # Parse Link
                    item_url = ""
                    links = item.query_selector_all(".s-card__link, .s-item__link, a[href*='/itm/']")
                    for link in links:
                        href = link.get_attribute("href")
                        if href and "/itm/" in href and "123456" not in href:
                            item_url = href
                            break
                    
                    if not item_url:
                        continue
                        
                    # Parse Title
                    title = ""
                    title_elem = item.query_selector(".s-card__title, .s-item__title")
                    if title_elem:
                        title = title_elem.inner_text().replace("New Listing", "").replace("Opens in a new window or tab", "").strip()
                    else:
                        for link in links:
                            txt = link.inner_text().strip()
                            if txt and "shop on ebay" not in txt.lower():
                                title = txt.replace("New Listing", "").replace("Opens in a new window or tab", "").strip()
                                break
                            
                    # Skip generic banner ads or section headers
                    if not title or "shop on ebay" in title.lower() or "sponsored" in title.lower():
                        continue
                        
                    # Clean up URL parameters to keep it short and clean
                    item_url = item_url.split("?")[0] if "?" in item_url else item_url
                    
                    if item_url in seen_urls:
                        continue
                    seen_urls.add(item_url)

                    # Parse Price
                    price_val = 0.0
                    price_elem = item.query_selector(".s-card__price, .s-item__price")
                    if price_elem:
                        price_text = price_elem.inner_text().replace("$", "").replace(",", "").strip()
                        num_match = re.search(r"\d+(\.\d+)?", price_text)
                        if num_match:
                            price_val = float(num_match.group(0))

                    listings.append({
                        "title": title,
                        "price": price_val,
                        "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "url": item_url
                    })
                    
                    if len(listings) >= 10:
                        break
                except Exception as ie:
                    print(f"    [DEBUG] Exception parsing item: {str(ie)}")
                    continue

            print(f"[Playwright] Scraped {len(listings)} listings for query '{query}'.", flush=True)
            all_query_data.append({
                "query": query,
                "listings": listings
            })
        
        context.close()

    return all_query_data

def main():
    print("="*80)
    print("    TradeValue: eBay Agent Saved Searches Sync Pipeline (Playwright Edition)")
    print(f"    Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)

    # 1. Scrape saved searches and execution results using Playwright headed browser session
    all_query_data = scrape_ebay_saved_searches()
    
    if not all_query_data:
        print("[Pipeline] No search data scraped. Exiting.", flush=True)
        sys.exit(1)

    # 2. Synchronize to Google Sheets
    sheets_success = sync_to_google_sheets(all_query_data)
    
    # 3. Always write to Local CSV as a local backup and structured report
    csv_success = sync_to_local_csv(all_query_data)
    
    print("="*80)
    if sheets_success and csv_success:
        print("Pipeline execution COMPLETED SUCCESSFULLY. Data synced to Google Sheet and local CSV backup!")
    elif sheets_success:
        print("Pipeline execution COMPLETED SUCCESSFULLY. Data synced to Google Sheet!")
    elif csv_success:
        print("Pipeline execution COMPLETED SUCCESSFULLY via local CSV fallback.")
        print(f"Check your local file at: {FALLBACK_CSV_NAME}")
    else:
        print("Pipeline execution FAILED completely.")
    print("="*80)

if __name__ == "__main__":
    main()
