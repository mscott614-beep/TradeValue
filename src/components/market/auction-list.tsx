"use client";

import { useState } from "react";
import {
  predictAuctionWinProbability,
  type PredictAuctionWinProbabilityOutput,
} from "@/ai/flows/predict-auction-win-probability";
import type { Auction } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";
import { WandSparkles, Loader2, Info, Clock, BarChartBig, Users } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

function AuctionItem({ auction }: { auction: Auction }) {
  const [userBid, setUserBid] = useState("");
  const [prediction, setPrediction] =
    useState<PredictAuctionWinProbabilityOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handlePredict = async () => {
    const bidAmount = parseFloat(userBid);
    if (isNaN(bidAmount) || bidAmount <= 0) {
      toast({
        title: "Invalid Bid",
        description: "Please enter a valid bid amount.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setPrediction(null);
    try {
      const result = await predictAuctionWinProbability({
        auctionItemDescription: `Card: ${auction.card.title}, Current Bid: $${auction.currentBid}, Bids: ${auction.bids}, Time Left: ${auction.timeLeft}`,
        userBidAmount: bidAmount,
      });
      setPrediction(result);
    } catch (error) {
      console.error("AI Prediction Error:", error);
      toast({
        title: "Prediction Failed",
        description: "The AI could not generate a prediction. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const getProgressColor = (value: number) => {
    if (value > 75) return "bg-green-500";
    if (value > 40) return "bg-yellow-500";
    return "bg-red-500";
  }

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-3">
        <div className="p-4 flex flex-col items-center justify-center bg-muted/50">
          <Image
            src={auction.card.imageUrl}
            alt={auction.card.title}
            width={200}
            height={280}
            className="rounded-md object-contain"
            data-ai-hint={auction.card.imageHint}
          />
        </div>
        <div className="md:col-span-2">
            <CardHeader>
                <CardTitle>{auction.card.title}</CardTitle>
                <CardDescription>From {auction.card.brand} - {auction.card.year}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /><div><span className="text-muted-foreground">Current Bid:</span><br/><span className="font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(auction.currentBid)}</span></div></div>
                    <div className="flex items-center gap-2"><BarChartBig className="w-4 h-4 text-primary" /><div><span className="text-muted-foreground">Bids:</span><br/><span className="font-semibold">{auction.bids}</span></div></div>
                    <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /><div><span className="text-muted-foreground">Time Left:</span><br/><span className="font-semibold">{auction.timeLeft}</span></div></div>
                </div>
            
                <Accordion type="single" collapsible>
                    <AccordionItem value="item-1">
                        <AccordionTrigger className="text-sm font-semibold text-primary hover:no-underline [&[data-state=open]>svg]:text-primary">
                            <WandSparkles className="w-4 h-4 mr-2" /> AI Win Probability
                        </AccordionTrigger>
                        <AccordionContent className="pt-4 space-y-4">
                            <div className="flex gap-2">
                                <Input
                                    type="number"
                                    placeholder="Your max bid ($)"
                                    value={userBid}
                                    onChange={(e) => setUserBid(e.target.value)}
                                    disabled={isLoading}
                                    className="bg-background"
                                />
                                <Button onClick={handlePredict} disabled={isLoading}>
                                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Predict"}
                                </Button>
                            </div>

                            {prediction && (
                                <div className="space-y-3 pt-2">
                                    <div>
                                        <div className="flex justify-between mb-1 text-sm">
                                            <span className="font-medium">Win Probability</span>
                                            <span className={cn("font-semibold", getProgressColor(prediction.winProbability * 100).replace('bg-','text-'))}>
                                                {(prediction.winProbability * 100).toFixed(0)}%
                                            </span>
                                        </div>
                                        <Progress value={prediction.winProbability * 100} indicatorClassName={getProgressColor(prediction.winProbability * 100)} />
                                    </div>
                                    <div className="text-xs text-muted-foreground p-3 bg-muted rounded-md flex gap-2">
                                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                                        <p><span className="font-semibold text-foreground">AI Reasoning:</span> {prediction.reasoning}</p>
                                    </div>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </CardContent>
        </div>
      </div>
    </Card>
  );
}
const DollarSign = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <line x1="12" x2="12" y1="2" y2="22" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);


export function AuctionList({
  initialAuctions,
}: {
  initialAuctions: Auction[];
}) {
  return (
    <div className="space-y-6">
      {initialAuctions.map((auction) => (
        <AuctionItem key={auction.id} auction={auction} />
      ))}
    </div>
  );
}
