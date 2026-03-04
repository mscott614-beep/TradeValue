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
            const response = await getPortfolioInsightsAction(cards);
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
                <div className="grid gap-6">
                    <div className="grid gap-6 md:grid-cols-3">
                        <Card className="md:col-span-1">
                            <CardHeader>
                                <CardTitle>Portfolio Health</CardTitle>
                                <CardDescription>Risk scoring and assessment.</CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-col items-center justify-center pb-8 text-center">
                                <div className={cn("text-6xl font-black mb-2", getRiskColor(insights.riskScore))}>
                                    {insights.riskScore}
                                </div>
                                <Badge variant={insights.riskLevel === 'High' ? 'destructive' : insights.riskLevel === 'Moderate' ? 'secondary' : 'default'} className="mb-4">
                                    {insights.riskLevel} Risk
                                </Badge>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {insights.healthSummary}
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="md:col-span-2">
                            <CardHeader>
                                <CardTitle>AI Recommendations</CardTitle>
                                <CardDescription>Dynamic buy, sell, and hold suggestions.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    {insights.recommendations.map((rec, i) => (
                                        <div key={i} className="p-4 border rounded-lg bg-card hover:border-primary/50 transition-colors">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="font-bold text-sm truncate max-w-[150px]">{rec.cardTitle}</span>
                                                <Badge variant="outline" className="flex items-center gap-1">
                                                    {getActionIcon(rec.action)}
                                                    {rec.action}
                                                </Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-snug">
                                                {rec.reason}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-primary">
                                    <CheckCircle2 className="w-5 h-5" />
                                    Optimization Strategy
                                </CardTitle>
                                <CardDescription>Action steps to improve portfolio value.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-3">
                                    {insights.optimizationAdvice.map((advice, i) => (
                                        <li key={i} className="flex items-start gap-3 text-sm">
                                            <div className="mt-1 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                <span className="text-[10px] font-bold text-primary">{i + 1}</span>
                                            </div>
                                            <span>{advice}</span>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>

                        <Card className="bg-primary/5 border-primary/20">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                                    Risk Mitigation
                                </CardTitle>
                                <CardDescription>Automated insights on diversification.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <p className="text-sm italic">
                                    "Your current holdings have high exposure to the 1990s base card market. Consider shifting 20% of your allocated capital into graded rookie stars from the 2010s for better stability."
                                </p>
                                <div className="pt-4 border-t flex justify-center">
                                    <Button variant="outline" onClick={handleGenerateInsights} disabled={isGenerating}>
                                        {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <WandSparkles className="w-4 h-4 mr-2" />}
                                        Refresh Analysis
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
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
