'use client';

import React from 'react';
import { useCollection, useMemoFirebase, useFirestore } from '@/firebase';
import { collection, query, limit } from 'firebase/firestore';
import { useDemo } from '@/context/demo-context';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

interface MarketPrice {
  id: string;
  name: string;
  price: string;
  change: string;
  up: boolean;
}
export function TickerComponent() {
  const firestore = useFirestore();
  const { isDemo, setIsDemo } = useDemo();
  const router = useRouter();

  const pricesQuery = useMemoFirebase(() => {
    return query(collection(firestore, 'market_prices'), limit(20));
  }, [firestore]);

  const { data: prices, isLoading } = useCollection<MarketPrice>(pricesQuery);

  const handleExitDemo = () => {
    setIsDemo(false);
    router.push('/');
  };

  if (isDemo) {
    const whaleData = [
      { name: '1952 Mickey Mantle #311 PSA 9', price: '$12,600,000', change: '+2.4%', up: true },
      { name: '1979 O-Pee-Chee Wayne Gretzky RC PSA 10', price: '$3,750,000', change: '+0.8%', up: true },
      { name: '1909 T206 Honus Wagner', price: '$7,250,000', change: '-1.2%', up: false },
      { name: '2003 LeBron James Exquisite RPA /99', price: '$5,200,000', change: '+4.5%', up: true },
      { name: '1952 Topps Mickey Mantle PSA 8', price: '$2,100,000', change: '+1.1%', up: true },
    ];
    return <TickerLayout items={whaleData} isDemo={true} onExit={handleExitDemo} />;
  }

  if (isLoading || !prices || prices.length === 0) {
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

function TickerLayout({ items, isDemo, onExit }: { items: any[], isDemo?: boolean, onExit?: () => void }) {
  // Double the items for seamless loop
  const displayItems = [...items, ...items];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] bg-[#1e293b]/90 backdrop-blur-md py-3 border-t border-slate-800 overflow-hidden select-none flex items-center">
      <div className="flex-1 overflow-hidden relative">
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
      
      {isDemo && onExit && (
        <div className="px-4 border-l border-slate-700 bg-[#1e293b] h-full flex items-center z-[110]">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onExit}
            className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 gap-2 font-bold uppercase tracking-tighter"
          >
            <LogOut className="w-3 h-3" />
            Demo Mode - Exit
          </Button>
        </div>
      )}
    </div>
  );
}
