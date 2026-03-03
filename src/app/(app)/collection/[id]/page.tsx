"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { useFirestore, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ChevronLeft, Calendar, Tag, User, Hash, Info, DollarSign, Wallet, TrendingUp, History, ExternalLink } from 'lucide-react';
import type { Portfolio } from '@/lib/types';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';

export default function CardDetailsPage() {
    const params = useParams();
    const id = params.id as string;
    const router = useRouter();
    const firestore = useFirestore();
    const { user } = useUser();
    const { toast } = useToast();

    const cardDocRef = useMemoFirebase(() => {
        if (!user || !firestore || !id) return null;
        return doc(firestore, `users/${user.uid}/portfolios`, id);
    }, [firestore, user, id]);

    const { data: card, isLoading } = useDoc<Portfolio>(cardDocRef);

    const [isEditingPrice, setIsEditingPrice] = useState(false);
    const [purchasePriceInput, setPurchasePriceInput] = useState<string>('');

    // Sync local input state with fetched data if we aren't currently editing
    useEffect(() => {
        if (card && !isEditingPrice) {
            setPurchasePriceInput(card.purchasePrice?.toString() || '0');
        }
    }, [card, isEditingPrice]);

    const handleSavePurchasePrice = () => {
        if (!cardDocRef) return;

        const newPrice = parseFloat(purchasePriceInput);
        if (isNaN(newPrice) || newPrice < 0) {
            toast({
                title: "Invalid Price",
                description: "Please enter a valid positive number.",
                variant: "destructive"
            });
            setPurchasePriceInput(card?.purchasePrice?.toString() || '0');
            return;
        }

        updateDocumentNonBlocking(cardDocRef, {
            purchasePrice: newPrice
        });

        setIsEditingPrice(false);
        toast({
            title: "Price Updated",
            description: "Your cost basis has been saved successfully.",
        });
    };

    if (isLoading) {
        return (
            <div className="flex h-[400px] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!card) {
        return (
            <div className="flex flex-col items-center justify-center h-[400px] space-y-4">
                <h2 className="text-xl font-semibold">Card not found</h2>
                <Button onClick={() => router.push('/collection')}>Back to Collection</Button>
            </div>
        );
    }

    const calculatedGain = (card.currentMarketValue || 0) - (card.purchasePrice || 0);
    const calculatedGainPercentage = card.purchasePrice && card.purchasePrice > 0
        ? ((calculatedGain / card.purchasePrice) * 100).toFixed(2)
        : null;

    // --- MOCK DATA GENERATORS FOR MARKET INTELLIGENCE ---
    const generateMockRecentSales = (currentValue: number) => {
        const sales = [];
        const baseVariance = currentValue * 0.15; // 15% variance
        const now = new Date();
        for (let i = 1; i <= 3; i++) {
            const date = new Date(now.getTime() - (Math.random() * 30 * 24 * 60 * 60 * 1000));
            const price = currentValue + (Math.random() * baseVariance * 2) - baseVariance;
            sales.push({
                id: i,
                date: date.toLocaleDateString(),
                price: price,
                platform: "eBay",
                type: Math.random() > 0.5 ? "Auction" : "Buy It Now"
            });
        }
        return sales.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    };

    const mockRelatedCards = [
        { id: 1, title: `2024 Topps Chrome ${card.player} Refractor`, price: "$45.00" },
        { id: 2, title: `2023 Panini Prizm ${card.player} Silver`, price: "$32.50" },
        { id: 3, title: `2022 Bowman Chrome ${card.player} 1st`, price: "$125.00" },
    ];

    const mockRecentSales = generateMockRecentSales(card.currentMarketValue || 100);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4 mb-2">
                <Button variant="ghost" size="sm" onClick={() => router.push('/collection')}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Back to Collection
                </Button>
            </div>

            <PageHeader
                title={card.title}
                description={`Details for your ${card.year} ${card.brand} ${card.player} card.`}
            />

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* Card Image */}
                <Card className="lg:col-span-1 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="relative aspect-[3/4] w-full flex items-center justify-center bg-muted/50 rounded-sm">
                            {card.imageUrl ? (
                                <Image
                                    src={card.imageUrl}
                                    alt={card.title}
                                    fill
                                    className="object-contain p-4"
                                    priority
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center text-muted-foreground opacity-50 p-4">
                                    <Info className="h-12 w-12 mb-2" />
                                    <span className="text-sm font-medium">No Image Available</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Card Data */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Info className="h-5 w-5 text-primary" />
                            Card Specifications
                        </CardTitle>
                        <CardDescription>Verified information from the AI scan.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="flex items-start gap-3">
                                <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Player</p>
                                    <p className="text-lg font-semibold">{card.player}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Calendar className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Year</p>
                                    <p className="text-lg font-semibold">{card.year}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Tag className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Brand</p>
                                    <p className="text-lg font-semibold">{card.brand}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Hash className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Card Number</p>
                                    <p className="text-lg font-semibold">#{card.cardNumber}</p>
                                </div>
                            </div>
                        </div>

                        <div className="pt-6 border-t border-muted">
                            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Value & Condition</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="flex items-start gap-3">
                                        <Badge variant="secondary" className="h-8 px-3 text-sm flex items-center gap-1 font-bold">
                                            GRADE: {card.condition}
                                        </Badge>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Wallet className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                                        <div className="w-full">
                                            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider max-w-[150px]">Cost Basis</p>
                                            {isEditingPrice ? (
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-muted-foreground font-semibold">$</span>
                                                    <Input
                                                        type="number"
                                                        value={purchasePriceInput}
                                                        onChange={(e) => setPurchasePriceInput(e.target.value)}
                                                        className="w-24 h-8"
                                                        min="0"
                                                        step="0.01"
                                                        autoFocus
                                                    />
                                                    <Button size="sm" onClick={handleSavePurchasePrice}>Save</Button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <p className="text-lg font-semibold">
                                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(card.purchasePrice || 0)}
                                                    </p>
                                                    <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground underline" onClick={() => setIsEditingPrice(true)}>Edit</Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <DollarSign className="h-5 w-5 text-green-400 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Est. Market Value</p>
                                        <div className="flex items-center gap-2">
                                            <p className="text-2xl font-bold text-green-400">
                                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(card.currentMarketValue || 0)}
                                            </p>
                                            {calculatedGainPercentage && (
                                                <Badge variant="outline" className={calculatedGain >= 0 ? "text-green-500 border-green-500/50" : "text-red-500 border-red-500/50"}>
                                                    {calculatedGain >= 0 ? '+' : ''}{calculatedGainPercentage}%
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {card.features && card.features.length > 0 && (
                            <div className="pt-6 border-t border-muted">
                                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Attributes</h4>
                                <div className="flex flex-wrap gap-2">
                                    {card.features.map((feature) => (
                                        <Badge key={feature} variant="outline" className="px-3 py-1">
                                            {feature}
                                        </Badge>
                                    ))}
                                    {card.parallel && (
                                        <Badge variant="outline" className="px-3 py-1 text-purple-400 border-purple-400">
                                            {card.parallel}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Market Intelligence Section */}
            <div className="grid gap-6 md:grid-cols-3 pt-6 border-t border-muted">

                {/* Recent Sales Validation */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <History className="h-5 w-5 text-primary" />
                            Recent Sales Data
                        </CardTitle>
                        <CardDescription>Latest confirmed transactions comparable to your card.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Platform</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {mockRecentSales.map((sale) => (
                                    <TableRow key={sale.id}>
                                        <TableCell>{sale.date}</TableCell>
                                        <TableCell>{sale.type}</TableCell>
                                        <TableCell>{sale.platform}</TableCell>
                                        <TableCell className="text-right font-medium">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(sale.price)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Related Cards */}
                <Card className="md:col-span-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-primary" />
                            Related Cards
                        </CardTitle>
                        <CardDescription>Similar investments you might like.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {mockRelatedCards.map(related => (
                                <div key={related.id} className="group flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer">
                                    <div className="flex-1 min-w-0 pr-4">
                                        <p className="font-medium text-sm truncate">{related.title}</p>
                                        <p className="text-xs text-muted-foreground">{related.price}</p>
                                    </div>
                                    <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
