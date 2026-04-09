import { describe, it, expect } from 'vitest';
import { buildEbayQuery, calculateTradeValue } from './ebay-pricing';

describe('Lead Data Architect: Query Construction', () => {
    it('should generate a base card query with mandatory negative keywords', () => {
        const card = { year: '1984-85', brand: 'Topps', player: 'Ray Bourque', cardNumber: '1' };
        const result = buildEbayQuery(card);
        expect(result.type).toBe('Base');
        expect(result.query).toContain('-parallel -refractor -silver -prizm -auto -jersey -patch');
        expect(result.query).toContain('-lot -upick -pick');
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

    it('should include the grade in the query and remove exclusions for graded cards', () => {
        const card = { 
            year: '1992-93', 
            brand: 'Upper Deck', 
            player: 'Paul Kariya', 
            condition: 'BCCG 10', 
            cardNumber: '586' 
        };
        const result = buildEbayQuery(card);
        expect(result.query).toContain('BCCG 10');
        expect(result.query).not.toContain('-psa');
        expect(result.query).toContain('-parallel -refractor');
    });

    it('should identify memorabilia subsets like Treasured Swatches as Parallels to avoid base card exclusions', () => {
        const card = { 
            year: '2007-08', 
            brand: 'Upper Deck Artifacts', 
            set: 'Treasured Swatches', 
            player: 'Nikolai Khabibulin', 
            cardNumber: 'TS-NK' 
        };
        const result = buildEbayQuery(card);
        expect(result.type).toBe('Parallel');
        expect(result.query).not.toContain('-jersey'); // Vital: should not have negative exclusions
        expect(result.query).toContain('Artifacts'); 
        expect(result.query).toContain('TS-NK');
        expect(result.query).not.toContain('#TS-NK'); // Should not have # prefix
    });

    it('should not trigger false-positive graded detection for common words/names', () => {
        const card = { year: '1990', brand: '7th Inning Sketch', player: 'Martin Brodeur', cardNumber: '222' };
        const result = buildEbayQuery(card);
        expect(result.query).toContain('-psa'); // Should still be Raw
        expect(result.query).not.toContain('PSA'); 
    });
});

describe('Lead Data Architect: Valuation Math (The TradeValue Rule)', () => {
    it('should calculate the median of the 3 lowest priced items', () => {
        const items = [
            { price: { value: '15.00' }, buyingOptions: ['FIXED_PRICE'] },
            { price: { value: '20.00' }, buyingOptions: ['FIXED_PRICE'] },
            { price: { value: '25.00' }, buyingOptions: ['FIXED_PRICE'] },
            { price: { value: '100.00' }, buyingOptions: ['FIXED_PRICE'] } // High noise
        ];
        const result = calculateTradeValue(items);
        expect(result.value).toBe(20.00); // Median of 15, 20, 25
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

    it('should filter out lot, u-pick, and numbered listings (8) from the valuation pool by title', () => {
        const items = [
            { title: 'Martin Brodeur 10 Card Lot', price: { value: '15.00' }, buyingOptions: ['FIXED_PRICE'] },
            { title: '1990 7th Inning Sketch #222 Martin Brodeur', price: { value: '20.00' }, buyingOptions: ['FIXED_PRICE'] },
            { title: '2023 Upper Deck ** U PICK **', price: { value: '5.00' }, buyingOptions: ['FIXED_PRICE'] },
            { title: 'Martin Brodeur #222 HOF Rookie (8) Cards FREE SHIP', price: { value: '129.95' }, buyingOptions: ['FIXED_PRICE'] },
            { title: 'Connor Bedard 10x Lot', price: { value: '50.00' }, buyingOptions: ['FIXED_PRICE'] },
            { title: '1990 7th Inning Sketch #222 Martin Brodeur', price: { value: '25.00' }, buyingOptions: ['FIXED_PRICE'] },
            { title: '1990 7th Inning Sketch #222 Martin Brodeur', price: { value: '30.00' }, buyingOptions: ['FIXED_PRICE'] }
        ];
        const result = calculateTradeValue(items);
        // Should ignore: Lot ($15), U PICK ($5), (8) Cards ($129.95), 10x ($50).
        // Pool: [20, 25, 30]. Median is 25.
        expect(result.value).toBe(25.00);
        expect(result.logic).toContain('4 noise listings');
    });
});
