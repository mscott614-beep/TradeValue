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
  Zap
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { MarketReportDocument } from "@/components/market/MarketReportDocument";
import { cn } from "@/lib/utils";

// Map AI-generated listing to the Auction shape expected by AuctionList
function toAuction(listing: AuctionListing) {
  return {
    id: listing.id,
    card: {
      name: listing.title,
      image: listing.imageUrl || "/placeholder-card.png",
      set: listing.platform,
      number: "",
      rarity: "Live Auction"
    },
    price: listing.currentPrice,
    endTime: listing.endTime,
    bids: listing.bidCount,
    shipping: 0,
    url: listing.url,
    platform: listing.platform as "ebay" | "pwcc" | "goldin"
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
  const [isV2Enabled, setIsV2Enabled] = useState(false);
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

  const loadAuctions = async (searchTopic?: string) => {
    setIsLoadingAuctions(true);
    try {
      const response = await generateAuctionsAction(searchTopic);
      if (response.success && response.result) {
        setAuctions(response.result.map(toAuction));
      }
    } catch (error) {
      console.error("Failed to load auctions:", error);
      toast.error("Failed to load live auctions.");
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
      }
    } catch (error) {
      console.error("Failed to load trending cards:", error);
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

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setReport(null);

    if (isV2Enabled) {
      setReport("");
      try {
        const response = await fetch("https://marketreportv2-i2233dwbnq-uk.a.run.app", {
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
        // Silent fallback to V1 — no toast interruption
        setIsV2Enabled(false);
        await handleGenerateReport();
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
        <div className="shrink-0">
          <Button onClick={() => window.location.href = '/market/compare'} className="bg-primary hover:bg-primary/90 text-primary-foreground hidden md:flex">
            <Scale className="mr-2 h-4 w-4" /> Compare Cards
          </Button>
        </div>
      </div>

      <Tabs defaultValue="auctions" className="w-full">
        <TabsList className={cn(
          "grid w-full grid-cols-2 lg:w-[400px] no-print transition-all duration-500",
          isFocusMode && "opacity-0 h-0 overflow-hidden"
        )}>
          <TabsTrigger value="auctions">Live Auctions</TabsTrigger>
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

        <TabsContent value="intelligence" className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className={cn(
              "lg:col-span-1 no-print transition-all duration-500",
              isFocusMode && "opacity-0 w-0 h-0 overflow-hidden p-0 m-0"
            )}>
              <Card className="sticky top-6">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Flame className="w-5 h-5 text-orange-500" />
                      Trending Cards
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={loadTrending} disabled={isLoadingTrending} className="h-8 w-8 p-0">
                      <RefreshCw className={cn("w-4 h-4", isLoadingTrending && "animate-spin")} />
                    </Button>
                  </div>
                  <CardDescription>Real-time market movers and shakers.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingTrending ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 rounded-lg bg-muted/50 animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {Array.isArray(trending) && trending.map((item) => (
                        <div key={item.id} className="flex items-start justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors rounded-lg gap-3 text-sm border border-transparent hover:border-border/50">
                          <div className="min-w-0">
                            <div className="font-bold truncate">{item.player}</div>
                            <div className="text-xs text-muted-foreground truncate">{item.title}</div>
                            <div className="text-[10px] text-primary/70 mt-1 line-clamp-2 leading-tight italic">{item.reason}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono font-bold">{item.value}</div>
                            <Badge
                              variant="outline"
                              className={cn(
                                "mt-1.5 px-1 py-0 text-[10px] flex items-center gap-0.5 border-none bg-transparent",
                                item.trend === "up" ? "text-green-500" : "text-red-400"
                              )}
                            >
                              {item.trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {item.change}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className={cn(
              "transition-all duration-700 ease-in-out",
              isFocusMode ? "lg:col-span-3 max-w-5xl mx-auto" : "lg:col-span-2"
            )}>
              <div className="flex items-center justify-between mb-4 no-print">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    Market Intelligence Report
                  </h3>
                  <p className="text-sm text-muted-foreground italic" suppressHydrationWarning>Generated: {new Date().toLocaleDateString()}</p>
                </div>
                {report && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handlePrintReport} className="h-8 gap-2">
                      <Printer className="w-3.5 h-3.5" /> PDF
                    </Button>
                    <Button variant="secondary" size="sm" onClick={handleExportToGoogleDocs} className="h-8 gap-2">
                      <ExternalLink className="w-3.5 h-3.5" /> Export
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
                <Card className="flex flex-col items-center justify-center text-center p-12 border-dashed bg-muted/20">
                  <div className="bg-primary/10 p-4 rounded-full mb-6">
                    <WandSparkles className="w-10 h-10 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">No Report Active</h3>
                  <p className="text-sm text-muted-foreground mb-8 max-w-sm">
                    Leverage our AI engine to synthesize a professional market report based on current auction trends and historical data.
                  </p>
                  <div className="flex w-full max-w-md items-center space-x-2">
                    <Input
                      type="text"
                      placeholder="Optional topic (e.g. Modern Hockey PSA 10)"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      disabled={isGenerating}
                      className="bg-background"
                    />
                    <Button onClick={handleGenerateReport} disabled={isGenerating} className="shrink-0 gap-2">
                      {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate"}
                    </Button>
                  </div>
                  <div className="mt-4 flex items-center space-x-2 bg-primary/5 px-3 py-2 rounded-full border border-primary/10">
                    <Switch 
                      id="v2-mode" 
                      checked={isV2Enabled} 
                      onCheckedChange={setIsV2Enabled}
                      disabled={isGenerating}
                    />
                    <Label htmlFor="v2-mode" className="text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                      <Zap className={cn("w-3 h-3", isV2Enabled ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground")} />
                      v2 Experimental (Shadow Engine)
                    </Label>
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
