import { config } from 'dotenv';
config({path: '.env.local'});
config({path: '.env'});

async function run() {
  const { getCardDeepDive } = await import('../src/ai/flows/get-card-deep-dive.ts');
  const card = {
    id: 'test',
    player: 'Connor McDavid',
    year: '2015-16',
    brand: 'Upper Deck',
    cardNumber: '1',
    currentMarketValue: 100
  };
  
  try {
    const res = await getCardDeepDive(card);
    console.log(res);
  } catch(e) {
    console.error(e);
  }
}
run();
