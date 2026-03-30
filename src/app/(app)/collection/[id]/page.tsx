"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { useFirestore, useUser, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, orderBy, limit, setDoc } from 'firebase/firestore';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
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
import { getSimilarCardsAction, type SimilarCard } from "@/app/actions/get-similar-cards";
import type { CardAnalysisResult } from "@/lib/types";
import { BarChart3, LineChart as LineChartIcon, BrainCircuit, CheckCircle2, TrendingDown, Edit3, X, Check, Upload, Image as ImageIcon } from "lucide-react";
import { CARD_ATTRIBUTES, CARD_PARALLELS, CARD_CONDITIONS, CARD_GRADERS, CARD_GRADES } from "@/lib/constants";
import { compressImage } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { useRef, useMemo } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

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
    const [soldListings, setSoldListings] = useState<any[]>([]);
    const [avgPrices, setAvgPrices] = useState<{ active: number; sold: number } | null>(null);
    const [similarCards, setSimilarCards] = useState<SimilarCard[]>([]);
    const [isFetchingSimilar, setIsFetchingSimilar] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleInput, setTitleInput] = useState<string>('');
    const [isEditingInfo, setIsEditingInfo] = useState(false);
    const [infoInput, setInfoInput] = useState({
        player: '',
        year: '',
        brand: '',
        cardNumber: '',
        parallel: '',
        condition: '',
        grader: '',
        estimatedGrade: ''
    });
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
        if (card && !isEditingTitle) {
            setTitleInput(card.title || '');
        }
        if (card && !isEditingInfo) {
            setInfoInput({
                player: card.player || '',
                year: card.year || '',
                brand: card.brand || '',
                cardNumber: card.cardNumber || '',
                parallel: card.parallel || '',
                condition: card.condition || '',
                grader: card.grader || '',
                estimatedGrade: card.estimatedGrade || ''
            });
        }
        // Sync market data from Firestore
        if (card?.marketPrices) {
            setLiveListings(card.marketPrices.activeItems || []);
            // Since we pivoted to active only, we use activeItems for both
            setSoldListings(card.marketPrices.activeItems || []);
            setAvgPrices({
                active: card.marketPrices.median || 0,
                sold: 0
            });
        }
    }, [card, isEditingPrice, isEditingAttributes, isEditingTitle, card?.marketPrices]);

    // Query real price history from Firestore subcollection
    const priceHistoryQuery = useMemoFirebase(() => {
        if (!user || !firestore || !id) return null;
        return query(
            collection(firestore, `users/${user.uid}/portfolios/${id}/priceHistory`),
            orderBy('__name__', 'asc'),
            limit(90)
        );
    }, [firestore, user, id]);

    const { data: priceHistoryDocs, isLoading: isLoadingHistory } = useCollection<{ value: number; timestamp: string }>(priceHistoryQuery);

    const trendData = useMemo(() => {
        if (!priceHistoryDocs || priceHistoryDocs.length === 0) return [];
        return priceHistoryDocs.map((entry: any) => {
            // Document ID is YYYY-MM-DD, parse to a readable label
            const dateStr = entry.id || '';
            const parts = dateStr.split('-');
            const label = parts.length === 3
                ? new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : dateStr;
            return { name: label, value: entry.value };
        });
    }, [priceHistoryDocs]);

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

    const handleSaveTitle = () => {
        if (!cardDocRef || !titleInput.trim()) return;

        updateDocumentNonBlocking(cardDocRef, {
            title: titleInput.trim()
        });

        setIsEditingTitle(false);
        toast({
            title: "Title Updated",
            description: "The card title has been saved successfully.",
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

    const handleSaveInfo = async () => {
        if (!cardDocRef) return;

        try {
            updateDocumentNonBlocking(cardDocRef, {
                player: infoInput.player.trim(),
                year: infoInput.year.trim(),
                brand: infoInput.brand.trim(),
                cardNumber: infoInput.cardNumber.trim(),
                parallel: infoInput.parallel.trim(),
                condition: infoInput.condition.trim(),
                grader: infoInput.grader.trim(),
                estimatedGrade: infoInput.estimatedGrade.trim()
            });

            setIsEditingInfo(false);
            toast({
                title: "Card Details Updated",
                description: "The card's metadata has been saved successfully.",
            });
            
            // Auto-refresh market value if metadata changed significantly
            // handleRefreshValue(); 
        } catch (error) {
            console.error("Failed to save info:", error);
            toast({
                title: "Save Failed",
                description: "Could not update card details.",
                variant: "destructive"
            });
        }
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
    useEffect(() => {
        if (!card) return;
        let cancelled = false;
        const fetchSimilar = async () => {
            setIsFetchingSimilar(true);
            try {
                const response = await getSimilarCardsAction(card);
                if (!cancelled && response.success && response.similarCards) {
                    setSimilarCards(response.similarCards);
                }
            } catch (error) {
                console.error("Failed to fetch similar cards:", error);
            } finally {
                if (!cancelled) setIsFetchingSimilar(false);
            }
        };
        fetchSimilar();
        return () => { cancelled = true; };
    }, [card?.id]);

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




    const handleRefreshValue = async () => {
        if (!card || !cardDocRef || !user) return;
        setIsRefreshingValue(true);
        try {
            const response = await refreshCardValueAction(user.uid, card);
            if (response.success && response.newPrice !== undefined) {
                updateDocumentNonBlocking(cardDocRef, {
                    currentMarketValue: response.newPrice,
                    lastMarketValueUpdate: response.lastUpdated
                });
                // Write a price history snapshot for the chart
                const today = new Date().toISOString().split('T')[0];
                const historyDocRef = doc(firestore, `users/${user.uid}/portfolios/${id}/priceHistory`, today);
                setDoc(historyDocRef, { value: response.newPrice, timestamp: new Date().toISOString() }, { merge: true });
                setLiveListings(response.top5 || []);
                setSoldListings(response.soldItems || []);
                setAvgPrices({
                    active: response.avgActivePrice || 0,
                    sold: response.avgSoldPrice || 0
                });
                toast({
                    title: "Market Price Updated",
                    description: `Average Asking Price: $${response.newPrice.toFixed(2)}`,
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

            <div className="mb-8">
                {isEditingTitle ? (
                    <div className="flex items-center gap-2 max-w-2xl">
                        <Input
                            value={titleInput}
                            onChange={(e) => setTitleInput(e.target.value)}
                            className="text-2xl font-bold h-10"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveTitle();
                                if (e.key === 'Escape') setIsEditingTitle(false);
                            }}
                        />
                        <Button size="sm" onClick={handleSaveTitle}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setIsEditingTitle(false)}>Cancel</Button>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl font-headline">
                            {card.title}
                        </h1>
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => setIsEditingInfo(true)}
                        >
                            <Edit3 className="h-4 w-4" />
                        </Button>
                    </div>
                )}
                <p className="text-muted-foreground mt-1.5">{`Details for your ${card.year} ${card.brand} ${card.player} card.`}</p>
            </div>

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
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 text-sm py-3 px-4 bg-muted/30 border-b">
                            <div>
                                <CardTitle className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                                    <Tag className="h-3 w-3" />
                                    Top Active Listings
                                </CardTitle>
                                <CardDescription className="text-[10px]">Current market availability and listing prices.</CardDescription>
                            </div>
                            {avgPrices && (
                                <Badge variant="outline" className="h-6 text-[10px] bg-background/50">
                                    Avg Asking: ${avgPrices.active.toFixed(2)}
                                </Badge>
                            )}
                        </CardHeader>
                        <CardContent className="p-0">
                            {liveListings.length > 0 ? (
                                <div className="grid grid-cols-5 gap-3 p-4">
                                    {liveListings.map((listing, i) => (
                                        <a 
                                            key={i} 
                                            href={listing.url} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="group cursor-pointer"
                                        >
                                            <div className="relative aspect-[3/4] bg-muted/50 rounded-lg overflow-hidden border border-border group-hover:border-primary/50 transition-all shadow-sm">
                                                {listing.imageUrl ? (
                                                    <Image 
                                                        src={listing.imageUrl} 
                                                        alt={listing.title} 
                                                        fill 
                                                        className="object-cover group-hover:scale-110 transition-transform duration-500" 
                                                        unoptimized
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                        <ImageIcon className="h-8 w-8 opacity-20" />
                                                    </div>
                                                )}
                                                <div className="absolute top-2 right-2">
                                                    <Badge variant="secondary" className="text-[9px] px-1.5 h-4 bg-background/80 backdrop-blur-md border-none lowercase font-semibold shadow-sm">
                                                        Live
                                                    </Badge>
                                                </div>
                                            </div>
                                            <div className="mt-2 text-left space-y-0.5 px-1">
                                                <p className="text-xs font-bold text-primary leading-tight">${listing.price.toFixed(2)}</p>
                                                <p className="text-[11px] text-muted-foreground line-clamp-2 leading-tight group-hover:text-foreground transition-colors" title={listing.title}>
                                                    {listing.title}
                                                </p>
                                            </div>
                                        </a>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-[10px] text-muted-foreground italic">
                                    No live listings found. Try syncing data.
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 text-sm py-3 px-4 bg-green-500/5 border-b">
                            <div>
                                <CardTitle className="text-xs font-bold uppercase tracking-widest text-green-500 flex items-center gap-2">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Market Comparisons
                                </CardTitle>
                                <CardDescription className="text-[10px]">Similar active listings used for valuation.</CardDescription>
                            </div>
                            {avgPrices && (
                                <Badge variant="secondary" className="h-6 text-[10px] bg-green-500/20 text-green-600 border-none">
                                    Median: ${avgPrices.active.toFixed(2)}
                                </Badge>
                            )}
                        </CardHeader>
                        <CardContent className="p-0">
                            {liveListings.length > 0 ? (
                                <div className="grid grid-cols-5 gap-3 p-4">
                                    {soldListings.map((listing, i) => (
                                        <div key={i} className="group flex flex-col">
                                            <div className="relative aspect-[3/4] bg-muted/30 rounded-lg overflow-hidden border border-border group-hover:border-green-500/30 transition-all shadow-sm">
                                                {listing.imageUrl ? (
                                                    <Image 
                                                        src={listing.imageUrl} 
                                                        alt={listing.title} 
                                                        fill 
                                                        className="object-cover group-hover:scale-105 transition-transform duration-500" 
                                                        unoptimized
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                        <ImageIcon className="h-8 w-8 opacity-20" />
                                                    </div>
                                                )}
                                                <div className="absolute top-2 right-2">
                                                    <Badge className="text-[9px] px-1.5 h-4 bg-green-500 text-white border-none shadow-sm">
                                                        LISTED
                                                    </Badge>
                                                </div>
                                            </div>
                                            <div className="mt-2 text-left space-y-0.5 px-1 text-[10px]">
                                                <p className="font-bold text-green-600">${listing.price.toFixed(2)}</p>
                                                <p className="text-muted-foreground line-clamp-2 leading-tight" title={listing.title}>
                                                    {listing.title}
                                                </p>
                                                <p className="text-[8px] text-muted-foreground/60">{listing.date}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center space-y-3">
                                    <p className="text-[10px] text-muted-foreground italic">No market comparison data currently available.</p>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="h-8 text-[11px] border-green-500/30 text-green-600 hover:bg-green-500/10"
                                        onClick={handleRefreshValue}
                                        disabled={isRefreshingValue}
                                    >
                                        {isRefreshingValue ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
                                        Sync Market Data
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 text-sm py-3 px-4 bg-muted/10 border-b">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <History className="h-3 w-3" />
                                Similar Market Highlights
                            </CardTitle>
                            <span className="text-[10px] text-muted-foreground">Parallels & Variations</span>
                        </CardHeader>
                        <CardContent className="p-0">
                            {isFetchingSimilar ? (
                                <div className="p-8 flex items-center justify-center">
                                    <Loader2 className="h-6 w-6 animate-spin text-primary opacity-50" />
                                </div>
                            ) : similarCards.length > 0 ? (
                                <div className="divide-y divide-border/30">
                                    {similarCards.slice(0, 5).map((sCard, i) => (
                                        <div key={i} className="flex items-center gap-4 p-3 hover:bg-muted/30 transition-colors group">
                                            <div className="relative h-12 w-9 rounded overflow-hidden flex-shrink-0 border border-border/50">
                                                {sCard.imageUrl ? (
                                                    <Image src={sCard.imageUrl} alt={sCard.title} fill className="object-cover" unoptimized />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                                                        <ImageIcon className="h-4 w-4 opacity-20" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium truncate group-hover:text-primary transition-colors" title={sCard.title}>
                                                    {sCard.title}
                                                </p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <Badge variant="outline" className="text-[8px] h-3 px-1 leading-none uppercase tracking-tighter">
                                                        {sCard.type}
                                                    </Badge>
                                                    <span className="text-[10px] text-muted-foreground font-mono">${sCard.price.toFixed(2)}</span>
                                                </div>
                                            </div>
                                            <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                                                <a href={sCard.url} target="_blank" rel="noopener noreferrer">
                                                    <ExternalLink className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                                                </a>
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-[10px] text-muted-foreground italic">
                                    No variations found for this specific player/set.
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
                                                unoptimized={card.imageUrl.includes('psacard.com') || card.imageUrl.includes('ebayimg.com')}
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
                                                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Average Asking Price</p>
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
                                    <CardDescription>Estimated probabilities based on set quality.</CardDescription>
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
                                Price History
                            </CardTitle>
                            <CardDescription>
                                {trendData.length > 0
                                    ? `Tracked market value over ${trendData.length} day${trendData.length > 1 ? 's' : ''}.`
                                    : 'Daily price snapshots will appear here once tracking begins.'
                                }
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="h-[350px] w-full pt-6">
                            {isLoadingHistory ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="h-6 w-6 animate-spin text-primary opacity-50" />
                                </div>
                            ) : trendData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={trendData}>
                                        <defs>
                                            <linearGradient id="colorHistory" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3}/>
                                                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                                        <XAxis 
                                            dataKey="name" 
                                            axisLine={false} 
                                            tickLine={false} 
                                            tick={{fontSize: 12, fill: 'hsl(var(--muted-foreground))'}}
                                            dy={10}
                                        />
                                        <YAxis 
                                            axisLine={false} 
                                            tickLine={false} 
                                            tick={{fontSize: 12, fill: 'hsl(var(--muted-foreground))'}}
                                            tickFormatter={(value) => `$${value}`}
                                        />
                                        <Tooltip 
                                            contentStyle={{ 
                                                backgroundColor: 'hsl(var(--background))', 
                                                borderColor: 'hsl(var(--border))',
                                                borderRadius: '8px',
                                                fontSize: '12px'
                                            }}
                                            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Market Value']}
                                        />
                                        <Area 
                                            type="monotone" 
                                            dataKey="value" 
                                            stroke="#38bdf8" 
                                            strokeWidth={3}
                                            fillOpacity={1} 
                                            fill="url(#colorHistory)" 
                                            animationDuration={1500}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
                                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                        <LineChartIcon className="h-6 w-6 text-muted-foreground opacity-40" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-sm">Price tracking started</p>
                                        <p className="text-xs text-muted-foreground mt-1">Snapshots are taken daily. Your first data point will appear tomorrow.</p>
                                    </div>
                                </div>
                            )}
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

            <Dialog open={isEditingInfo} onOpenChange={setIsEditingInfo}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Edit Card Details</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="player" className="text-right">Player</Label>
                            <Input 
                                id="player" 
                                value={infoInput.player} 
                                className="col-span-3" 
                                onChange={(e) => setInfoInput({...infoInput, player: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="year" className="text-right">Year</Label>
                            <Input 
                                id="year" 
                                value={infoInput.year} 
                                className="col-span-3" 
                                onChange={(e) => setInfoInput({...infoInput, year: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="brand" className="text-right">Brand</Label>
                            <Input 
                                id="brand" 
                                value={infoInput.brand} 
                                className="col-span-3" 
                                onChange={(e) => setInfoInput({...infoInput, brand: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="cardNumber" className="text-right">Card #</Label>
                            <Input 
                                id="cardNumber" 
                                value={infoInput.cardNumber} 
                                className="col-span-3" 
                                onChange={(e) => setInfoInput({...infoInput, cardNumber: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="parallel" className="text-right">Parallel</Label>
                            <Input 
                                id="parallel" 
                                value={infoInput.parallel} 
                                className="col-span-3" 
                                onChange={(e) => setInfoInput({...infoInput, parallel: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="condition" className="text-right">Condition</Label>
                            <Select 
                                value={infoInput.condition} 
                                onValueChange={(value) => setInfoInput({...infoInput, condition: value})}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Select condition" />
                                </SelectTrigger>
                                <SelectContent>
                                    {CARD_CONDITIONS.map((condition) => (
                                        <SelectItem key={condition} value={condition}>
                                            {condition}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="grader" className="text-right">Grader</Label>
                            <Select 
                                value={infoInput.grader} 
                                onValueChange={(value) => setInfoInput({...infoInput, grader: value})}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Select grader" />
                                </SelectTrigger>
                                <SelectContent>
                                    {CARD_GRADERS.map((grader) => (
                                        <SelectItem key={grader} value={grader}>
                                            {grader}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="grade" className="text-right">Grade</Label>
                            <Select 
                                value={infoInput.estimatedGrade} 
                                onValueChange={(value) => setInfoInput({...infoInput, estimatedGrade: value})}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Select grade" />
                                </SelectTrigger>
                                <SelectContent>
                                    {CARD_GRADES.map((grade) => (
                                        <SelectItem key={grade} value={grade}>
                                            {grade}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditingInfo(false)}>Cancel</Button>
                        <Button onClick={handleSaveInfo}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
