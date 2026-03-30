import { describe, it, expect } from 'vitest';
import { buildEbayQuery, calculateTradeValue } from './ebay-pricing';

describe('Lead Data Architect: Query Construction', () => {
    it('should generate a base card query with mandatory negative keywords', () => {
        const card = { year: '1984-85', brand: 'Topps', player: 'Ray Bourque', cardNumber: '1' };
        const result = buildEbayQuery(card);
        expect(result.type).toBe('Base');
        expect(result.query).toContain('-parallel -refractor -silver -prizm -auto -jersey -patch');
        expect(result.query).toContain('1984-85');
        expect(result.query).toContain('Ray Bourque');
        expect(result.query).toContain('#1');
    });

    it('should generate a parallel query when features are detected', () => {
        const card = { year: '2023', brand: 'Prizm', player: 'Connor Bedard', parallel: 'Silver' };
        const result = buildEbayQuery(card);
        expect(result.type).toBe('Parallel');
        expect(result.query).toContain('Silver');
        expect(result.query).not.toContain('-parallel');
    });
});

describe('Lead Data Architect: Valuation Math (The TradeValue Rule)', () => {
    it('should calculate the median of the 3 lowest priced items', () => {
        const items = [
            { price: { value: '10.00' }, buyingOptions: ['FIXED_PRICE'] },
            { price: { value: '20.00' }, buyingOptions: ['FIXED_PRICE'] },
            { price: { value: '30.00' }, buyingOptions: ['FIXED_PRICE'] },
            { price: { value: '100.00' }, buyingOptions: ['FIXED_PRICE'] } // High noise
        ];
        const result = calculateTradeValue(items);
        expect(result.value).toBe(20.00); // Median of 10, 20, 30
        expect(result.logic).toContain('Median of 3 lowest Fixed Price items');
    });

    it('should reject outliers that are >50% lower than the genuine floor', () => {
        const items = [
            { price: { value: '1.00' }, buyingOptions: ['FIXED_PRICE'] }, // Scam/Digital
            { price: { value: '19.00' }, buyingOptions: ['FIXED_PRICE'] },
            { price: { value: '20.00' }, buyingOptions: ['FIXED_PRICE'] },
            { price: { value: '21.00' }, buyingOptions: ['FIXED_PRICE'] }
        ];
        const result = calculateTradeValue(items);
        // After rejecting 1.00, it selects [19, 20, 21]. Median is 20.
        expect(result.value).toBe(20.00);
        expect(result.outliersCount).toBe(1);
    });
});
