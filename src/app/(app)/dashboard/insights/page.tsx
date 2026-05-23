"use client";

import { useState, useMemo, useEffect } from "react";
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase";
import { collection } from "firebase/firestore";
import type { Portfolio } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, WandSparkles, AlertTriangle, CheckCircle2, Info, TrendingUp, TrendingDown, MinusCircle, Lightbulb } from "lucide-react";
import { getPortfolioInsightsAction } from "@/app/actions/get-portfolio-insights";
import { cn } from "@/lib/utils";
import Link from "next/link";

type InsightResult = {
    riskScore: number;
    riskLevel: 'Low' | 'Moderate' | 'High';
    recommendations: {
        cardId?: string;
        cardTitle: string;
        action: 'Sell' | 'Buy' | 'Hold' | 'Hidden Gem';
        reason: string;
    }[];
    optimizationAdvice: string[];
    healthSummary: string;
    riskMitigation: string;
};

export default function InsightsPage() {
    const firestore = useFirestore();
    const { user } = useUser();
    const [insights, setInsights] = useState<InsightResult | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const portfoliosCollection = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return collection(firestore, `users/${user.uid}/portfolios`);
    }, [firestore, user]);

    const { data: cards, isLoading: cardsLoading } = useCollection<Portfolio>(portfoliosCollection);



    const handleGenerateInsights = async () => {
        if (!cards || cards.length === 0) return;

        setIsGenerating(true);
        setError(null);
        try {
            // Trim to only the fields the AI flow needs to stay under the 1 MB server action body limit
            const trimmedCards = cards.map(c => ({
                year: c.year,
                brand: c.brand,
                player: c.player,
                condition: c.condition,
                currentMarketValue: c.currentMarketValue,
                parallel: c.parallel,
                cardNumber: c.cardNumber,
                grader: c.grader,
                purchasePrice: c.purchasePrice,
            }));
            const response = await getPortfolioInsightsAction(user!.uid, trimmedCards);
            if (response.success && response.result) {
                setInsights(response.result as InsightResult);
            } else {
                setError(response.error || "Failed to generate insights.");
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred.");
        } finally {
            setIsGenerating(false);
        }
    };

    const getActionIcon = (action: string) => {
        switch (action) {
            case 'Sell': return <TrendingDown className="w-4 h-4 text-red-500" />;
            case 'Buy': return <TrendingUp className="w-4 h-4 text-green-500" />;
            case 'Hidden Gem': return <Lightbulb className="w-4 h-4 text-yellow-500" />;
            default: return <MinusCircle className="w-4 h-4 text-blue-500" />;
        }
    };

    const getRiskColor = (score: number) => {
        if (score < 30) return "text-green-500";
        if (score < 70) return "text-yellow-500";
        return "text-red-500";
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="AI Market Insights"
                description="Personalized investment advice and portfolio risk assessment."
            />



            {cardsLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : !cards || cards.length === 0 ? (
                <Card className="bg-muted/30 border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <Info className="w-12 h-12 text-muted-foreground/50 mb-4" />
                        <h3 className="font-semibold mb-2">Portfolio is Empty</h3>
                        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                            Add some cards to your collection to get AI-powered investment insights and risk scores.
                        </p>
                        <Link href="/scanner">
                            <Button>Scan Your First Card</Button>
                        </Link>
                    </CardContent>
                </Card>
            ) : !insights ? (
                <Card className="overflow-hidden">
                    <CardContent className="p-0">
                        <div className="bg-primary/5 p-8 flex flex-col items-center text-center">
                            <div className="p-4 bg-primary/10 rounded-full mb-6">
                                <WandSparkles className="w-12 h-12 text-primary" />
                            </div>
                            <h2 className="text-2xl font-bold mb-3">Analyze Your Collection</h2>
                            <p className="text-muted-foreground max-w-lg mb-8">
                                Our AI will analyze your {cards.length} cards to identify hidden value, assess risk factors, and provide a customized diversification strategy.
                            </p>
                            <Button size="lg" onClick={handleGenerateInsights} disabled={isGenerating}>
                                {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <WandSparkles className="w-4 h-4 mr-2" />}
                                Generate My Insights
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Left Panel: Portfolio Health */}
                    <Card className="flex flex-col border-primary/20 bg-card/50">
                        <CardHeader className="pb-2">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Left Panel</div>
                            <CardTitle className="text-xl">Portfolio Health</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col items-center justify-center flex-1 pb-8 text-center pt-6">
                            <div className="relative w-40 h-40 mb-8 flex items-center justify-center">
                                {/* SVG Circular Gauge */}
                                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                                    <circle cx="50" cy="50" r="42" className="stroke-muted fill-none stroke-[8]" />
                                    <circle 
                                        cx="50" cy="50" r="42" 
                                        className={cn("fill-none stroke-[8] stroke-current transition-all duration-1000 ease-out", getRiskColor(insights.riskScore))} 
                                        strokeDasharray={`${2 * Math.PI * 42}`}
                                        strokeDashoffset={`${2 * Math.PI * 42 * (1 - insights.riskScore / 100)}`}
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-5xl font-black tracking-tighter">{insights.riskScore}</span>
                                    <span className="text-[10px] font-bold text-muted-foreground tracking-widest mt-1">RISK SCORE</span>
                                </div>
                            </div>

                            <div className="flex gap-2 justify-center mb-6">
                                <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5", insights.riskLevel === 'Low' ? 'border-green-500 text-green-500 bg-green-500/10' : 'border-muted text-muted-foreground')}>LOW RISK</Badge>
                                <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5", insights.riskLevel === 'Moderate' ? 'border-yellow-500 text-yellow-500 bg-yellow-500/10' : 'border-muted text-muted-foreground')}>MODERATE</Badge>
                                <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5", insights.riskLevel === 'High' ? 'border-red-500 text-red-500 bg-red-500/10' : 'border-muted text-muted-foreground')}>MONITOR</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed px-4">
                                {insights.healthSummary}
                            </p>
                        </CardContent>
                    </Card>

                    {/* Center Panel: AI Recommendations */}
                    <Card className="flex flex-col border-primary/20 bg-card/50">
                        <CardHeader className="pb-4">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Center Panel</div>
                            <CardTitle className="text-xl">AI Recommendations</CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1">
                            <div className="grid grid-cols-2 gap-3 h-full content-start">
                                {Array.isArray(insights.recommendations) && insights.recommendations.slice(0, 4).map((rec, i) => (
                                    <div key={i} className="p-3 border rounded-xl bg-card flex flex-col relative group hover:border-primary/50 transition-colors h-full">
                                        <div className="absolute top-3 right-3 text-xs font-black text-muted-foreground/30">{i + 1}</div>
                                        <Badge variant="outline" className={cn(
                                            "text-[10px] mb-3 inline-flex items-center gap-1 border-0 px-2 py-0.5 w-fit rounded-md",
                                            rec.action === 'Buy' ? "bg-green-500/10 text-green-500" :
                                            rec.action === 'Sell' ? "bg-red-500/10 text-red-500" :
                                            rec.action === 'Hidden Gem' ? "bg-yellow-500/10 text-yellow-500" :
                                            "bg-blue-500/10 text-blue-500"
                                        )}>
                                            {getActionIcon(rec.action)}
                                            {rec.action.toUpperCase()}
                                        </Badge>
                                        <h4 className="font-bold text-xs leading-snug mb-1 pr-4">{rec.cardTitle}</h4>
                                        <p className="text-[10px] text-muted-foreground line-clamp-3 leading-snug mt-auto pt-2">
                                            {rec.reason}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Right Panel: Optimization Strategy */}
                    <Card className="flex flex-col border-primary/20 bg-card/50">
                        <CardHeader className="pb-4">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Right Panel</div>
                            <CardTitle className="text-xl">Optimization Strategy</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col flex-1 justify-between">
                            <ul className="space-y-4 mb-6">
                                {Array.isArray(insights.optimizationAdvice) && insights.optimizationAdvice.map((advice, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <div className="mt-0.5 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                            <span className="text-[10px] font-bold text-primary">{i + 1}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground leading-snug">{advice}</span>
                                    </li>
                                ))}
                            </ul>
                            
                            <div className="pt-4 border-t mt-auto space-y-4">
                                <p className="text-[11px] italic text-muted-foreground leading-relaxed">
                                    &ldquo;{insights.riskMitigation}&rdquo;
                                </p>
                                <Button size="sm" className="w-full text-xs" onClick={handleGenerateInsights} disabled={isGenerating}>
                                    {isGenerating ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <WandSparkles className="w-3 h-3 mr-2" />}
                                    Refresh Analysis
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {error && (
                <Card className="border-destructive bg-destructive/5 text-destructive p-4 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5" />
                    <p className="text-sm">{error}</p>
                </Card>
            )}
        </div>
    );
}
