import os
from google.cloud import firestore

PROJECT_ID = "puckvaluebak-38609945-5e85c"

def check_database():
    try:
        db = firestore.Client(project=PROJECT_ID)
        users = list(db.collection('users').where('email', '==', 'mscott614@gmail.com').stream())
        if not users:
            print("User not found by email.")
            return
            
        user_id = users[0].id
        print(f"User ID: {user_id}")
        
        cards = list(db.collection('users').document(user_id).collection('portfolios').stream())
        print(f"Found {len(cards)} cards in portfolio.")
        
        card_data = []
        for doc in cards:
            data = doc.to_dict()
            card_data.append({
                "id": doc.id,
                "player": data.get("player"),
                "currentMarketValue": data.get("currentMarketValue"),
                "type": type(data.get("currentMarketValue")).__name__,
                "valueChange24h": data.get("valueChange24h"),
                "valueChange24hPercent": data.get("valueChange24hPercent")
            })
            
        import json
        print(json.dumps(card_data[:5], indent=2))
        
        total_val = 0
        for c in card_data:
            val = c.get("currentMarketValue")
            if val is not None:
                try:
                    total_val += float(val)
                except:
                    pass
                    
        print(f"Total calculated value: {total_val}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_database()
