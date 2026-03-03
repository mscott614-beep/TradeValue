"use client";

import { useMemo } from "react";
import Image from "next/image";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ArrowUpRight, DollarSign, TrendingUp, Layers, Loader2, Info } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import PortfolioChart from "@/components/dashboard/portfolio-chart";
import { cn } from "@/lib/utils";
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase";
import { collection } from "firebase/firestore";
import type { Portfolio } from "@/lib/types";

export default function DashboardPage() {
    const firestore = useFirestore();
    const { user } = useUser();

    const portfoliosCollection = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return collection(firestore, `users/${user.uid}/portfolios`);
    }, [firestore, user]);

    const { data: cards, isLoading } = useCollection<Portfolio>(portfoliosCollection);

    const { totalValue, totalGain, change24h, topGainers, uniqueBrands } = useMemo(() => {
        if (!cards || cards.length === 0) {
            return { totalValue: 0, totalGain: 0, change24h: 0, topGainers: [], uniqueBrands: 0 };
        }

        const tValue = cards.reduce((acc, card) => acc + (card.currentMarketValue || 0), 0);
        const tGain = cards.reduce((acc, card) => acc + ((card.currentMarketValue || 0) - (card.purchasePrice || 0)), 0);

        // We don't have historical price snapshots tracked in DB yet, so change is static 0 for now.
        const c24h = cards.reduce((acc, card) => acc + (card.valueChange24h || 0), 0);

        const tGainers = [...cards]
            .filter(c => (c.valueChange24hPercent || 0) > 0)
            .sort((a, b) => (b.valueChange24hPercent || 0) - (a.valueChange24hPercent || 0))
            .slice(0, 3);

        const uBrands = new Set(cards.map(c => c.brand)).size;

        return { totalValue: tValue, totalGain: tGain, change24h: c24h, topGainers: tGainers, uniqueBrands: uBrands };
    }, [cards]);

    const historyData = useMemo(() => {
        if (!cards || cards.length === 0) return [];

        const result = [];
        const now = new Date();

        // Generate data for the last 6 months
        for (let i = 5; i >= 0; i--) {
            // End of the month
            const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
            const monthName = d.toLocaleString('default', { month: 'short' });

            const endOfMonthDateString = d.toISOString();

            let totalValueForMonth = 0;
            cards.forEach(card => {
                const dateAdded = card.dateAdded || now.toISOString();
                if (dateAdded <= endOfMonthDateString) {
                    totalValueForMonth += (card.currentMarketValue || 0);
                }
            });

            result.push({
                month: monthName,
                value: totalValueForMonth
            });
        }

        return result;
    }, [cards]);


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
                title="Dashboard"
                description={`Here's your portfolio overview. Total value: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalValue)}`}
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
                                {cards?.filter(c => c.condition && c.condition.toLowerCase().includes('raw')).length || 0} Raw
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                vs {cards?.filter(c => !c.condition || !c.condition.toLowerCase().includes('raw')).length || 0} Graded cards
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
                        <CardContent>
                            <PortfolioChart data={historyData} />
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
                                    {topGainers.length > 0 ? (
                                        topGainers.map((card) => (
                                            <TableRow key={card.id}>
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        {card.imageUrl ? (
                                                            <Image
                                                                src={card.imageUrl}
                                                                alt={card.title}
                                                                width={40}
                                                                height={56}
                                                                className="rounded-sm object-cover h-[56px]"
                                                            />
                                                        ) : (
                                                            <div className="w-[40px] h-[56px] bg-muted rounded-sm flex items-center justify-center shrink-0">
                                                                <Info className="h-4 w-4 text-muted-foreground opacity-50" />
                                                            </div>
                                                        )}

                                                        <div>
                                                            <div className="font-medium">{card.player}</div>
                                                            <div className="hidden text-sm text-muted-foreground md:inline">
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
                                                Not enough historical data to determine daily movers.
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
