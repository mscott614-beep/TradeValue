export interface EbayAuthResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
}

export interface EbayAuctionResponse {
    itemSummaries?: Array<{
        itemId: string;
        title: string;
        price: { value: string; currency: string; };
        bidCount?: number;
        itemWebUrl: string;
        image?: { imageUrl: string; };
        categories?: Array<{ categoryId: string; categoryName: string; }>;
        condition?: string;
        buyingOptions?: string[];
        shippingOptions?: Array<{ shippingCost: { value: string; currency: string; }; }>;
    }>;
    total: number;
}

export class EbayService {
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

    constructor(clientId: string, clientSecret: string, env: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.env = (env || '').toLowerCase().includes('sandbox') ? 'sandbox' : 'production';
    }

    // Standard token for Active listings
    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;

        const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const response = await fetch(this.BASE_URLS[this.env].auth, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${auth}`,
            },
            body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
        });

        const data = await response.json() as EbayAuthResponse;
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        return this.accessToken;
    }

    // SPECIAL TOKEN: Uses your 18-month Refresh Token for "Sold" data
    private async getUserAccessToken(refreshToken: string): Promise<string> {
        const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const response = await fetch(this.BASE_URLS[this.env].auth, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${auth}`,
            },
            body: `grant_type=refresh_token&refresh_token=${refreshToken}&scope=https://api.ebay.com/oauth/api_scope/sell.analytics.readonly`,
        });

        const data = await response.json() as any;
        return data.access_token;
    }

    async searchActiveItems(query: string, limit: number = 10): Promise<EbayAuctionResponse> {
        const token = await this.getAccessToken();
        const url = new URL(this.BASE_URLS[this.env].browse);
        url.searchParams.append('q', query);
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('category_ids', '261328');

        const response = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
        });
        return await response.json() as EbayAuctionResponse;
    }

    async searchActiveAuctions(query: string, limit: number = 10): Promise<EbayAuctionResponse> {
        const token = await this.getAccessToken();
        const url = new URL(this.BASE_URLS[this.env].browse);
        url.searchParams.append('q', query);
        url.searchParams.append('filter', 'buyingOptions:{AUCTION}');

        const response = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
        });

        if (!response.ok) throw new Error(`eBay Auction API failed`);

        return await response.json() as EbayAuctionResponse;
    } // <--- THIS WAS MISSING!

    /**
     * Search for sold items using your secret Refresh Token
     */
    async searchSoldItems(query: string, refreshToken: string, lastDays: number = 30): Promise<any> {
        const token = await this.getUserAccessToken(refreshToken);

        const now = new Date();
        const startDate = new Date();
        startDate.setDate(now.getDate() - lastDays);

        const filter = `last_sold_date:[${startDate.toISOString()}..${now.toISOString()}]`;
        const url = new URL(`https://api.ebay.com/sell/research/v1/item_summary/search`);
        url.searchParams.append('q', query);
        url.searchParams.append('filter', filter);
        url.searchParams.append('categoryId', '261328');

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            },
        });

        return await response.json();
    }
}