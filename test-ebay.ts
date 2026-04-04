import { ebayService } from './src/lib/ebay';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });

async function run() {
    process.env.EBAY_CLIENT_ID = process.env.NEXT_PUBLIC_EBAY_APP_ID;
    process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CERT_ID;

    const queries = [
        '2017 Upper Deck Ultimate Collection Tage Thompson Auto Threads DTA-TT -reprint -digital',
        '2017 UD Ultimate Tage Thompson DTA-TT',
        'Tage Thompson DTA-TT',
        '17-18 Ultimate Collection Tage Thompson DTA-TT',
        '2017 Tage Thompson DTA-TT',
    ];

    for (const q of queries) {
        console.log(`\nSearching for: "${q}"`);
        const result = await ebayService.searchActiveItems(q, 10);
        const items = result.itemSummaries || [];
        console.log(`Found ${items.length} items`);
        items.forEach((item: any, i: number) => console.log(`${i+1}. [$${item.price.value}] ${item.title}`));
    }
}

run();
