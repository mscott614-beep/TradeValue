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

export type Alert = {
  id: string;
  cardId: string;
  cardTitle: string;
  targetPrice: number;
  type: 'above' | 'below';
  active: boolean;
};
