"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ArrowUpRight, DollarSign, TrendingUp, Layers, Loader2, Info, WandSparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import PortfolioChart from "@/components/dashboard/portfolio-chart";
import { cn } from "@/lib/utils";
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase";
import { collection, query, orderBy, limit } from "firebase/firestore";
import { useDemo } from "@/context/demo-context";
import type { Portfolio } from "@/lib/types";
import { isGraded } from "@/lib/card-utils";

export default function DashboardPage() {
    const firestore = useFirestore();
    const { user } = useUser();

    const portfoliosCollection = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return collection(firestore, `users/${user.uid}/portfolios`);
    }, [firestore, user]);

    const { data: realCards, isLoading } = useCollection<Portfolio>(portfoliosCollection);
    const { isDemo } = useDemo();

    const demoCards: Portfolio[] = useMemo(() => [
        {
            id: 'demo-1',
            userId: 'demo',
            cardId: 'demo-1',
            player: 'Mickey Mantle',
            title: '1952 Topps #311',
            brand: 'Topps',
            year: '1952',
            cardNumber: '311',
            currentMarketValue: 12600000,
            purchasePrice: 50000,
            valueChange24h: 300000,
            valueChange24hPercent: 2.4,
            imageUrl: 'https://images.psacard.com/s3/cu-psa/card-images/1952-topps-mickey-mantle-311-psa-9.jpg',
            grader: 'PSA',
            condition: 'PSA 9',
            estimatedGrade: 'PSA 9',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo-2',
            userId: 'demo',
            cardId: 'demo-2',
            player: 'Wayne Gretzky',
            title: '1979 O-Pee-Chee RC',
            brand: 'O-Pee-Chee',
            year: '1979',
            cardNumber: '18',
            currentMarketValue: 3750000,
            purchasePrice: 1000000,
            valueChange24h: 30000,
            valueChange24hPercent: 0.8,
            imageUrl: 'https://images.psacard.com/s3/cu-psa/card-images/1979-o-pee-chee-wayne-gretzky-18-psa-10.jpg',
            grader: 'PSA',
            condition: 'PSA 10',
            estimatedGrade: 'PSA 10',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo-3',
            userId: 'demo',
            cardId: 'demo-3',
            player: 'Honus Wagner',
            title: '1909-11 T206 Sweet Caporal',
            brand: 'T206',
            year: '1909',
            cardNumber: 'N/A',
            currentMarketValue: 7250000,
            purchasePrice: 6000000,
            valueChange24h: -87000,
            valueChange24hPercent: -1.2,
            imageUrl: 'https://images.psacard.com/s3/cu-psa/card-images/1909-11-t206-honus-wagner-psa-8.jpg',
            grader: 'PSA',
            condition: 'PSA 8',
            estimatedGrade: 'PSA 8',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo-4',
            userId: 'demo',
            cardId: 'demo-4',
            player: 'LeBron James',
            title: '2003 Exquisite Collection RPA /99',
            brand: 'Upper Deck',
            year: '2003',
            cardNumber: '78',
            currentMarketValue: 5200000,
            purchasePrice: 1800000,
            valueChange24h: 234000,
            valueChange24hPercent: 4.5,
            imageUrl: 'https://images.psacard.com/s3/cu-psa/card-images/2003-04-exquisite-collection-lebron-james-78-psa-10.jpg',
            grader: 'BGS',
            condition: 'BGS 9.5',
            estimatedGrade: 'BGS 9.5',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo-5',
            userId: 'demo',
            cardId: 'demo-5',
            player: 'Charizard',
            title: '1999 Base Set 1st Edition Shadowless',
            brand: 'Wizards of the Coast',
            year: '1999',
            cardNumber: '4',
            currentMarketValue: 420000,
            purchasePrice: 150000,
            valueChange24h: 21840,
            valueChange24hPercent: 5.2,
            imageUrl: 'https://images.psacard.com/s3/cu-psa/card-images/1999-base-set-charizard-4-psa-10.jpg',
            grader: 'PSA',
            condition: 'PSA 10',
            estimatedGrade: 'PSA 10',
            dateAdded: new Date().toISOString()
        }
    ], []);

    const cards = isDemo ? demoCards : realCards;

    const { totalValue, totalGain, change24h, topMovers, uniqueBrands, rawCount, gradedCount } = useMemo(() => {
        if (!cards || cards.length === 0) {
            return { totalValue: 0, totalGain: 0, change24h: 0, topMovers: [], uniqueBrands: 0, rawCount: 0, gradedCount: 0 };
        }

        const tValue = cards.reduce((acc, card) => acc + (card.currentMarketValue || 0), 0);
        const tGain = cards.reduce((acc, card) => acc + ((card.currentMarketValue || 0) - (card.purchasePrice || 0)), 0);

        // Portfolio-wide 24h change based on individual card metrics
        const c24h = cards.reduce((acc, card) => acc + (card.valueChange24h || 0), 0);

        const tMovers = [...cards]
            .filter(c => Math.abs(c.valueChange24hPercent || 0) > 0)
            .sort((a, b) => (b.valueChange24hPercent || 0) - (a.valueChange24hPercent || 0))
            .slice(0, 3);

        const uBrands = new Set(cards.map(c => c.brand)).size;

        const rCount = cards.filter(c => !isGraded(c.grader)).length;
        const gCount = cards.length - rCount;

        return { totalValue: tValue, totalGain: tGain, change24h: c24h, topMovers: tMovers, uniqueBrands: uBrands, rawCount: rCount, gradedCount: gCount };
    }, [cards]);

    const portfolioHistoryQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(
            collection(firestore, `users/${user.uid}/portfolioHistory`),
            orderBy('__name__', 'asc'),
            limit(30)
        );
    }, [firestore, user]);

    const { data: historyDocs, isLoading: isLoadingHistory } = useCollection<{ totalValue: number }>(portfolioHistoryQuery);

    const historyData = useMemo(() => {
        if (!historyDocs || historyDocs.length === 0) {
            // If no history yet, return empty but with a future-looking placeholder if not in demo
            if (isDemo) return []; 
            return [];
        }

        return historyDocs.map((doc: any) => {
            const dateStr = doc.id;
            const parts = dateStr.split('-');
            const label = parts.length === 3
                ? new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : dateStr;
            
            return {
                month: label,
                value: doc.totalValue
            };
        });
    }, [historyDocs, isDemo]);


    if (isLoading) {
        return (
            <div className="flex h-[400px] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <>
            <PageHeader
                title="Portfolio Dashboard"
                description={`Financial overview and performance tracking for your ${cards?.length || 0} cards.`}
                action={
                    <Link href="/dashboard/insights">
                        <Button className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 shadow-lg border-0">
                            <WandSparkles className="mr-2 h-4 w-4" />
                            View AI Insights
                        </Button>
                    </Link>
                }
            />
            <div className="grid gap-6">
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Portfolio Value</CardTitle>
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalValue)}</div>
                            <p className={cn("text-xs font-medium mt-1", totalGain >= 0 ? "text-green-500" : "text-red-500")}>
                                {totalGain >= 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalGain)} (All time)
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">24h Change</CardTitle>
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className={cn("text-2xl font-bold", change24h >= 0 ? 'text-green-400' : 'text-red-400')}>
                                {change24h >= 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(change24h)}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                {totalValue > 0 ? ((change24h / totalValue) * 100).toFixed(2) : "0.00"}% vs yesterday
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Condition Breakdown</CardTitle>
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {rawCount} Raw
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                vs {gradedCount} Graded cards
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Cards in Portfolio</CardTitle>
                            <Layers className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{cards?.length || 0}</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Across {uniqueBrands} brand(s)
                            </p>
                        </CardContent>
                    </Card>
                </div>
                <div className="grid gap-6 lg:grid-cols-5">
                    <Card className="lg:col-span-3">
                        <CardHeader>
                            <CardTitle>Portfolio Value History</CardTitle>
                            <CardDescription>Estimated performance over time.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px] flex flex-col justify-center">
                            {isLoadingHistory ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="h-6 w-6 animate-spin text-primary opacity-50" />
                                </div>
                            ) : historyData.length > 0 ? (
                                <PortfolioChart data={historyData} />
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
                                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                        <TrendingUp className="h-6 w-6 text-muted-foreground opacity-40" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-sm">Portfolio tracking started</p>
                                        <p className="text-xs text-muted-foreground mt-1 px-8">
                                            We'll track your total value daily. Your first performance data point will appear tomorrow.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle>Top Movers</CardTitle>
                            <CardDescription>
                                Cards with the biggest value change in the last 24 hours.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Card</TableHead>
                                        <TableHead className="text-right">Change</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topMovers.length > 0 ? (
                                        topMovers.map((card) => (
                                            <TableRow key={card.id}>
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        {card.imageUrl ? (
                                                            card.imageUrl.startsWith('data:') ? (
                                                                <img src={card.imageUrl} alt={card.title} className="rounded-sm object-cover w-[40px] h-[56px]" />
                                                            ) : (
                                                                <Image
                                                                    src={card.imageUrl}
                                                                    alt={card.title}
                                                                    width={40}
                                                                    height={56}
                                                                    className="rounded-sm object-cover h-[56px]"
                                                                    unoptimized
                                                                />
                                                            )
                                                        ) : (
                                                            <div className="w-[40px] h-[56px] bg-muted rounded-sm flex items-center justify-center shrink-0">
                                                                <Info className="h-4 w-4 text-muted-foreground opacity-50" />
                                                            </div>
                                                        )}

                                                        <div>
                                                            <div className="font-medium truncate max-w-[120px]">{card.player}</div>
                                                            <div className="hidden text-sm text-muted-foreground md:inline truncate max-w-[150px]">
                                                                {card.title}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell
                                                    className={cn("text-right font-semibold", (card.valueChange24hPercent || 0) >= 0 ? "text-green-400" : "text-red-400")}
                                                >
                                                    {(card.valueChange24hPercent || 0) >= 0 ? '+' : ''}
                                                    {(card.valueChange24hPercent || 0).toFixed(2)}%
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={2} className="h-24 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center gap-1">
                                                    <p>Not enough historical data.</p>
                                                    <p className="text-[10px] opacity-70">Daily snapshots run at 00:00 UTC.</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}

                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}
