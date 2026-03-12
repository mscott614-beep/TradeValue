
import { ebayService } from '../src/lib/ebay';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function verifyEbay() {
    console.log('--- Verifying eBay Service ---');
    
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error('ERROR: EBAY_CLIENT_ID or EBAY_CLIENT_SECRET is missing from .env');
        console.log('Please add them to your .env file to test the real integration.');
        return;
    }

    try {
        console.log('Testing searchActiveAuctions("Connor McDavid PSA 10")...');
        const results = await ebayService.searchActiveAuctions("Connor McDavid PSA 10", 2);
        console.log('Success! Found', results.total, 'items.');
        console.log('First Item:', results.itemSummaries?.[0]?.title, '-', results.itemSummaries?.[0]?.price?.value);
    } catch (error) {
        console.error('Search failed:', error);
    }

    console.log('\nTesting getHistoricalSales("Connor McDavid")...');
    const sales = await ebayService.getHistoricalSales("Connor McDavid");
    console.log('Mock Sales retrieved:', sales.length);
}

verifyEbay();
