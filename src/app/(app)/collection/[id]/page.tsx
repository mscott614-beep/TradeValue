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
import { Loader2, ChevronLeft, Calendar, Tag, User, Hash, Info, DollarSign, Wallet, TrendingUp, History, ExternalLink, RefreshCw, ShoppingCart } from 'lucide-react';
import type { Portfolio } from '@/lib/types';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { analyzeCardAction } from "@/app/actions/analyze-card";
import { refreshCardValueAction } from "@/app/actions/refresh-card-value";
import type { CardAnalysisResult } from "@/lib/types";
import { BarChart3, LineChart as LineChartIcon, BrainCircuit, CheckCircle2, TrendingDown, Edit3, X, Check, Upload, Image as ImageIcon } from "lucide-react";
import { CARD_ATTRIBUTES, CARD_PARALLELS } from "@/lib/constants";
import { compressImage } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { useRef } from 'react';

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
    const [analysis, setAnalysis] = useState<CardAnalysisResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isEditingAttributes, setIsEditingAttributes] = useState(false);
    const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
    const [selectedParallel, setSelectedParallel] = useState<string>('');

    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [isRefreshingValue, setIsRefreshingValue] = useState(false);
    const [liveListings, setLiveListings] = useState<any[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Sync local input state with fetched data if we aren't currently editing
    useEffect(() => {
        if (card && !isEditingPrice) {
            setPurchasePriceInput(card.purchasePrice?.toString() || '0');
        }
        if (card && !isEditingAttributes) {
            setSelectedFeatures(card.features || []);
            setSelectedParallel(card.parallel || '');
        }
    }, [card, isEditingPrice, isEditingAttributes]);

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

    const handleSaveAttributes = () => {
        if (!cardDocRef) return;

        updateDocumentNonBlocking(cardDocRef, {
            features: selectedFeatures,
            parallel: selectedParallel
        });

        setIsEditingAttributes(false);
        toast({
            title: "Attributes Updated",
            description: "Card features and parallels have been saved.",
        });
    };

    const toggleFeature = (feature: string) => {
        setSelectedFeatures(prev =>
            prev.includes(feature)
                ? prev.filter(f => f !== feature)
                : [...prev, feature]
        );
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !cardDocRef) return;

        setIsUploadingImage(true);
        try {
            const compressedImageUrl = await compressImage(file);
            updateDocumentNonBlocking(cardDocRef, {
                imageUrl: compressedImageUrl
            });
            toast({
                title: "Image Uploaded",
                description: "Card image has been successfully updated.",
            });
        } catch (error) {
            console.error("Failed to upload image:", error);
            toast({
                title: "Upload Failed",
                description: "Could not process or save the image.",
                variant: "destructive"
            });
        } finally {
            setIsUploadingImage(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
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


    const handleRefreshValue = async () => {
        if (!card || !cardDocRef) return;
        setIsRefreshingValue(true);
        try {
            const response = await refreshCardValueAction(user!.uid, card);
            if (response.success && response.newPrice !== undefined) {
                updateDocumentNonBlocking(cardDocRef, {
                    currentMarketValue: response.newPrice,
                    lastMarketValueUpdate: response.lastUpdated
                });
                setLiveListings(response.top5 || []);
                toast({
                    title: "Market Value Updated",
                    description: `New Median: $${response.newPrice.toFixed(2)}`,
                });
            } else {
                toast({
                    title: "Refresh Failed",
                    description: response.error,
                    variant: "destructive"
                });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to fetch live eBay data", variant: "destructive" });
        } finally {
            setIsRefreshingValue(false);
        }
    };

    const handleRunAnalysis = async () => {
        if (!card) return;
        setIsAnalyzing(true);
        try {
            const response = await analyzeCardAction(card);
            if (response.success && response.result) {
                setAnalysis(response.result);
                toast({
                    title: "Analysis Complete",
                    description: "Deep dive insights generated successfully.",
                });
            } else {
                toast({
                    title: "Analysis Failed",
                    description: response.error,
                    variant: "destructive"
                });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to run analysis", variant: "destructive" });
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Replace the return block starting from <div className="space-y-6"> with:
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-2">
                <Button variant="ghost" size="sm" onClick={() => router.push('/collection')}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Back to Collection
                </Button>
                <Button
                    variant="outline"
                    className="border-primary/50 text-primary hover:bg-primary/10"
                    onClick={handleRunAnalysis}
                    disabled={isAnalyzing}
                >
                    {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
                    {analysis ? "Refresh Analysis" : "Run AI Deep Dive"}
                </Button>
            </div>

            <PageHeader
                title={card.title}
                description={`Details for your ${card.year} ${card.brand} ${card.player} card.`}
            />

            <Tabs defaultValue="overview" className="space-y-6">
                <TabsList className="bg-muted/50 border">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="market">Live Market</TabsTrigger>
                    <TabsTrigger value="grading" disabled={!analysis}>Grading ROI</TabsTrigger>
                    <TabsTrigger value="history">Price History</TabsTrigger>
                    <TabsTrigger value="insights" disabled={!analysis}>AI Insights</TabsTrigger>
                </TabsList>

                {/* LIVE MARKET TAB */}
                <TabsContent value="market" className="space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <ShoppingCart className="h-5 w-5 text-primary" />
                                    Active eBay Listings
                                </CardTitle>
                                <CardDescription>Top 5 most relevant live auctions for this card.</CardDescription>
                            </div>
                            <Button variant="outline" size="sm" onClick={handleRefreshValue} disabled={isRefreshingValue}>
                                {isRefreshingValue ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                Sync Data
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {liveListings.length > 0 ? (
                                <div className="space-y-4">
                                    {liveListings.map((listing, i) => (
                                        <div key={i} className="flex items-center gap-4 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                                            <div className="relative h-16 w-12 bg-muted rounded overflow-hidden flex-shrink-0">
                                                {listing.imageUrl ? (
                                                    <Image src={listing.imageUrl} alt={listing.title} fill className="object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                        <ImageIcon className="h-6 w-6 opacity-20" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm truncate" title={listing.title}>{listing.title}</p>
                                                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <Tag className="h-3 w-3" /> eBay
                                                    </span>
                                                    {listing.bidCount !== undefined && (
                                                        <span className="flex items-center gap-1">
                                                            <History className="h-3 w-3" /> {listing.bidCount} bids
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <p className="font-bold text-lg">${listing.price.toFixed(2)}</p>
                                                <Button size="sm" variant="ghost" className="h-7 text-xs text-primary px-0" asChild>
                                                    <a href={listing.url} target="_blank" rel="noopener noreferrer">
                                                        View <ExternalLink className="ml-1 h-3 w-3" />
                                                    </a>
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                                        <ShoppingCart className="h-6 w-6 opacity-40" />
                                    </div>
                                    <div>
                                        <p className="font-medium">No live listings synced yet</p>
                                        <p className="text-sm text-muted-foreground">Click the "Sync Data" button above to fetch live auctions from eBay.</p>
                                    </div>
                                    <Button onClick={handleRefreshValue} disabled={isRefreshingValue}>
                                        {isRefreshingValue ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                        Fetch Live Listings
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* OVERVIEW TAB (Original Content) */}
                <TabsContent value="overview" className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {/* Card Image */}
                        <Card className="lg:col-span-1 overflow-hidden flex flex-col">
                            <CardContent className="p-0 flex-1 relative group">
                                <div className="relative aspect-[3/4] w-full flex items-center justify-center bg-muted/50 rounded-sm">
                                    {card.imageUrl ? (
                                        card.imageUrl.startsWith('data:') ? (
                                            <img src={card.imageUrl} alt={card.title} className="object-contain p-4 absolute inset-0 w-full h-full" />
                                        ) : (
                                            <Image
                                                src={card.imageUrl}
                                                alt={card.title}
                                                fill
                                                className="object-contain p-4"
                                                priority
                                            />
                                        )
                                    ) : (
                                        <div className="flex flex-col items-center justify-center text-muted-foreground opacity-50 p-4">
                                            <ImageIcon className="h-12 w-12 mb-2" />
                                            <span className="text-sm font-medium">No Image Available</span>
                                        </div>
                                    )}

                                    {/* Hover overlay for upload */}
                                    <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                                        <Button
                                            variant="secondary"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isUploadingImage}
                                        >
                                            {isUploadingImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                            {card.imageUrl ? "Change Image" : "Upload Image"}
                                        </Button>
                                    </div>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept="image/jpeg, image/png, image/webp"
                                        onChange={handleImageUpload}
                                    />
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
                                {/* ... (Inner grid from original file) ... */}
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
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Est. Market Value</p>
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors"
                                                        onClick={handleRefreshValue}
                                                        disabled={isRefreshingValue}
                                                        title="Refresh Market Value"
                                                    >
                                                        <RefreshCw className={cn("h-3 w-3", isRefreshingValue && "animate-spin")} />
                                                    </Button>
                                                </div>
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
                                                {card.lastMarketValueUpdate && (
                                                    <p className="text-[10px] text-muted-foreground mt-1">
                                                        Last checked: {new Date(card.lastMarketValueUpdate).toLocaleString()}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-muted">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Attributes & Variations</h4>
                                        {!isEditingAttributes ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 text-xs text-muted-foreground"
                                                onClick={() => setIsEditingAttributes(true)}
                                            >
                                                <Edit3 className="h-3 w-3 mr-1" /> Edit
                                            </Button>
                                        ) : (
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-xs text-red-500"
                                                    onClick={() => setIsEditingAttributes(false)}
                                                >
                                                    <X className="h-3 w-3 mr-1" /> Cancel
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-xs text-green-500"
                                                    onClick={handleSaveAttributes}
                                                >
                                                    <Check className="h-3 w-3 mr-1" /> Save
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    {isEditingAttributes ? (
                                        <div className="space-y-6">
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-3">Recognized Features</p>
                                                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 border rounded-md bg-muted/20">
                                                    {CARD_ATTRIBUTES.map((feature) => (
                                                        <Badge
                                                            key={feature}
                                                            variant={selectedFeatures.includes(feature) ? "default" : "outline"}
                                                            className="cursor-pointer transition-colors"
                                                            onClick={() => toggleFeature(feature)}
                                                        >
                                                            {feature}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-3">Parallel / Variety</p>
                                                <select
                                                    value={selectedParallel}
                                                    onChange={(e) => setSelectedParallel(e.target.value)}
                                                    className="w-full h-10 px-3 py-2 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                                >
                                                    <option value="">None / Base</option>
                                                    {CARD_PARALLELS.map((p) => (
                                                        <option key={p} value={p}>{p}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {card.features && card.features.length > 0 ? (
                                                card.features.map((feature) => (
                                                    <Badge key={feature} variant="outline" className="px-3 py-1">
                                                        {feature}
                                                    </Badge>
                                                ))
                                            ) : !card.parallel && (
                                                <p className="text-sm text-muted-foreground italic">No specific attributes identified.</p>
                                            )}
                                            {card.parallel && (
                                                <Badge variant="outline" className="px-3 py-1 text-purple-400 border-purple-400">
                                                    {card.parallel}
                                                </Badge>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* GRADING ROI TAB */}
                <TabsContent value="grading">
                    {analysis && (
                        <div className="grid gap-6 md:grid-cols-2">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <TrendingUp className="h-5 w-5 text-primary" />
                                        Grading ROI Estimate
                                    </CardTitle>
                                    <CardDescription>Is it worth submitting this card?</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/30">
                                        {analysis.gradingRoi.isRecommended ? (
                                            <div className="p-3 bg-green-500/20 rounded-full text-green-500">
                                                <CheckCircle2 className="h-6 w-6" />
                                            </div>
                                        ) : (
                                            <div className="p-3 bg-red-500/20 rounded-full text-red-500">
                                                <TrendingDown className="h-6 w-6" />
                                            </div>
                                        )}
                                        <div>
                                            <p className="font-semibold">{analysis.gradingRoi.isRecommended ? "Recommended" : "Not Recommended"}</p>
                                            <p className="text-sm text-muted-foreground">Est. Cost: ${analysis.gradingRoi.estimatedCost} | Potential Bump: {analysis.gradingRoi.potentialValueIncreasePercent}%</p>
                                        </div>
                                    </div>
                                    <p className="text-sm leading-relaxed">{analysis.gradingRoi.reasoning}</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <BarChart3 className="h-5 w-5 text-primary" />
                                        Grade Probabilities
                                    </CardTitle>
                                    <CardDescription>Simulated odds based on era/set quality.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="font-medium">PSA 10 (Gem Mint)</span>
                                                <span>{analysis.gradeProbabilities.psa10_percent}%</span>
                                            </div>
                                            <Progress value={analysis.gradeProbabilities.psa10_percent} className="h-2 bg-muted/50 [&>div]:bg-green-500" />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="font-medium">PSA 9 (Mint)</span>
                                                <span>{analysis.gradeProbabilities.psa9_percent}%</span>
                                            </div>
                                            <Progress value={analysis.gradeProbabilities.psa9_percent} className="h-2 bg-muted/50 [&>div]:bg-blue-500" />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="font-medium">8 or Lower</span>
                                                <span>{analysis.gradeProbabilities.psa8_or_lower_percent}%</span>
                                            </div>
                                            <Progress value={analysis.gradeProbabilities.psa8_or_lower_percent} className="h-2 bg-muted/50 [&>div]:bg-amber-500" />
                                        </div>
                                    </div>
                                    <div className="p-4 border rounded-lg bg-orange-500/10 border-orange-500/20">
                                        <p className="text-sm text-orange-600 dark:text-orange-400">
                                            <span className="font-semibold uppercase text-xs tracking-wider mr-2">Condition Note:</span>
                                            {analysis.gradeProbabilities.commonConditionIssues}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </TabsContent>

                {/* PRICE HISTORY TAB */}
                <TabsContent value="history">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <LineChartIcon className="h-5 w-5 text-primary" />
                                Simulated 6-Month Trend
                            </CardTitle>
                            <CardDescription>Market volatility estimation based on current value.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px] flex items-center justify-center border-t bg-muted/10">
                            {/* In a real app, this would be a Recharts line chart like on the dashboard */}
                            <p className="text-muted-foreground text-sm">Line chart visualization requires historical snapshots.</p>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* AI INSIGHTS TAB */}
                <TabsContent value="insights">
                    {analysis && (
                        <div className="grid gap-6 md:grid-cols-3">
                            <Card className="md:col-span-2">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <History className="h-5 w-5 text-primary" />
                                        Historical Significance
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm leading-relaxed">{analysis.historicalSignificance}</p>
                                </CardContent>
                            </Card>

                            <Card className="md:col-span-1">
                                <CardHeader>
                                    <CardTitle>Investment Outlook</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex justify-between items-center p-3 border rounded-lg">
                                        <span className="text-sm font-medium text-muted-foreground">Short Term</span>
                                        <Badge variant={analysis.investmentOutlook.shortTerm === 'Bullish' ? 'default' : 'secondary'}>
                                            {analysis.investmentOutlook.shortTerm}
                                        </Badge>
                                    </div>
                                    <div className="flex justify-between items-center p-3 border rounded-lg">
                                        <span className="text-sm font-medium text-muted-foreground">Long Term</span>
                                        <Badge variant={analysis.investmentOutlook.longTerm === 'Bullish' ? 'default' : 'secondary'}>
                                            {analysis.investmentOutlook.longTerm}
                                        </Badge>
                                    </div>
                                    <div className="flex justify-between items-center p-3 border rounded-lg bg-red-500/5">
                                        <span className="text-sm font-medium text-muted-foreground">Risk Level</span>
                                        <span className="text-sm font-bold text-red-500">{analysis.investmentOutlook.riskLevel}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
