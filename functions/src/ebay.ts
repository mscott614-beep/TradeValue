
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

export type EbayPriceFilter = {
    min?: number;
    max?: number;
};

export type EbaySearchOptions = {
    limit?: number;
    offset?: number;
    sort?: string;
    includeAuctions?: boolean;
    categoryIds?: string;
    priceFilter?: EbayPriceFilter;
};

export type EbayPaginatedSearchOptions = EbaySearchOptions & {
    /** Max listings to collect across pages (default 300). */
    maxItems?: number;
    /** Delay between pages in ms (default 200). */
    pageDelayMs?: number;
};

const DEFAULT_CATEGORY = '261328'; // Sports Trading Cards
const MAX_PAGE_LIMIT = 200;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFilterParts(includeAuctions: boolean, priceFilter?: EbayPriceFilter): string[] {
    const parts: string[] = [];
    if (!includeAuctions) {
        parts.push('buyingOptions:{FIXED_PRICE}');
    }
    if (priceFilter && (priceFilter.min != null || priceFilter.max != null)) {
        const min = priceFilter.min != null ? priceFilter.min : '';
        const max = priceFilter.max != null ? priceFilter.max : '';
        parts.push(`price:[${min}..${max}]`);
        parts.push('priceCurrency:USD');
    }
    return parts;
}

function isRetryableStatus(status?: number): boolean {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
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

    private buildSearchUrl(
        query: string,
        limit: number,
        offset: number,
        sort: string,
        includeAuctions: boolean,
        categoryIds: string,
        priceFilter?: EbayPriceFilter
    ): string {
        const url = new URL(this.BASE_URLS[this.env].browse);
        url.searchParams.append('q', query);
        url.searchParams.append('limit', Math.min(Math.max(limit, 1), MAX_PAGE_LIMIT).toString());
        if (offset > 0) {
            url.searchParams.append('offset', offset.toString());
        }
        url.searchParams.append('category_ids', categoryIds || DEFAULT_CATEGORY);

        const filterParts = buildFilterParts(includeAuctions, priceFilter);
        if (filterParts.length) {
            url.searchParams.append('filter', filterParts.join(','));
        }
        url.searchParams.append('sort', sort);
        url.searchParams.append('fieldGroups', 'EXTENDED');
        return url.toString();
    }

    /**
     * Search for active items using the Browse API (single page).
     * Overloads preserve legacy call sites: (query, limit, sort, includeAuctions).
     */
    async searchActiveItems(
        query: string,
        limitOrOptions: number | EbaySearchOptions = 10,
        sort: string = 'price',
        includeAuctions: boolean = false
    ): Promise<EbayAuctionResponse> {
        const options: EbaySearchOptions =
            typeof limitOrOptions === 'object' && limitOrOptions !== null
                ? limitOrOptions
                : {
                      limit: typeof limitOrOptions === 'number' ? limitOrOptions : 10,
                      sort,
                      includeAuctions,
                  };

        const pageLimit = options.limit ?? 10;
        const offset = options.offset ?? 0;
        const pageSort = options.sort ?? 'price';
        const auctions = options.includeAuctions ?? false;
        const categoryIds = options.categoryIds || DEFAULT_CATEGORY;

        return this.searchActiveItemsWithRetry(
            query,
            pageLimit,
            offset,
            pageSort,
            auctions,
            categoryIds,
            options.priceFilter,
            2
        );
    }

    private async searchActiveItemsWithRetry(
        query: string,
        limit: number,
        offset: number,
        sort: string,
        includeAuctions: boolean,
        categoryIds: string,
        priceFilter: EbayPriceFilter | undefined,
        maxRetries: number
    ): Promise<EbayAuctionResponse> {
        const token = await this.getAccessToken();
        const url = this.buildSearchUrl(query, limit, offset, sort, includeAuctions, categoryIds, priceFilter);
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.get(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
                    },
                });
                return response.data as EbayAuctionResponse;
            } catch (error: any) {
                const status = error.response?.status as number | undefined;
                const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
                lastError = new Error(`eBay ${this.env} API search failed: ${detail}`);
                if (attempt < maxRetries && isRetryableStatus(status)) {
                    const backoff = 500 * Math.pow(2, attempt);
                    console.warn(
                        `[EbayService] Retryable ${status} on offset=${offset} (attempt ${attempt + 1}/${maxRetries + 1}); waiting ${backoff}ms`
                    );
                    await sleep(backoff);
                    continue;
                }
                throw lastError;
            }
        }

        throw lastError || new Error(`eBay ${this.env} API search failed`);
    }

    /**
     * Paginate Browse API results via offset until empty, total exhausted, or maxItems.
     */
    async searchActiveItemsPaginated(
        query: string,
        options: EbayPaginatedSearchOptions = {}
    ): Promise<EbayAuctionResponse> {
        const pageLimit = Math.min(Math.max(options.limit ?? 100, 1), MAX_PAGE_LIMIT);
        const maxItems = options.maxItems ?? 300;
        const pageDelayMs = options.pageDelayMs ?? 200;
        const sort = options.sort ?? 'price';
        const includeAuctions = options.includeAuctions ?? false;
        const categoryIds = options.categoryIds || DEFAULT_CATEGORY;

        const allItems: NonNullable<EbayAuctionResponse['itemSummaries']> = [];
        let offset = options.offset ?? 0;
        let total = 0;

        while (allItems.length < maxItems) {
            const remaining = maxItems - allItems.length;
            const limit = Math.min(pageLimit, remaining);

            let page: EbayAuctionResponse;
            try {
                page = await this.searchActiveItemsWithRetry(
                    query,
                    limit,
                    offset,
                    sort,
                    includeAuctions,
                    categoryIds,
                    options.priceFilter,
                    2
                );
            } catch (err) {
                console.error(
                    `[EbayService] Pagination stopped for query="${query}" at offset=${offset}:`,
                    err
                );
                break;
            }

            const summaries = page.itemSummaries || [];
            total = typeof page.total === 'number' ? page.total : total;
            if (summaries.length === 0) break;

            allItems.push(...summaries);
            console.log(
                `[EbayService] Page offset=${offset} limit=${limit} got=${summaries.length} ` +
                    `accumulated=${allItems.length} total=${total || '?'}`
            );

            offset += summaries.length;
            if (offset >= total && total > 0) break;
            if (summaries.length < limit) break;

            if (allItems.length < maxItems) {
                await sleep(pageDelayMs);
            }
        }

        return {
            itemSummaries: allItems.slice(0, maxItems),
            total: total || allItems.length,
        };
    }

    /**
     * Search specifically for active auctions.
     */
    async searchActiveAuctions(query: string, limit: number = 10): Promise<EbayAuctionResponse> {
        const token = await this.getAccessToken();
        
        const url = new URL(this.BASE_URLS[this.env].browse);
        url.searchParams.append('q', query);
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('category_ids', DEFAULT_CATEGORY);
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
