export type Card = {
  id: string;
  title: string;
  year: string;
  brand: string;
  player: string;
  cardNumber: string;
  estimatedGrade: string;
  purchasePrice: number;
  currentMarketValue: number;
  dateAdded: string;
  imageUrl: string;
  valueChange24h: number;
  valueChange24hPercent: number;
  imageHint: string;
};

export type Auction = {
  id: string;
  card: Card;
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
