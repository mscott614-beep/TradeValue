import os
from google.cloud import firestore

PROJECT_ID = "puckvaluebak-38609945-5e85c"

def check_database():
    try:
        db = firestore.Client(project=PROJECT_ID)
        users = list(db.collection('users').where('email', '==', 'mscott614@gmail.com').stream())
        if not users:
            return
            
        user_id = users[0].id
        cards = list(db.collection('users').document(user_id).collection('portfolios').stream())
        
        card_data = []
        for doc in cards:
            data = doc.to_dict()
            card_data.append({
                "id": doc.id,
                "currentMarketValue": data.get("currentMarketValue"),
                "valueChange24h": data.get("valueChange24h"),
                "dataFlags": data.get("dataFlags"),
                "lastMarketValueUpdate": data.get("lastMarketValueUpdate")
            })
            
        import json
        print(json.dumps(card_data[:5], indent=2))
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_database()
