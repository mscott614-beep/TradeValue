
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const clientId = process.env.EBAY_CLIENT_ID;
const clientSecret = process.env.EBAY_CLIENT_SECRET;
const env = process.env.EBAY_ENV || 'production';

const BASE_URLS = {
    production: {
        auth: 'https://api.ebay.com/identity/v1/oauth2/token',
        browse: 'https://api.ebay.com/buy/browse/v1/item_summary/search'
    },
    sandbox: {
        auth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
        browse: 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search'
    }
};

async function testEbay() {
    console.log(`--- Testing eBay ${env} ---`);
    console.log(`Client ID: ${clientId ? 'Present' : 'Missing'}`);
    
    if (!clientId || !clientSecret) {
        console.error('Missing credentials');
        return;
    }

    try {
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        console.log('Fetching access token...');
        const authResponse = await fetch(BASE_URLS[env].auth, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${auth}`,
            },
            body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
        });

        if (!authResponse.ok) {
            const error = await authResponse.text();
            console.error(`Auth Failed: ${error}`);
            return;
        }

        const authData = await authResponse.json();
        const token = authData.access_token;
        console.log('Access token retrieved successfully.');

        console.log('Searching for "Hockey Cards"...');
        const searchUrl = new URL(BASE_URLS[env].browse);
        searchUrl.searchParams.append('q', 'Hockey Cards');
        searchUrl.searchParams.append('limit', '1');

        const searchResponse = await fetch(searchUrl.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            },
        });

        if (!searchResponse.ok) {
            const error = await searchResponse.text();
            console.error(`Search Failed: ${error}`);
            return;
        }

        const searchData = await searchResponse.json();
        console.log('Search Success!');
        if (searchData.itemSummaries && searchData.itemSummaries.length > 0) {
            console.log(`First item: ${searchData.itemSummaries[0].title}`);
        } else {
            console.log('No items found in sandbox (common if sandbox is empty).');
        }
    } catch (e) {
        console.error(`Unexpected Error: ${e.message}`);
    }
}

testEbay();
