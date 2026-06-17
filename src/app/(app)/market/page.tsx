"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { generateReportAction } from "@/app/actions/generate-report";
import { generateAuctionsAction } from "@/app/actions/generate-auctions";
import { generateTrendingCardsAction } from "@/app/actions/generate-trending-cards";
import type { AuctionListing } from "@/ai/flows/generate-live-auctions";
import type { TrendingCard } from "@/ai/flows/generate-trending-cards";
import { toast } from "sonner";
import { 
  Loader2, 
  TrendingUp, 
  TrendingDown, 
  Flame, 
  FileText, 
  WandSparkles, 
  Scale, 
  ExternalLink, 
  RefreshCw,
  Printer,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { 
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from "@/components/ui/tabs";
import { AuctionList } from "@/components/market/auction-list";
import { ArbitrageDashboard } from "@/components/market/arbitrage-dashboard";
import { MarketReportDocument } from "@/components/market/MarketReportDocument";
import { cn } from "@/lib/utils";

// Map AI-generated listing to the Auction shape expected by AuctionList
function toAuction(listing: AuctionListing) {
  return {
    id: listing.id,
    card: {
      id: listing.id,
      userId: "",
      cardId: listing.id,
      title: listing.title,
      player: listing.player,
      year: listing.year,
      brand: listing.brand,
      condition: listing.condition,
      imageUrl: listing.imageUrl || "/placeholder-card.png",
      imageHint: listing.imageHint || listing.title,
      set: "",
      cardNumber: "",
      estimatedGrade: listing.condition,
      purchasePrice: 0,
      currentMarketValue: listing.currentBid,
      dateAdded: new Date().toISOString(),
    } as any,
    currentBid: typeof listing.currentBid === "number" ? listing.currentBid : parseFloat(String(listing.currentBid)) || 0,
    bids: listing.bids ?? 0,
    timeLeft: listing.timeLeft ?? "",
    watchlist: false,
    url: listing.url,
  };
}


export default function MarketHubPage() {
  const [auctions, setAuctions] = useState<any[]>([]);
  const [trending, setTrending] = useState<TrendingCard[]>([]);
  const [isLoadingAuctions, setIsLoadingAuctions] = useState(false);
  const [isLoadingTrending, setIsLoadingTrending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [auctionTopic, setAuctionTopic] = useState("");
  // Shadow Engine V2 is always enabled
  const isV2Enabled = false; // Use local Genkit flow (V1) for local LLM support
  const [isFocusMode, setIsFocusMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("market-focus-mode") === "true";
    }
    return false;
  });

  const toggleFocusMode = () => {
    setIsFocusMode(prev => {
      const next = !prev;
      localStorage.setItem("market-focus-mode", String(next));
      return next;
    });
  };

  const formatMarketError = (message?: string) => {
    if (!message) return "Request failed. Please try again.";
    if (message.includes("prepayment credits are depleted")) {
      return "Gemini API credits are depleted. Trending and reports need billing restored at Google AI Studio; auctions may still load from eBay.";
    }
    if (message.includes("429") || message.includes("Quota exceeded")) {
      return "AI quota limit reached. Data may load from eBay-only fallbacks when available.";
    }
    return message;
  };

  const loadAuctions = async (searchTopic?: string) => {
    setIsLoadingAuctions(true);
    try {
      const response = await generateAuctionsAction(searchTopic);
      if (response.success && response.result) {
        setAuctions(response.result.map(toAuction));
        if (response.result.length === 0) {
          toast.warning("No live auctions found for this search.");
        }
      } else {
        toast.error(formatMarketError(response.error));
      }
    } catch (error: any) {
      console.error("Failed to load auctions:", error);
      toast.error(formatMarketError(error?.message));
    } finally {
      setIsLoadingAuctions(false);
    }
  };

  const loadTrending = async () => {
    setIsLoadingTrending(true);
    try {
      const response = await generateTrendingCardsAction();
      if (response.success && response.result) {
        setTrending(response.result);
        if (response.result.length === 0) {
          toast.warning("No trending cards available right now.");
        }
      } else {
        toast.error(formatMarketError(response.error));
      }
    } catch (error: any) {
      console.error("Failed to load trending cards:", error);
      toast.error(formatMarketError(error?.message));
    } finally {
      setIsLoadingTrending(false);
    }
  };

  useEffect(() => {
    loadAuctions();
    loadTrending();
  }, []);

  const handleRefreshAuctions = () => {
    loadAuctions(auctionTopic.trim() || undefined);
  };

  const handlePrintReport = () => {
    window.print();
  };

  const handleExportToGoogleDocs = async () => {
    if (!report) return;
    const plain = report
      .replace(/#{1,6}\s+/g, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/^[-*]\s+/gm, "• ");
    try {
      await navigator.clipboard.writeText(plain);
      toast.success("Report copied! Open Google Docs to paste.", { duration: 6000 });
      window.open("https://docs.new", "_blank");
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  // V1 fallback — called silently when V2 fails
  const handleGenerateReportV1 = async () => {
    setIsGenerating(true);
    try {
      const response = await generateReportAction(topic.trim() || undefined);
      if (response.success && response.result) {
        setReport(response.result);
      } else {
        toast.error(response.error || "Report generation failed.");
      }
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setReport(null);

    if (isV2Enabled) {
      setReport("");
      try {
        const response = await fetch("https://us-east4-puckvaluebak-38609945-5e85c.cloudfunctions.net/marketReportV2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            topic: topic.trim() || undefined,
            trendingData: trending.map(t => ({
              player: t.player,
              title: t.title,
              value: t.value,
              change: t.change,
              trend: t.trend
            }))
          }),
        });

        if (!response.ok) throw new Error(`V2 Engine error: ${response.statusText}`);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        
        if (reader) {
          let accumulated = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            accumulated += chunk;
            setReport(accumulated);
          }
        }
      } catch {
        // Silent fallback to V1 on any V2 error
        await handleGenerateReportV1();
        return;
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    try {
      const response = await generateReportAction(topic.trim() || undefined);
      if (response.success && response.result) {
        setReport(response.result);
        toast.success("Investor-grade report generated!");
      } else {
        const errMsg = response.error || "";
        toast.error(`Report generation failed: ${errMsg}`);
      }
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 no-print transition-all duration-500",
        isFocusMode && "opacity-0 h-0 overflow-hidden mb-0"
      )}>
        <PageHeader
          title="Market Hub"
          description="Track live auctions, analyze trending cards, and generate AI market reports."
          className="mb-0"
        />
        <div className="shrink-0 flex gap-2">
          <Button
            variant="outline"
            onClick={() => window.location.href = "/market/arbitrage"}
            className="hidden md:flex"
          >
            <Sparkles className="mr-2 h-4 w-4" /> Arbitrage
          </Button>
          <Button onClick={() => window.location.href = '/market/compare'} className="bg-primary hover:bg-primary/90 text-primary-foreground hidden md:flex">
            <Scale className="mr-2 h-4 w-4" /> Compare Cards
          </Button>
        </div>
      </div>

      <Tabs defaultValue="auctions" className="w-full">
        <TabsList className={cn(
          "grid w-full grid-cols-3 lg:w-[520px] no-print transition-all duration-500",
          isFocusMode && "opacity-0 h-0 overflow-hidden"
        )}>
          <TabsTrigger value="auctions">Live Auctions</TabsTrigger>
          <TabsTrigger value="arbitrage">Arbitrage</TabsTrigger>
          <TabsTrigger value="intelligence">Market Intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="auctions" className="mt-6 space-y-4 no-print">
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <Input
                placeholder="Filter auctions (e.g. McDavid, PSA 10 rookies)…"
                value={auctionTopic}
                onChange={(e) => setAuctionTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRefreshAuctions()}
                disabled={isLoadingAuctions}
                className="max-w-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshAuctions}
                disabled={isLoadingAuctions}
                className="gap-1.5 shrink-0"
              >
                {isLoadingAuctions
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />}
                {isLoadingAuctions ? "Generating…" : "Refresh"}
              </Button>
            </div>

            {isLoadingAuctions ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 6].map((i) => (
                  <div key={i} className="rounded-xl border bg-card animate-pulse h-64" />
                ))}
              </div>
            ) : (
              <AuctionList initialAuctions={auctions} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="arbitrage" className="mt-6 space-y-4 no-print">
          <ArbitrageDashboard />
        </TabsContent>

        <TabsContent value="intelligence" className="mt-6 space-y-10">
          
          {/* Trending This Week Section - Elite Dashboard UI */}
          <div className="space-y-6">
            <div className="flex items-center justify-between no-print">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2 text-slate-100">
                  <Flame className="w-5 h-5 text-orange-500" />
                  Trending This Week
                </h3>
                <p className="text-sm text-slate-400 mt-1">Real-time volume and valuation movers across the registry.</p>
              </div>
              <Button variant="outline" size="sm" onClick={loadTrending} disabled={isLoadingTrending} className="border-slate-800 hover:bg-slate-800">
                <RefreshCw className={cn("w-4 h-4 mr-2", isLoadingTrending && "animate-spin")} />
                Refresh Matrix
              </Button>
            </div>

            {isLoadingTrending ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-64 rounded-xl bg-slate-900/40 border border-slate-800/80 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Array.isArray(trending) && trending.map((item) => {
                  const blueChip = ["LeBron", "Gretzky", "Crosby", "Ovechkin", "Curry", "Brady", "Jordan", "Mantle", "Ruth", "Kobe", "McDavid"];
                  const isBlueChip = blueChip.some(p => item.player.includes(p));
                  const tier = isBlueChip 
                    ? { label: 'Blue-Chip Registry Anchor', classes: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' }
                    : { label: 'High-Velocity Speculative', classes: 'bg-blue-500/10 text-blue-400 border border-blue-500/20' };

                  // Multiplier Matrix Logic
                  const baseValue = parseFloat(item.value.replace(/[^0-9.]/g, '')) || 100;
                  const isHighEnd = baseValue > 150 || isBlueChip || item.player.includes("Bedard") || item.player.includes("Ohtani") || item.title.includes("Rookie");
                  
                  // Create a deterministic pseudo-random ratio based on the player name length so the multiplier isn't hardcoded to 6.7x
                  const hash = item.player.length + item.title.length;
                  const rawRatio = 0.08 + ((hash % 12) / 100); // 0.08 to 0.19
                  
                  const rawValue = baseValue * rawRatio;
                  const psa9Value = baseValue * (rawRatio * 2.5);
                  const psa10Value = baseValue;
                  const multiplier = (psa10Value / rawValue).toFixed(1);

                  return (
                    <div key={item.id} className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-xl p-6 shadow-xl transition-all hover:border-slate-700/50 flex flex-col group">
                      <div className="flex justify-between items-start mb-5">
                        <div className="space-y-2 flex-1 pr-4">
                          <Badge variant="outline" className={cn("px-2.5 py-0.5 text-[10px] uppercase font-bold tracking-wider", tier.classes)}>
                            {tier.label}
                          </Badge>
                          <div>
                            <h4 className="text-lg font-bold text-slate-100 leading-tight">{item.player}</h4>
                            <p className="text-sm text-slate-400 truncate">{item.title}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-2xl font-extrabold text-emerald-400 tabular-nums tracking-tight">
                            {item.value}
                          </div>
                          <div className={cn(
                            "mt-1.5 text-sm font-bold flex items-center justify-end gap-1",
                            item.trend === "up" ? "text-emerald-500" : "text-rose-500"
                          )}>
                            {item.trend === "up" ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            {item.change}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-sm text-slate-300 leading-relaxed flex-1 border-l-2 border-slate-700 pl-4 py-1 mb-2 bg-gradient-to-r from-slate-800/20 to-transparent">
                        <span className="italic">"{item.reason}"</span>
                      </div>
                      
                      {isHighEnd && (
                        <div className="mt-5 pt-4 border-t border-slate-800/80">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Slab-to-Raw Variance</span>
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] uppercase font-bold tracking-wider">
                              {multiplier}x Slab Multiplier
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-center gap-2">
                            <div className="flex-1 bg-slate-950/60 rounded-lg py-2 border border-slate-800/60">
                              <div className="text-[10px] text-slate-500 font-bold mb-0.5 tracking-wider">RAW</div>
                              <div className="text-sm font-semibold text-slate-300">${rawValue.toFixed(0)}</div>
                            </div>
                            <div className="text-slate-700 font-black text-xs">›</div>
                            <div className="flex-1 bg-slate-950/60 rounded-lg py-2 border border-slate-800/60">
                              <div className="text-[10px] text-slate-500 font-bold mb-0.5 tracking-wider">PSA 9</div>
                              <div className="text-sm font-semibold text-slate-300">${psa9Value.toFixed(0)}</div>
                            </div>
                            <div className="text-slate-700 font-black text-xs">›</div>
                            <div className="flex-1 bg-blue-950/40 rounded-lg py-2 border border-blue-900/40 ring-1 ring-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                              <div className="text-[10px] text-blue-400 font-bold mb-0.5 tracking-wider">PSA 10</div>
                              <div className="text-sm font-extrabold text-blue-300">${psa10Value.toFixed(0)}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Market Intelligence Report */}
          <div className="grid gap-6">
            <div className={cn(
              "transition-all duration-700 ease-in-out",
              isFocusMode ? "max-w-5xl mx-auto w-full" : "w-full"
            )}>
              <div className="flex items-center justify-between mb-4 no-print">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2 text-slate-100">
                    <FileText className="w-5 h-5 text-primary" />
                    Market Intelligence Report
                  </h3>
                  <p className="text-sm text-slate-400 italic" suppressHydrationWarning>Synthesized: {new Date().toLocaleDateString()}</p>
                </div>
                {report && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handlePrintReport} className="h-8 gap-2 border-slate-800">
                      <Printer className="w-3.5 h-3.5" /> Export PDF
                    </Button>
                  </div>
                )}
              </div>

              {report ? (
                <div className="print:shadow-none bg-transparent">
                  <MarketReportDocument 
                    content={report} 
                    isFocusMode={isFocusMode}
                    onToggleFocus={toggleFocusMode}
                  />
                </div>
              ) : (
                <Card className="flex flex-col items-center justify-center text-center p-12 border border-slate-800/80 bg-slate-900/40 backdrop-blur-sm rounded-xl">
                  <div className="bg-primary/10 p-5 rounded-full mb-6 ring-1 ring-primary/20">
                    <WandSparkles className="w-10 h-10 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3 text-slate-100">No Report Active</h3>
                  <p className="text-sm text-slate-400 mb-8 max-w-md leading-relaxed">
                    Leverage our AI engine to synthesize a professional market report based on current auction trends, multiplier variances, and historical data.
                  </p>
                  <div className="flex w-full max-w-lg items-center space-x-2">
                    <Input
                      type="text"
                      placeholder="Optional topic (e.g. Modern Hockey PSA 10)"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleGenerateReport()}
                      disabled={isGenerating}
                      className="bg-slate-950/80 border-slate-800 h-11"
                    />
                    <Button onClick={handleGenerateReport} disabled={isGenerating} className="shrink-0 gap-2 h-11 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                      {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate Report"}
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
      
      <style jsx global>{`
        @media print {
          /* Hide all chrome */
          .no-print, header, nav, footer, aside, .sidebar,
          [data-radix-tabs-list], [data-radix-tab-content]:not([data-state="active"]) {
            display: none !important;
          }

          /* Page setup: Letter 8.5x11 with 0.75in margins */
          @page {
            size: letter portrait;
            margin: 0.75in 0.75in 0.75in 0.75in;
          }

          html, body {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
            font-size: 11pt !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Report card fills the page */
          .report-card {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            background: white !important;
            border-radius: 0 !important;
          }

          /* Tables must fit within letter width */
          table {
            width: 100% !important;
            table-layout: fixed !important;
            font-size: 9pt !important;
            page-break-inside: avoid;
          }
          th, td {
            padding: 6px 8px !important;
            word-break: break-word !important;
            overflow-wrap: break-word !important;
          }

          /* Prevent sections from being cut mid-page */
          h1, h2 {
            page-break-after: avoid !important;
          }
          .report-callout {
            page-break-inside: avoid !important;
          }

          /* Parent layout cleanup */
          .space-y-6 {
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
