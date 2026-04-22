
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
        shippingOptions?: Array<{
            shippingCost: {
                value: string;
                currency: string;
            };
        }>;
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

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        if (!this.clientId || !this.clientSecret) {
            throw new Error(`eBay ${this.env} credentials not configured.`);
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

        const data = await response.json() as EbayAuthResponse;
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

        return this.accessToken;
    }

    /**
     * Search for active items using the Browse API.
     */
    async searchActiveItems(query: string, limit: number = 10, sort: string = 'price'): Promise<EbayAuctionResponse> {
        const token = await this.getAccessToken();
        
        const url = new URL(this.BASE_URLS[this.env].browse);
        url.searchParams.append('q', query);
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('category_ids', '261328'); // Sports Trading Cards
        url.searchParams.append('filter', 'buyingOptions:{FIXED_PRICE}');
        url.searchParams.append('sort', sort); // price (Ascending) by default
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
            throw new Error(`eBay ${this.env} API search failed: ${error}`);
        }

        return await response.json() as EbayAuctionResponse;
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

        return await response.json() as EbayAuctionResponse;
    }
}
