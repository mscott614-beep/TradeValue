export type Portfolio = {
  id: string;
  userId: string;
  cardId: string;
  title: string;
  condition: string;
  purchasePrice: number;
  currentMarketValue: number;
  dateAdded: string;
  imageUrl: string;
  year: string;
  brand: string;
  player: string;
  cardNumber: string;
  estimatedGrade: string;
  valueChange24h?: number;
  valueChange24hPercent?: number;
  imageHint?: string;
  features?: string[];
  parallel?: string;
  grader?: string;
  lastMarketValueUpdate?: string;
  url?: string;
  dataFlags?: string[]; // e.g. ["MISSING_IMAGE", "OUTDATED"]
  set?: string; // Manufacturer Set name (e.g. "Base Set", "Young Guns")
  epid?: string; // eBay Product ID
  upc?: string; // UPC/GTIN
  marketPrices?: {
    median: number;
    activeItems: any[];
    soldItems?: any[];
    lastUpdated: string;
  };
};

export type Auction = {
  id: string;
  card: Portfolio;
  currentBid: number;
  bids: number;
  timeLeft: string;
  watchlist: boolean;
  url?: string;
};

export type PortfolioHistory = {
  month: string;
  value: number;
};

export interface AlertConfig {
  id?: string;
  targetType: 'portfolio' | 'player' | 'brand' | 'card';
  targetValue: string; // "Connor McDavid", "Upper Deck", or specific card ID
  condition: 'above' | 'below' | 'drops_by_percent' | 'rises_by_percent';
  threshold: number;
  isActive: boolean;
}

export interface PriceAlert {
  id?: string;
  cardTitle: string;
  type: 'above' | 'below';
  targetPrice: number;
  active: boolean;
  createdAt: string;
}

export interface Alert {
  id: string;
  cardId: string;
  cardTitle: string;
  targetPrice: number;
  type: 'above' | 'below';
  active: boolean;
}

export interface MarketAlert {
  id?: string;
  type: 'rise' | 'drop' | 'optimal_sell' | 'red_flag';
  title: string;
  message: string;
  timestamp: string;
  relatedCardId?: string;
  read: boolean;
  isVerified?: boolean;
  groundedPrice?: number;
  liquidityLevel?: 'Low' | 'Moderate' | 'High';
}

export interface CardAnalysisResult {
  gradingRoi: {
    isRecommended: boolean;
    estimatedCost: number;
    potentialValueIncreasePercent: number;
    reasoning: string;
  };
  gradeProbabilities: {
    psa10_percent: number;
    psa9_percent: number;
    psa8_or_lower_percent: number;
    commonConditionIssues: string;
  };
  investmentOutlook: {
    shortTerm: 'Bearish' | 'Neutral' | 'Bullish';
    longTerm: 'Bearish' | 'Neutral' | 'Bullish';
    riskLevel: 'Low' | 'Medium' | 'High';
  };
  historicalSignificance: string;
  comparisonMatchup?: string;
}

export interface ScanJob {
  id?: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'error';
  userId: string;
  type: 'image-scan' | 'text-parse';
  payload: {
    frontPhotoDataUri?: string;
    backPhotoDataUri?: string;
    title?: string;
  };
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

