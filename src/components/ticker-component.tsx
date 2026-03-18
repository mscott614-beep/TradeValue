'use client';

import React from 'react';
import { useCollection, useMemoFirebase, useFirestore } from '@/firebase';
import { collection, query, limit } from 'firebase/firestore';

interface MarketPrice {
  id: string;
  name: string;
  price: string;
  change: string;
  up: boolean;
}

export function TickerComponent() {
  const firestore = useFirestore();

  const pricesQuery = useMemoFirebase(() => {
    return query(collection(firestore, 'market_prices'), limit(20));
  }, [firestore]);

  const { data: prices, isLoading } = useCollection<MarketPrice>(pricesQuery);

  if (isLoading || !prices || prices.length === 0) {
    // Fallback static data if Firestore is empty or loading
    const fallbackData = [
      { name: '1999 Base Set Charizard', price: '$420,000', change: '+5.2%', up: true },
      { name: '2000 Tom Brady RC', price: '$2,500', change: '+12.8%', up: true },
      { name: '2023 Connor Bedard Young Guns', price: '$850', change: '-2.1%', up: false },
      { name: '1986 Fleer Michael Jordan', price: '$15,400', change: '+1.4%', up: true },
      { name: '2015 Connor McDavid Collection', price: '$1,200', change: '+8.5%', up: true },
    ];
    
    return <TickerLayout items={fallbackData} />;
  }

  return <TickerLayout items={prices} />;
}

function TickerLayout({ items }: { items: any[] }) {
  // Double the items for seamless loop
  const displayItems = [...items, ...items];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] bg-[#1e293b]/90 backdrop-blur-md py-3 border-t border-slate-800 overflow-hidden select-none">
      <div className="flex animate-marquee whitespace-nowrap">
        {displayItems.map((item, i) => (
          <div key={i} className="flex items-center gap-4 mx-10">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{item.name}</span>
            <span className="text-sm font-mono font-bold text-white leading-none">{item.price}</span>
            <span className={`text-xs font-bold font-mono ${item.up ? 'text-green-400' : 'text-red-400'}`}>
              {item.up ? '▲' : '▼'} {item.change}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
