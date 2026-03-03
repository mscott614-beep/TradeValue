"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { generateReportAction } from "@/app/actions/generate-report";
import ReactMarkdown from 'react-markdown';
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AuctionList } from "@/components/market/auction-list";
import { auctions } from "@/lib/data";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Flame, FileText, ArrowUpRight, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const mockTrending = [
  { id: "1", player: "Connor McDavid", title: "2015 Upper Deck Young Guns", change: "+12.5%", value: "$1,250", trend: "up" },
  { id: "2", player: "Auston Matthews", title: "2016 SP Authentic Future Watch Auto", change: "+8.2%", value: "$850", trend: "up" },
  { id: "3", player: "Sidney Crosby", title: "2005 Upper Deck Young Guns", change: "+5.1%", value: "$2,100", trend: "up" },
];

export default function MarketPage() {
  const [report, setReport] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setReport(null);
    try {
      const response = await generateReportAction(topic.trim() || undefined);
      if (response.success && response.result) {
        setReport(response.result);
      } else {
        console.error("Failed to generate report:", response.error);
      }
    } catch (error) {
      console.error("Failed to generate report:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Hub"
        description="Track live auctions, analyze trending cards, and generate AI market reports."
      />

      <Tabs defaultValue="auctions" className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
          <TabsTrigger value="auctions">Live Auctions</TabsTrigger>
          <TabsTrigger value="intelligence">Market Intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="auctions" className="mt-6">
          <AuctionList initialAuctions={auctions} />
        </TabsContent>

        <TabsContent value="intelligence" className="mt-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Flame className="w-5 h-5 text-orange-500" />
                  Trending Cards
                </CardTitle>
                <CardDescription>Highest value increases in the last 7 days.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {mockTrending.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <div className="font-semibold">{item.player}</div>
                        <div className="text-sm text-muted-foreground">{item.title}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{item.value}</div>
                        <Badge variant="outline" className="text-green-500 border-green-500/30 mt-1 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {item.change}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Weekly Market Report
                </CardTitle>
                <CardDescription>AI-generated analysis of current market conditions.</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-6 min-h-[300px]">
                {report ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-md">
                    <ReactMarkdown>{report}</ReactMarkdown>
                    <div className="mt-8 pt-4 border-t flex justify-center">
                      <Button variant="outline" onClick={handleGenerateReport} disabled={isGenerating}>
                        {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <WandSparkles className="w-4 h-4 mr-2" />}
                        Regenerate Report
                      </Button>
                    </div>
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
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><WandSparkles className="w-4 h-4 mr-2" /> Generate</>}
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
