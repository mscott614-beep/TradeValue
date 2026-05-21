"use client";

import { useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import type { ArbitrageSignal } from "@/lib/arbitrage";
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
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StoredSignal = Omit<ArbitrageSignal, "id"> & {
  qualifies?: boolean;
};

function confidenceBadgeClass(confidence: string) {
  if (confidence === "high") return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
  if (confidence === "medium") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
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

  const signalsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, "arbitrage_signals"),
      orderBy("arbitrageScore", "desc"),
      limit(40)
    );
  }, [firestore]);

  const { data: rawSignals, isLoading } = useCollection<StoredSignal>(signalsQuery);

  const signals = useMemo(() => {
    const list = (rawSignals || []).filter(
      (s) => s.status === "active" && s.arbitrageScore > 0
    );
    return list.sort((a, b) => b.arbitrageScore - a.arbitrageScore);
  }, [rawSignals]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Scanning arbitrage opportunities…
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            No active arbitrage flags
          </CardTitle>
          <CardDescription>
            The background scanner runs twice daily (8:30 AM and 8:30 PM ET). When raw eBay
            listings trade far below implied PSA 10 value, opportunities appear here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Slab-to-raw spread detector: compares live raw eBay comps against PSA 10 registry pricing.
        High scores mean the observed raw/slab multiplier exceeds the weekly report baseline — a
        potential grade-and-flip candidate when pass rates are favorable.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {signals.map((signal, idx) => (
          <Card
            key={`${signal.cardKey}-${idx}`}
            className="overflow-hidden border-primary/20 hover:border-primary/40 transition-colors"
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-base leading-snug truncate">
                    {signal.title || signal.player}
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {signal.year} {signal.brand}
                    {signal.cardNumber ? ` #${signal.cardNumber}` : ""}
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className={cn("shrink-0 font-mono", confidenceBadgeClass(signal.confidence))}
                >
                  {signal.arbitrageScore}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/40 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Raw median</div>
                  <div className="font-mono font-bold">{formatUsd(signal.rawMedianUsd)}</div>
                </div>
                <div className="rounded-lg bg-muted/40 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">PSA 10</div>
                  <div className="font-mono font-bold text-primary">
                    {formatUsd(signal.slabMedianUsd)}
                  </div>
                </div>
                <div className="rounded-lg bg-emerald-500/10 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Spread</div>
                  <div className="font-mono font-bold text-emerald-600">
                    {formatUsd(signal.spreadUsd)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary" className="gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {signal.multiplierObserved}x observed
                </Badge>
                <Badge variant="outline">
                  {signal.multiplierExpected}x expected
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {signal.gradingPassRate} pass rate
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed italic">
                {signal.gradingNote}
              </p>

              {signal.bestRawListing && (
                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase text-muted-foreground mb-0.5">
                      Best underpriced raw
                    </div>
                    <div className="truncate font-medium text-xs">
                      {signal.bestRawListing.title}
                    </div>
                    <div className="font-mono text-sm font-bold text-emerald-600">
                      {formatUsd(signal.bestRawListing.price)}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" asChild>
                    <a
                      href={signal.bestRawListing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      eBay
                    </a>
                  </Button>
                </div>
              )}

              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <AlertTriangle className="h-3 w-3" />
                Detected {new Date(signal.detectedAt).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
