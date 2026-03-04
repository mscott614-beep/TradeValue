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
};

export type Auction = {
  id: string;
  card: Portfolio;
  currentBid: number;
  bids: number;
  timeLeft: string;
  watchlist: boolean;
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

export interface MarketAlert {
  id?: string;
  type: 'rise' | 'drop' | 'optimal_sell' | 'red_flag';
  title: string;
  message: string;
  timestamp: string;
  relatedCardId?: string;
  read: boolean;
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
