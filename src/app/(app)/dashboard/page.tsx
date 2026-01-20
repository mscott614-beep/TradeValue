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
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, DollarSign, TrendingUp, Layers } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import PortfolioChart from "@/components/dashboard/portfolio-chart";
import { cards, portfolioHistory } from "@/lib/data";
import { cn } from "@/lib/utils";
import Image from "next/image";

const totalValue = cards.reduce((acc, card) => acc + card.currentMarketValue, 0);
const totalGain = cards.reduce((acc, card) => acc + (card.currentMarketValue - card.purchasePrice), 0);
const change24h = cards.reduce((acc, card) => acc + card.valueChange24h, 0);
const topGainers = [...cards].sort((a, b) => b.valueChange24hPercent - a.valueChange24hPercent).slice(0, 3);


export default function DashboardPage() {
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
                    <p className="text-xs text-muted-foreground">
                        Total gain of {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalGain)}
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
                     <p className="text-xs text-muted-foreground">
                        {((change24h / totalValue) * 100).toFixed(2)}% vs yesterday
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Top Gainer (24h)</CardTitle>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        {topGainers[0].player}
                    </div>
                     <p className="text-xs text-muted-foreground">
                        +{topGainers[0].valueChange24hPercent.toFixed(2)}% on '{topGainers[0].year} {topGainers[0].brand}'
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Cards in Portfolio</CardTitle>
                    <Layers className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{cards.length}</div>
                     <p className="text-xs text-muted-foreground">
                        Across {new Set(cards.map(c => c.brand)).size} brands
                    </p>
                </CardContent>
            </Card>
        </div>
        <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Portfolio Value History</CardTitle>
                <CardDescription>6-month performance of your collection.</CardDescription>
              </CardHeader>
              <CardContent>
                <PortfolioChart data={portfolioHistory} />
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
                        {topGainers.map((card) => (
                        <TableRow key={card.id}>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <Image
                                        src={card.imageUrl}
                                        alt={card.title}
                                        width={40}
                                        height={56}
                                        className="rounded-sm"
                                        data-ai-hint={card.imageHint}
                                    />
                                    <div>
                                        <div className="font-medium">{card.player}</div>
                                        <div className="hidden text-sm text-muted-foreground md:inline">
                                            {card.title}
                                        </div>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell
                                className={cn("text-right font-semibold", card.valueChange24hPercent >= 0 ? "text-green-400" : "text-red-400")}
                            >
                                {card.valueChange24hPercent >= 0 ? '+' : ''}
                                {card.valueChange24hPercent.toFixed(2)}%
                            </TableCell>
                        </TableRow>
                        ))}
                    </TableBody>
                 </Table>
              </CardContent>
            </Card>
        </div>
      </div>
    </>
  );
}
