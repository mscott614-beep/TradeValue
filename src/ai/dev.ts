import { config } from 'dotenv';
config();

import '@/ai/flows/predict-auction-win-probability.ts';
import '@/ai/flows/scan-card-and-add-metadata.ts';
import '@/ai/flows/get-portfolio-insights.ts';
import '@/ai/flows/market-scanner.ts';
import '@/ai/flows/analyze-card.ts';
import '@/ai/flows/parse-csv-titles.ts';