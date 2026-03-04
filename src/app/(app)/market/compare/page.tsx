"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ChevronLeft, Calendar, Tag, User, Hash, Info, DollarSign, BrainCircuit, Trophy, Scale } from 'lucide-react';
import type { Portfolio } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { analyzeCardAction } from "@/app/actions/analyze-card";
import type { CardAnalysisResult } from "@/lib/types";

export default function CompareCardsPage() {
    const router = useRouter();
    const { user } = useUser();
    const firestore = useFirestore();
    const { toast } = useToast();

    // Fetch user's entire portfolio for the dropdowns
    const portfoliosRef = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return collection(firestore, `users/${user.uid}/portfolios`);
    }, [firestore, user]);

    const { data: cards, isLoading: isCardsLoading } = useCollection<Portfolio>(portfoliosRef);

    // State for selected cards
    const [card1Id, setCard1Id] = useState<string>('');
    const [card2Id, setCard2Id] = useState<string>('');

    // State for analysis results
    const [analysis1, setAnalysis1] = useState<CardAnalysisResult | null>(null);
    const [analysis2, setAnalysis2] = useState<CardAnalysisResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [verdict, setVerdict] = useState<string | null>(null);

    const card1 = cards?.find(c => c.id === card1Id);
    const card2 = cards?.find(c => c.id === card2Id);

    const handleCompare = async () => {
        if (!card1 || !card2) {
            toast({
                title: "Select Cards",
                description: "Please select two distinct cards to compare.",
                variant: "destructive"
            });
            return;
        }

        setIsAnalyzing(true);
        setVerdict(null);

        try {
            const [res1, res2] = await Promise.all([
                analyzeCardAction(card1),
                analyzeCardAction(card2)
            ]);

            if (res1.success && res1.result && res2.success && res2.result) {
                setAnalysis1(res1.result);
                setAnalysis2(res2.result);

                // Simple client-side mock logic for the "Verdict" based on the AI's risk levels and value
                const riskScore1 = res1.result.investmentOutlook.riskLevel === 'Low' ? 3 : (res1.result.investmentOutlook.riskLevel === 'Medium' ? 2 : 1);
                const riskScore2 = res2.result.investmentOutlook.riskLevel === 'Low' ? 3 : (res2.result.investmentOutlook.riskLevel === 'Medium' ? 2 : 1);

                const outlookScore1 = res1.result.investmentOutlook.longTerm === 'Bullish' ? 3 : (res1.result.investmentOutlook.longTerm === 'Neutral' ? 2 : 1);
                const outlookScore2 = res2.result.investmentOutlook.longTerm === 'Bullish' ? 3 : (res2.result.investmentOutlook.longTerm === 'Neutral' ? 2 : 1);

                const total1 = riskScore1 + outlookScore1;
                const total2 = riskScore2 + outlookScore2;

                if (total1 > total2) {
                    setVerdict(`AI Verdict: The ${card1.year} ${card1.player} represents a slightly stronger long-term hold based on risk profile and market outlook.`);
                } else if (total2 > total1) {
                    setVerdict(`AI Verdict: The ${card2.year} ${card2.player} represents a slightly stronger long-term hold based on risk profile and market outlook.`);
                } else {
                    setVerdict(`AI Verdict: It's a toss-up! Both cards offer similar long-term viability profiles.`);
                }


            } else {
                toast({ title: "Analysis Failed", description: "One or both cards failed to analyze.", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to compare cards.", variant: "destructive" });
        } finally {
            setIsAnalyzing(false);
        }
    };

    if (isCardsLoading) {
        return (
            <div className="flex h-[400px] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const unselectedCards1 = cards?.filter(c => c.id !== card2Id) || [];
    const unselectedCards2 = cards?.filter(c => c.id !== card1Id) || [];

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4 mb-2">
                <Button variant="ghost" size="sm" onClick={() => router.push('/market')}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Back to Market
                </Button>
            </div>

            <PageHeader
                title="Card Comparison Tool"
                description="Pit two cards against each other in a head-to-head AI analysis."
            />

            <Card className="bg-muted/30 border-dashed">
                <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row items-center gap-6 justify-center">
                        <div className="w-full max-w-sm space-y-2">
                            <Select value={card1Id} onValueChange={setCard1Id}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select first card..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {unselectedCards1.map((c) => (
                                        <SelectItem key={c.id} value={c.id || ''}>
                                            {c.year} {c.brand} {c.player}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center justify-center p-4 bg-background rounded-full border shadow-sm shrink-0">
                            <Scale className="h-6 w-6 text-muted-foreground" />
                        </div>

                        <div className="w-full max-w-sm space-y-2">
                            <Select value={card2Id} onValueChange={setCard2Id}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select second card..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {unselectedCards2.map((c) => (
                                        <SelectItem key={c.id} value={c.id || ''}>
                                            {c.year} {c.brand} {c.player}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex justify-center mt-6">
                        <Button
                            size="lg"
                            disabled={!card1Id || !card2Id || isAnalyzing}
                            onClick={handleCompare}
                            className="bg-primary hover:bg-primary/90"
                        >
                            {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
                            Run Head-to-Head Analysis
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {(card1 && card2 && analysis1 && analysis2) && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {verdict && (
                        <Card className="border-primary/50 bg-primary/5">
                            <CardHeader className="py-4">
                                <CardTitle className="flex items-center justify-center gap-2 text-primary text-center">
                                    <Trophy className="h-6 w-6 text-yellow-500" />
                                    {verdict}
                                </CardTitle>
                            </CardHeader>
                        </Card>
                    )}

                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Card 1 Column */}
                        <div className="space-y-6">
                            <Card>
                                <CardHeader className="text-center p-4">
                                    <CardTitle className="text-xl">{card1.player}</CardTitle>
                                    <CardDescription>{card1.year} {card1.brand}</CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col items-center">
                                    <div className="relative aspect-[3/4] w-32 mb-4 bg-muted/50 rounded-sm overflow-hidden flex items-center justify-center">
                                        {card1.imageUrl ? (
                                            card1.imageUrl.startsWith('data:') ? (
                                                <img src={card1.imageUrl} alt={card1.title} className="object-contain p-2 absolute inset-0 w-full h-full" />
                                            ) : (
                                                <Image src={card1.imageUrl} alt={card1.title} fill className="object-contain p-2" />
                                            )
                                        ) : (
                                            <Info className="h-8 w-8 text-muted-foreground opacity-50" />
                                        )}
                                    </div>
                                    <Badge variant="outline" className="text-lg px-4 py-1.5 mb-2">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(card1.currentMarketValue || 0)}
                                    </Badge>
                                    <Badge variant="secondary">Grade: {card1.condition}</Badge>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="py-4 bg-muted/30">
                                    <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2">
                                        <BrainCircuit className="h-4 w-4" /> Outlook Matchup
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4 pt-4">
                                    <div className="flex justify-between items-center py-2 border-b">
                                        <span className="text-sm text-muted-foreground">Long Term</span>
                                        <span className="font-semibold">{analysis1.investmentOutlook.longTerm}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b">
                                        <span className="text-sm text-muted-foreground">Risk Level</span>
                                        <span className={`font-semibold ${analysis1.investmentOutlook.riskLevel === 'High' ? 'text-red-500' : 'text-green-500'}`}>
                                            {analysis1.investmentOutlook.riskLevel}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center py-2">
                                        <span className="text-sm text-muted-foreground">Grading Bump</span>
                                        <span className="font-semibold">{analysis1.gradingRoi.potentialValueIncreasePercent}%</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Card 2 Column */}
                        <div className="space-y-6">
                            <Card>
                                <CardHeader className="text-center p-4">
                                    <CardTitle className="text-xl">{card2.player}</CardTitle>
                                    <CardDescription>{card2.year} {card2.brand}</CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col items-center">
                                    <div className="relative aspect-[3/4] w-32 mb-4 bg-muted/50 rounded-sm overflow-hidden flex items-center justify-center">
                                        {card2.imageUrl ? (
                                            card2.imageUrl.startsWith('data:') ? (
                                                <img src={card2.imageUrl} alt={card2.title} className="object-contain p-2 absolute inset-0 w-full h-full" />
                                            ) : (
                                                <Image src={card2.imageUrl} alt={card2.title} fill className="object-contain p-2" />
                                            )
                                        ) : (
                                            <Info className="h-8 w-8 text-muted-foreground opacity-50" />
                                        )}
                                    </div>
                                    <Badge variant="outline" className="text-lg px-4 py-1.5 mb-2">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(card2.currentMarketValue || 0)}
                                    </Badge>
                                    <Badge variant="secondary">Grade: {card2.condition}</Badge>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="py-4 bg-muted/30">
                                    <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2">
                                        <BrainCircuit className="h-4 w-4" /> Outlook Matchup
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4 pt-4">
                                    <div className="flex justify-between items-center py-2 border-b">
                                        <span className="text-sm text-muted-foreground">Long Term</span>
                                        <span className="font-semibold">{analysis2.investmentOutlook.longTerm}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b">
                                        <span className="text-sm text-muted-foreground">Risk Level</span>
                                        <span className={`font-semibold ${analysis2.investmentOutlook.riskLevel === 'High' ? 'text-red-500' : 'text-green-500'}`}>
                                            {analysis2.investmentOutlook.riskLevel}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center py-2">
                                        <span className="text-sm text-muted-foreground">Grading Bump</span>
                                        <span className="font-semibold">{analysis2.gradingRoi.potentialValueIncreasePercent}%</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
