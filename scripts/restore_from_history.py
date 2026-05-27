import os
from google.cloud import firestore
from datetime import datetime, timezone

PROJECT_ID = "puckvaluebak-38609945-5e85c"

def restore_database():
    try:
        db = firestore.Client(project=PROJECT_ID)
        users = list(db.collection('users').where('email', '==', 'mscott614@gmail.com').stream())
        if not users:
            print("User not found.")
            return
            
        user_id = users[0].id
        cards = list(db.collection('users').document(user_id).collection('portfolios').stream())
        
        restored_count = 0
        for doc in cards:
            data = doc.to_dict()
            val = data.get("currentMarketValue")
            
            # If value is 0 or 0.00, check history
            if val == 0 or val == 0.0:
                history_docs = list(doc.reference.collection('priceHistory').order_by('timestamp', direction=firestore.Query.DESCENDING).limit(5).stream())
                
                old_val = None
                for hist in history_docs:
                    hist_val = hist.to_dict().get("value")
                    if hist_val is not None and hist_val > 0:
                        old_val = hist_val
                        break
                
                if old_val is not None:
                    # Update User Portfolio
                    doc.reference.update({
                        "currentMarketValue": old_val,
                        "status": "market_verified", # Restore status
                        "lastMarketValueUpdate": datetime.now(timezone.utc).isoformat()
                    })
                    
                    # Update Global Collection
                    global_doc = db.collection('collections').document(doc.id)
                    if global_doc.get().exists:
                        global_doc.update({
                            "currentMarketValue": old_val,
                            "status": "market_verified"
                        })
                    
                    restored_count += 1
                    print(f"Restored {doc.id} to ${old_val}")
                else:
                    print(f"Could not find non-zero history for {doc.id}")
                
        print(f"Successfully restored {restored_count} cards.")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    restore_database()
