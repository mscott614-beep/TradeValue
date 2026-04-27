import { NextResponse } from 'next/server';
import { runMarketScanner } from "@/ai/flows/market-scanner";
import { getUserPortfolioServer, getUserAlertConfigsServer } from "@/lib/firebase-server";

export async function POST(req: Request) {
    try {
        const { userId, userEmail } = await req.json();

        if (!userId) {
            return NextResponse.json({ error: "User ID is required" }, { status: 400 });
        }

        console.log(`[API] Triggering Deep Scan for: ${userId}`);

        // Fetch data server-side
        const [cards, alertsConfig] = await Promise.all([
            getUserPortfolioServer(userId),
            getUserAlertConfigsServer(userId)
        ]);

        if (!cards || cards.length === 0) {
            return NextResponse.json({ alerts: [] });
        }

        // Run the scanner with 'deep' scanType
        const result = await runMarketScanner({ 
            cards, 
            alertsConfig: alertsConfig.filter(c => c.isActive), 
            scanType: 'deep', 
            userEmail 
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error("Deep Scan API Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
