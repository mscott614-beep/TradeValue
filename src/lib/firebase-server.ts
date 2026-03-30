import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { Portfolio, AlertConfig } from '@/lib/types';

// Initialize Firebase for Server-Side Use (Server Actions)
export const getServerDb = () => {
    let app;
    if (!getApps().length) {
        // In some environments (like App Hosting), initializeApp() without args picks up project defaults
        try {
            app = initializeApp();
        } catch (e) {
            app = initializeApp(firebaseConfig);
        }
    } else {
        app = getApp();
    }
    return getFirestore(app);
};

export async function getUserPortfolioServer(userId: string): Promise<Portfolio[]> {
    const db = getServerDb();
    const portfolioRef = collection(db, `users/${userId}/portfolios`);
    const snapshot = await getDocs(portfolioRef);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Portfolio));
}

export async function getUserAlertConfigsServer(userId: string): Promise<AlertConfig[]> {
    const db = getServerDb();
    const configRef = collection(db, `users/${userId}/alertsConfig`);
    const snapshot = await getDocs(configRef);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AlertConfig));
}
