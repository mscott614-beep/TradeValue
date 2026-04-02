import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (getApps().length === 0) {
    initializeApp({
        projectId: 'puckvaluebak-38609945-5e85c'
    });
}

const db = getFirestore();

async function migrateFeatures() {
    console.log('--- Starting Data Migration: features to string[] ---');
    
    // Get all user documents
    const usersSnapshot = await db.collection('users').get();
    
    for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        console.log(`Processing user: ${userId}`);
        
        // Get all portfolio documents for this user
        const portfoliosSnapshot = await db.collection(`users/${userId}/portfolios`).get();
        
        for (const portDoc of portfoliosSnapshot.docs) {
            const data = portDoc.data();
            const { features } = data;
            
            // If features is a string, convert to array
            if (typeof features === 'string') {
                const trimmed = features.trim();
                const newFeatures = trimmed === '' ? [] : [trimmed];
                console.log(`  Updating card ${portDoc.id}: "${features}" -> ${JSON.stringify(newFeatures)}`);
                await portDoc.ref.update({ features: newFeatures });
            } else if (!features) {
                // If it's missing or null, initialize to empty array
                console.log(`  Updating card ${portDoc.id}: null/undefined -> []`);
                await portDoc.ref.update({ features: [] });
            }
        }
    }
    
    console.log('--- Data Migration Complete ---');
}

migrateFeatures().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
});
