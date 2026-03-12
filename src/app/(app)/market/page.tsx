"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { generateReportAction } from "@/app/actions/generate-report";
import { generateAuctionsAction } from "@/app/actions/generate-auctions";
import { generateTrendingCardsAction } from "@/app/actions/generate-trending-cards";
import type { AuctionListing } from "@/ai/flows/generate-live-auctions";
import type { TrendingCard } from "@/ai/flows/generate-trending-cards";
import ReactMarkdown from 'react-markdown';
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AuctionList } from "@/components/market/auction-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Flame, FileText, WandSparkles, Scale, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";



// Map AI-generated listing to the Auction shape expected by AuctionList
function toAuction(listing: AuctionListing) {
  return {
    id: listing.id,
    card: {
      id: listing.id,
      userId: 'ai',
      cardId: listing.id,
      title: listing.title,
      year: listing.year,
      brand: listing.brand,
      player: listing.player,
      cardNumber: '',
      estimatedGrade: listing.condition,
      condition: listing.condition,
      purchasePrice: 0,
      currentMarketValue: listing.currentBid,
      dateAdded: new Date().toISOString().split('T')[0],
      imageUrl: `https://picsum.photos/seed/${listing.id}/400/560`,
      valueChange24h: 0,
      valueChange24hPercent: 0,
      imageHint: listing.imageHint,
    },
    currentBid: listing.currentBid,
    bids: listing.bids,
    timeLeft: listing.timeLeft,
    watchlist: false,
  };
}

export default function MarketPage() {
  const [report, setReport] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const [auctions, setAuctions] = useState<ReturnType<typeof toAuction>[]>([]);
  const [isLoadingAuctions, setIsLoadingAuctions] = useState(true);
  const [auctionTopic, setAuctionTopic] = useState("");

  const [trending, setTrending] = useState<TrendingCard[]>([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(true);

  const loadAuctions = async (searchTopic?: string) => {
    setIsLoadingAuctions(true);
    try {
      const response = await generateAuctionsAction(searchTopic);
      if (response.success && response.result) {
        setAuctions(response.result.map(toAuction));
      } else {
        toast.error("Could not load AI auctions. Please refresh.");
      }
    } catch {
      toast.error("Failed to load auctions.");
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
      } else {
        toast.error("Could not load trending cards.");
      }
    } catch {
      toast.error("Failed to load trending cards.");
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
      toast.success("Report copied! Paste it into your new Google Doc.", { duration: 6000 });
    } catch {
      toast.error("Could not copy to clipboard. Please copy the report text manually.");
    }
    window.open("https://docs.new", "_blank");
  };

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setReport(null);
    try {
      const response = await generateReportAction(topic.trim() || undefined);
      if (response.success && response.result) {
        setReport(response.result);
      } else {
        const errMsg = response.error || "";
        if (errMsg.includes("429") || errMsg.includes("Quota exceeded") || errMsg.includes("Too Many Requests")) {
          toast.error("AI Quota Exceeded. Please wait a minute for your limit to reset and try again.");
        } else {
          toast.error(`Report generation failed: ${errMsg}`);
        }
      }
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
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
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
          <TabsTrigger value="auctions">Live Auctions</TabsTrigger>
          <TabsTrigger value="intelligence">Market Intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="auctions" className="mt-6 space-y-4">
          {/* Coming Soon watermark */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-lg">
              <span
                className="rotate-[-35deg] select-none text-[clamp(2.5rem,8vw,5rem)] font-black uppercase tracking-widest text-foreground/[0.07] whitespace-nowrap"
                style={{ letterSpacing: "0.25em" }}
              >
                Coming Soon
              </span>
            </div>
            {/* Auction search / refresh bar */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="Filter by topic (e.g. McDavid, PSA 10, rookies)…"
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
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-lg border bg-card animate-pulse h-48" />
                ))}
              </div>
            ) : (
              <AuctionList initialAuctions={auctions} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="intelligence" className="mt-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-orange-500" />
                    Trending Cards
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={loadTrending} disabled={isLoadingTrending} className="gap-1.5 text-xs">
                    {isLoadingTrending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Refresh
                  </Button>
                </div>
                <CardDescription>AI-curated biggest movers this week.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingTrending ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-16 rounded-lg bg-muted/50 animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {trending.map((item) => (
                      <div key={item.id} className="flex items-start justify-between p-3 bg-muted/50 rounded-lg gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{item.player}</div>
                          <div className="text-sm text-muted-foreground truncate">{item.title}</div>
                          <div className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-1 italic">{item.reason}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold">{item.value}</div>
                          <Badge
                            variant="outline"
                            className={`mt-1 flex items-center gap-1 ${item.trend === "up" ? "text-green-500 border-green-500/30" : "text-red-400 border-red-400/30"}`}
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

            <Card className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    Weekly Market Report
                  </CardTitle>
                  {report && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportToGoogleDocs}
                      className="text-xs gap-1.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Export to Google Docs
                    </Button>
                  )}
                </div>
                <CardDescription>AI-generated analysis of current market conditions.</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-6 min-h-[300px]">
                {report ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-md">
                    <ReactMarkdown>{report}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center items-center text-center bg-muted/30 rounded-lg border border-dashed p-6">
                    <FileText className="w-12 h-12 text-muted-foreground/50 mb-4" />
                    <h3 className="font-semibold mb-2">No Recent Report Generated</h3>
                    <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                      Generate a fresh AI market analysis to get insights on hot players, cold streaks, and investment opportunities.
                    </p>
                    <div className="flex w-full max-w-sm items-center space-x-2">
                      <Input
                        type="text"
                        placeholder="Optional: Enter a specific topic (e.g. Connor McDavid)"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        disabled={isGenerating}
                      />
                      <Button onClick={handleGenerateReport} disabled={isGenerating}>
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><WandSparkles className="w-4 h-4 mr-2" />Generate</>}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
