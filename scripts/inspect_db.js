const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with credentials from the environment or default application credentials
try {
  admin.initializeApp();
} catch (e) {
  if (!/already exists/.test(e.message)) {
    console.error('Firebase initialization error', e.stack);
  }
}

async function checkDatabase() {
  const db = admin.firestore();
  try {
    const usersSnap = await db.collection('users').where('email', '==', 'mscott614@gmail.com').get();
    if (usersSnap.empty) {
      console.log("User not found by email. Finding all users to see what exists.");
      const allUsers = await db.collection('users').limit(5).get();
      allUsers.forEach(doc => console.log(doc.id, doc.data().email));
      return;
    }
    const userId = usersSnap.docs[0].id;
    console.log(`User ID: ${userId}`);

    const portfoliosSnap = await db.collection(`users/${userId}/portfolios`).get();
    console.log(`Found ${portfoliosSnap.size} cards in portfolio.`);

    let cards = [];
    portfoliosSnap.forEach(doc => {
      const data = doc.data();
      cards.push({
        id: doc.id,
        player: data.player,
        currentMarketValue: data.currentMarketValue,
        type: typeof data.currentMarketValue,
        valueChange24h: data.valueChange24h,
        valueChange24hPercent: data.valueChange24hPercent
      });
    });

    console.log(JSON.stringify(cards.slice(0, 5), null, 2));
    
    // Calculate total value
    const tValue = cards.reduce((acc, card) => acc + (card.currentMarketValue || 0), 0);
    console.log(`tValue calculation result: ${tValue} (type: ${typeof tValue})`);

  } catch (error) {
    console.error("Error querying db:", error);
  }
}

checkDatabase();
