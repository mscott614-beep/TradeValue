"use client";

import { useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Loader2,
  Sparkles,
  TrendingDown,
  AlertTriangle,
  BadgeDollarSign
} from "lucide-react";
import { cn } from "@/lib/utils";

type ArbitrageAlert = {
  id: string;
  cardId: string;
  userId: string;
  player: string;
  title: string;
  listingTitle: string;
  listingUrl: string;
  listingImageUrl: string;
  marketValue: number;
  listingPrice: number;
  potentialProfit: number;
  confidenceScore: number;
  aiReason: string;
  detectedAt: string;
  status: string;
};

function confidenceBadgeClass(score: number) {
  if (score >= 90) return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
  if (score >= 80) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ArbitrageDashboard() {
  const firestore = useFirestore();

  const alertsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, "arbitrage_alerts"),
      orderBy("detectedAt", "desc"),
      limit(20)
    );
  }, [firestore]);

  const { data: rawAlerts, isLoading } = useCollection<ArbitrageAlert>(alertsQuery);

  const alerts = useMemo(() => {
    const list = (rawAlerts || []).filter((s) => s.status === "active");
    return list;
  }, [rawAlerts]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Hunting for live arbitrage deals...
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card className="border-dashed bg-slate-900/40 backdrop-blur-sm border-slate-800">
        <CardHeader className="text-center p-12">
          <div className="flex justify-center mb-6">
            <div className="bg-emerald-500/10 p-5 rounded-full ring-1 ring-emerald-500/20">
              <Sparkles className="h-10 w-10 text-emerald-500" />
            </div>
          </div>
          <CardTitle className="text-2xl mb-2 text-slate-100">
            No Active Deals Detected
          </CardTitle>
          <CardDescription className="max-w-md mx-auto text-slate-400 leading-relaxed">
            Our background hunter continuously scans live eBay listings. When an item is found at a 30%+ discount to its portfolio benchmark, it will appear here instantly.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
         <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
           Live, AI-verified arbitrage alerts. The Shadow Engine scans active listings against your benchmark values and filters out noise (reprints, lots, damaged cards) to deliver clean, actionable profit opportunities.
         </p>
         <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1.5 py-1 px-3 uppercase tracking-widest text-[10px]">
           <Sparkles className="w-3 h-3" />
           Live Deal Feed
         </Badge>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {alerts.map((alert) => {
          const discountPercent = ((alert.marketValue - alert.listingPrice) / alert.marketValue) * 100;

          return (
            <Card
              key={alert.id}
              className="overflow-hidden border-slate-800/80 hover:border-slate-700/80 bg-slate-900/60 backdrop-blur-md shadow-xl transition-all flex flex-col group"
            >
              {/* Premium Card Image Header */}
              <div className="relative h-44 w-full overflow-hidden bg-slate-950/60 border-b border-slate-800/50 flex items-center justify-center group-hover:bg-slate-950/40 transition-all duration-300">
                {alert.listingImageUrl ? (
                  <img
                    src={alert.listingImageUrl}
                    alt={alert.listingTitle}
                    className="h-full w-full object-contain p-2 transition-transform duration-500 group-hover:scale-105"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = "/placeholder-card.png";
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-600 gap-2">
                    <Sparkles className="w-8 h-8 opacity-25" />
                    <span className="text-[10px] uppercase font-bold tracking-wider opacity-40">No Image Available</span>
                  </div>
                )}
                {/* Glassmorphic discount percentage pill */}
                <div className="absolute top-3 left-3 bg-emerald-500/90 text-white backdrop-blur-md px-2.5 py-0.5 rounded-full border border-emerald-400/30 shadow-lg text-[10px] font-bold uppercase tracking-wider">
                  {discountPercent.toFixed(0)}% Off
                </div>
                {/* Match confidence overlay */}
                <div className="absolute bottom-3 right-3 bg-slate-950/80 text-slate-300 backdrop-blur-md px-2 py-0.5 rounded-md border border-slate-800 text-[9px] font-mono">
                  {alert.confidenceScore}% Match
                </div>
              </div>

              <CardHeader className="pb-3 border-b border-slate-800/50 bg-slate-900/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base leading-tight truncate text-slate-100 font-bold group-hover:text-emerald-400 transition-colors">
                      {alert.player}
                    </CardTitle>
                    <CardDescription className="text-xs mt-1 text-slate-400 truncate font-mono">
                      {alert.title}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4 pt-4 flex-1 flex flex-col">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-slate-950/60 p-2 border border-slate-800/60">
                    <div className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mb-1">Market</div>
                    <div className="font-mono font-semibold text-slate-300">{formatUsd(alert.marketValue)}</div>
                  </div>
                  <div className="rounded-xl bg-slate-950/60 p-2 border border-slate-800/60">
                    <div className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mb-1">Listing</div>
                    <div className="font-mono font-bold text-rose-400">
                      {formatUsd(alert.listingPrice)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-emerald-950/30 p-2 border border-emerald-900/30 ring-1 ring-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.05)]">
                    <div className="text-[9px] uppercase text-emerald-500/70 font-bold tracking-wider mb-1">Profit</div>
                    <div className="font-mono font-black text-emerald-400">
                      +{formatUsd(alert.potentialProfit)}
                    </div>
                  </div>
                </div>

                <div className="flex-1 bg-slate-950/40 rounded-lg p-3 border border-slate-800/50">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-emerald-400 animate-pulse" /> 
                    AI Deal Analysis
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed italic line-clamp-3">
                    "{alert.aiReason}"
                  </p>
                </div>
                
                <div className="bg-slate-900/40 -mx-6 -mb-6 px-6 py-4 mt-2 border-t border-slate-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
                      <AlertTriangle className="h-3 w-3" />
                      Detected {new Date(alert.detectedAt).toLocaleTimeString()}
                    </div>
                    
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 gap-2 h-8 px-4" asChild>
                      <a
                        href={alert.listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <BadgeDollarSign className="w-3.5 h-3.5" /> Buy on eBay
                      </a>
                    </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
