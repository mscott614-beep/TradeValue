import * as admin from 'firebase-admin';
import { Portfolio, AlertConfig } from '@/lib/types';

// Initialize Firebase Admin for Server-Side Use (Server Actions)
// This bypasses client-side security rules for authorized server-side logic
if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (error) {
        console.error('Firebase Admin initialization error:', error);
    }
}

export const getAdminDb = () => admin.firestore();

export async function getUserPortfolioServer(userId: string): Promise<Portfolio[]> {
    const db = getAdminDb();
    const portfolioRef = db.collection(`users/${userId}/portfolios`);
    const snapshot = await portfolioRef.get();
    
    return snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
    } as Portfolio));
}

export async function getUserAlertConfigsServer(userId: string): Promise<AlertConfig[]> {
    const db = getAdminDb();
    const configRef = db.collection(`users/${userId}/alertsConfig`);
    const snapshot = await configRef.get();
    
    return snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
    } as AlertConfig));
}
