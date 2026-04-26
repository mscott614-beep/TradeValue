
import axios from 'axios';

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
        // Hardcode to production to rule out secret issues during DNS failure investigation
        this.env = 'production';
        
        console.log(`[EbayService] Initialized for ${this.env}. Testing DNS for api.ebay.com and google.com...`);
        import('dns').then(dns => {
            dns.lookup('api.ebay.com', (err, address) => {
                if (err) console.error(`[DNS PROBE] Failed to resolve api.ebay.com: ${err.message}`);
                else console.log(`[DNS PROBE] api.ebay.com resolved to: ${address}`);
            });
            dns.lookup('google.com', (err, address) => {
                if (err) console.error(`[DNS PROBE] Failed to resolve google.com: ${err.message}`);
                else console.log(`[DNS PROBE] google.com resolved to: ${address}`);
            });
        });
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        if (!this.clientId || !this.clientSecret) {
            throw new Error(`eBay ${this.env} credentials not configured.`);
        }

        try {
            const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
            const response = await axios.post(this.BASE_URLS[this.env].auth, 
                'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Basic ${auth}`,
                    }
                }
            );

            const data = response.data as EbayAuthResponse;
            this.accessToken = data.access_token;
            this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

            return this.accessToken;
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`Failed to fetch eBay ${this.env} access token: ${detail}`);
        }
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
        url.searchParams.append('fieldGroups', 'EXTENDED');

        try {
            const response = await axios.get(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
                },
            });

            return response.data as EbayAuctionResponse;
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`eBay ${this.env} API search failed: ${detail}`);
        }
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

        try {
            const response = await axios.get(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
                },
            });

            return response.data as EbayAuctionResponse;
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`eBay ${this.env} Auction API search failed: ${detail}`);
        }
    }
}
