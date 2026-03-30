import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Portfolio, AlertConfig } from '@/lib/types';

// Initialize Firebase Admin for Server-Side Use (Server Actions)
// Modular pattern for Next.js 15+ Compatibility
export const getAdminApp = () => {
    if (getApps().length <= 0) {
        return initializeApp({
            projectId: 'puckvaluebak-38609945-5e85c'
        });
    }
    return getApp();
}

export const getAdminDb = () => getFirestore(getAdminApp());

export async function getUserPortfolioServer(userId: string): Promise<Portfolio[]> {
    const db = getAdminDb();
    const portfolioRef = db.collection(`users/${userId}/portfolios`);
    const snapshot = await portfolioRef.get();
    
    return snapshot.docs.map((doc: any) => ({ 
        id: doc.id, 
        ...doc.data() 
    } as Portfolio));
}

export async function getUserAlertConfigsServer(userId: string): Promise<AlertConfig[]> {
    const db = getAdminDb();
    const configRef = db.collection(`users/${userId}/alertsConfig`);
    const snapshot = await configRef.get();
    
    return snapshot.docs.map((doc: any) => ({ 
        id: doc.id, 
        ...doc.data() 
    } as AlertConfig));
}
