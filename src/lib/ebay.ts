
export interface EbayAuthResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
}

export interface EbayAuctionResponse {
    itemSummaries?: Array<{
        itemId: string;
        title: string;
        price: {
            value: string;
            currency: string;
        };
        bidCount?: number;
        itemWebUrl: string;
        image?: {
            imageUrl: string;
        };
        categories?: Array<{
            categoryId: string;
            categoryName: string;
        }>;
        condition?: string;
        buyingOptions?: string[];
        itemEndDate?: string;
        itemCreationDate?: string;
        shippingOptions?: Array<{
            shippingCost: {
                value: string;
                currency: string;
            };
        }>;
    }>;
    total: number;
}

class EbayService {
    private clientId: string;
    private clientSecret: string;
    private env: 'sandbox' | 'production';
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    private readonly BASE_URLS = {
        production: {
            auth: 'https://api.ebay.com/identity/v1/oauth2/token',
            browse: 'https://api.ebay.com/buy/browse/v1/item_summary/search'
        },
        sandbox: {
            auth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
            browse: 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search'
        }
    };

    constructor() {
        this.clientId = process.env.EBAY_CLIENT_ID || '';
        this.clientSecret = process.env.EBAY_CLIENT_SECRET || '';
        
        // Hardcoded to production to avoid the broken Firebase UI rejecting "EBAY_ENV" updates
        this.env = 'production'; 
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        if (!this.clientId || !this.clientSecret) {
            throw new Error(`eBay ${this.env} credentials not configured in environment variables.`);
        }

        const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const response = await fetch(this.BASE_URLS[this.env].auth, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${auth}`,
            },
            body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to fetch eBay ${this.env} access token: ${error}`);
        }

        const data: EbayAuthResponse = await response.json();
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

        return this.accessToken;
    }

    /**
     * Search for active items using the Browse API.
     */
    async searchActiveItems(query: string, limit: number = 10, sort: string = 'price', includeAuctions: boolean = false): Promise<EbayAuctionResponse> {
        const token = await this.getAccessToken();
        
        const url = new URL(this.BASE_URLS[this.env].browse);
        url.searchParams.append('q', query);
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('category_ids', '261328'); // Sports Trading Cards
        
        if (!includeAuctions) {
            url.searchParams.append('filter', 'buyingOptions:{FIXED_PRICE}');
        }

        url.searchParams.append('sort', sort); // price (Ascending) by default
        url.searchParams.append('fieldGroups', 'EXTENDED'); // To see buyingOptions and other details

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            },
        });

        if (!response.ok) {
            const error = await response.text();
            const diag = `(ENV: ${this.env}, EBAY_ENV: ${process.env.EBAY_ENV}, NODE_ENV: ${process.env.NODE_ENV})`;
            throw new Error(`eBay ${this.env} API search failed ${diag}: ${error}`);
        }

        return await response.json();
    }

    /**
     * Search specifically for active auctions.
     */
    async searchActiveAuctions(query: string, limit: number = 10): Promise<EbayAuctionResponse> {
        const token = await this.getAccessToken();
        
        const url = new URL(this.BASE_URLS[this.env].browse);
        url.searchParams.append('q', query);
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('category_ids', '261328');
        url.searchParams.append('filter', 'buyingOptions:{AUCTION}');
        url.searchParams.append('fieldGroups', 'EXTENDED');

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`eBay ${this.env} Auction API search failed: ${error}`);
        }

        return await response.json();
    }

    /**
     * Fetch the 5 most recent sales (Comps) for a card.
     * Target: eBay Browse API (/buy/browse/v1/item_summary/search)
     */
    async searchSoldItems(options: { 
        cardTitle: string, 
        epid?: string, 
        upc?: string, 
        limit?: number 
    }): Promise<EbayAuctionResponse> {
        const token = await this.getAccessToken();
        const { cardTitle, epid, upc, limit = 5 } = options;

        const url = new URL(this.BASE_URLS[this.env].browse);
        url.searchParams.append('q', cardTitle);
        if (epid) url.searchParams.append('epid', epid);
        if (upc) url.searchParams.append('gtin', upc);
        
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('category_ids', '261328'); // Sports Trading Cards
        // Filter specifically for Fixed Price and Auctions
        url.searchParams.append('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
        // Sort by most recent transactions
        url.searchParams.append('sort', '-endTime');
        url.searchParams.append('fieldGroups', 'EXTENDED');

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`eBay ${this.env} Sold Items search failed: ${error}`);
        }

        return await response.json();
    }

    /**
     * @deprecated Currently unused in the main trending flow in favor of live active volume.
     * Simulated results for testing UI components that require historical arrays.
     */
    async getHistoricalSales(query: string): Promise<any[]> {
        console.warn('Historical sales currently returns mock data as Marketplace Insights API requires specific approval.');
        
        // Simulating some historical results for the AI to analyze
        return [
            { title: `${query} (Base)`, price: 150.00, date: '2024-03-01' },
            { title: `${query} (Parallel)`, price: 165.50, date: '2024-03-05' },
            { title: `${query} (Rookie)`, price: 180.00, date: '2024-03-10' },
        ];
    }
}

export const ebayService = new EbayService();
