import sys
import json
import asyncio
import argparse
from dotenv import load_dotenv

# Load local env if running manually, though Node passes process.env
load_dotenv(".env.local")

from agent_service import value_card, ValuationRequest

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--userId', required=True)
    parser.add_argument('--cardId', required=True)
    parser.add_argument('--cardDetails', required=False, default='{}')
    parser.add_argument('--query', required=False, default='')
    args = parser.parse_args()

    details = json.loads(args.cardDetails)
    
    req = ValuationRequest(
        userId=args.userId,
        cardId=args.cardId,
        cardDetails=details
    )
    
    try:
        # This will use the institutional context caches and return exact prices!
        # It also automatically updates Firestore internally.
        result = await value_card(req)
        
        # Output ONLY the json at the end for the JS script to pick up
        print(json.dumps(result))
    except Exception as e:
        print(f"[Python Error] {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
