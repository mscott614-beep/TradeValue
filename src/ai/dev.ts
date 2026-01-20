import { config } from 'dotenv';
config();

import '@/ai/flows/predict-auction-win-probability.ts';
import '@/ai/flows/scan-card-and-add-metadata.ts';