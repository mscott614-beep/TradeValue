"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Portfolio } from "@/lib/types";
import { getEnrichmentPool } from "@/app/actions/get-enrichment-pool";
import { saveEnrichmentResultAction, getGeminiConfigAction } from "@/app/actions/enrich-card";
import { refreshCardValueAction } from "@/app/actions/refresh-card-value";
import { fetchAndEncodeImageAction } from "@/app/actions/fetch-image";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Play, Pause, RotateCcw, ImageIcon, AlertCircle, CheckCircle2, Loader2, SkipForward } from "lucide-react";
import { toast } from "sonner";

interface EnrichmentLog {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error';
    timestamp: string;
}

interface PendingImageConfirmation {
    cardId: string;
    cardTitle: string;
    imageUrl: string;
    metadata: any;
    price: number;
    log: string;
}

export function BulkEnrichmentDashboard({ userId }: { userId: string }) {
    const [isQuotaLimit, setIsQuotaLimit] = useState(false);
    const [allCards, setAllCards] = useState<Portfolio[]>([]);
    const [filter, setFilter] = useState<'all' | 'missing' | 'outdated'>('all');
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [processedCount, setProcessedCount] = useState(0);
    const [logs, setLogs] = useState<EnrichmentLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Image confirmation state
    const [pendingConfirmation, setPendingConfirmation] = useState<PendingImageConfirmation | null>(null);
    const [isFetchingImage, setIsFetchingImage] = useState(false);

    const workerRef = useRef<Worker | null>(null);
    const allCardsRef = useRef<Portfolio[]>([]);
    const filterRef = useRef<'all' | 'missing' | 'outdated'>(filter);
    const processingQueueSizeRef = useRef<number>(0);

    // Keep refs in sync for worker callbacks
    useEffect(() => {
        allCardsRef.current = allCards;
        filterRef.current = filter;
    }, [allCards, filter]);

    // Initial load of pool
    useEffect(() => {
        const fetchPool = async () => {
            const result = await getEnrichmentPool(userId);
            if (result.success && result.cards) {
                setAllCards(result.cards);
            } else {
                toast.error("Failed to load your collection for enrichment.");
            }
            setIsLoading(false);
        };
        fetchPool();
    }, [userId]);

    const addLog = (message: string, type: 'info' | 'success' | 'error') => {
        const newLog: EnrichmentLog = {
            id: Math.random().toString(36).substring(2, 11),
            message,
            type,
            timestamp: new Date().toLocaleTimeString()
        };
        setLogs(prev => Array.isArray(prev) ? [newLog, ...prev].slice(0, 50) : [newLog]);
    };

    /**
     * Commits an enrichment result to Firestore and signals the worker to continue.
     */
    const commitAndContinue = useCallback(async (
        cardId: string,
        metadata: any,
        price: number,
        log: string,
        resolvedImageUrl?: string | null
    ) => {
        const updates: any = { ...metadata, currentMarketValue: price };

        if (resolvedImageUrl) {
            updates.imageUrl = resolvedImageUrl;
        }

        const saveResult = await saveEnrichmentResultAction(userId, cardId, updates);

        if (saveResult.success) {
            addLog(log, 'success');
            setProcessedCount(prev => {
                const newCount = prev + 1;
                const total = processingQueueSizeRef.current || 1;
                setProgress(Math.round((newCount / total) * 100));
                return newCount;
            });
        } else {
            addLog(`❌ Failed to save: ${saveResult.error}`, 'error');
        }

        // Signal worker to advance to the next card
        workerRef.current?.postMessage({ type: 'CARD_COMMITTED' });
    }, [userId]);

    /**
     * Handles "Use This Image" confirmation — fetches image server-side, encodes it, then saves.
     */
    const handleConfirmImage = useCallback(async () => {
        if (!pendingConfirmation) return;
        const { cardId, cardTitle, imageUrl, metadata, price, log } = pendingConfirmation;

        setIsFetchingImage(true);
        addLog(`📥 Copying image for ${cardTitle}...`, 'info');

        try {
            const fetchResult = await fetchAndEncodeImageAction(imageUrl);

            if (fetchResult.success && fetchResult.dataUrl) {
                addLog(`✅ Image copied successfully.`, 'success');
                await commitAndContinue(cardId, metadata, price, log, fetchResult.dataUrl);
            } else {
                addLog(`⚠️ Image copy failed (${fetchResult.error}). Saving without image.`, 'error');
                await commitAndContinue(cardId, metadata, price, log, null);
            }
        } catch (err: any) {
            addLog(`⚠️ Image copy error: ${err.message}. Saving without image.`, 'error');
            await commitAndContinue(cardId, metadata, price, log, null);
        } finally {
            setIsFetchingImage(false);
            setPendingConfirmation(null);
        }
    }, [pendingConfirmation, commitAndContinue]);

    /**
     * Handles "Skip Image" — saves the card without an image.
     */
    const handleSkipImage = useCallback(async () => {
        if (!pendingConfirmation) return;
        const { cardId, metadata, price, log } = pendingConfirmation;
        addLog(`⏭ Image skipped. Saving metadata only.`, 'info');
        setPendingConfirmation(null);
        await commitAndContinue(cardId, metadata, price, log, null);
    }, [pendingConfirmation, commitAndContinue]);

    // Initialize Web Worker ONCE
    useEffect(() => {
        console.log("[Dashboard] Initializing persistent worker.");
        workerRef.current = new Worker(
            new URL('../../workers/enrichment-worker', import.meta.url),
            { type: 'module' }
        );

        workerRef.current.onmessage = async (e) => {
            const { type, payload } = e.data;

            if (type === 'LOG_UPDATE') {
                addLog(payload.message, payload.type);
            } else if (type === 'GET_CARD_DATA') {
                const card = allCardsRef.current.find(c => c.id === payload.cardId);
                workerRef.current?.postMessage({ type: 'CARD_DATA_RESULT', payload: card });
            } else if (type === 'GET_PRICE') {
                addLog(`🔍 Fetching current market value...`, 'info');
                const result = await refreshCardValueAction(userId, payload.card);
                workerRef.current?.postMessage({ type: 'PRICING_RESULT', payload: result });
            } else if (type === 'CARD_ENRICHED') {
                const { cardId, title, metadata, price, log, imageUrl } = payload;
                const hasNewImage = !!imageUrl;

                if (hasNewImage) {
                    // Pause worker: show confirmation dialog to user
                    addLog(`🖼️ Found candidate image for ${title}. Awaiting confirmation...`, 'info');
                    setPendingConfirmation({ cardId, cardTitle: title, imageUrl, metadata, price, log });
                    // Worker is now paused waiting for CARD_COMMITTED
                } else {
                    // No image found — commit immediately without dialog
                    await commitAndContinue(cardId, metadata, price, log, null);
                }
            } else if (type === 'CARD_ERROR') {
                addLog(payload.log, 'error');
                setProcessedCount(prev => {
                    const newCount = prev + 1;
                    const total = processingQueueSizeRef.current || 1;
                    setProgress(Math.round((newCount / total) * 100));
                    return newCount;
                });
                // Signal worker to continue even on error
                workerRef.current?.postMessage({ type: 'CARD_COMMITTED' });
            } else if (type === 'ENRICHMENT_COMPLETE') {
                setIsProcessing(false);
                setIsQuotaLimit(false);
                addLog("✨ Bulk enrichment complete!", 'info');
                toast.success("Enrichment complete!");
            }
        };

        return () => {
            console.log("[Dashboard] Terminating worker.");
            workerRef.current?.terminate();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Filtering logic
    const filteredCards = (Array.isArray(allCards) ? allCards : []).filter(card => {
        if (filter === 'all') return true;
        if (filter === 'missing') {
            return !card.imageUrl || card.imageUrl.includes("picsum.photos") || card.imageUrl.includes("placeholder");
        }
        if (filter === 'outdated') {
            if (!card.lastEnriched) return true;
            const lastEnriched = new Date(card.lastEnriched);
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            return lastEnriched < thirtyDaysAgo;
        }
        return true;
    });

    const handleStart = async () => {
        if (filteredCards.length === 0) {
            toast.error("No cards found for this filter.");
            return;
        }

        setIsProcessing(true);
        setProcessedCount(0);
        setProgress(0);
        setLogs([]);
        processingQueueSizeRef.current = filteredCards.length;

        try {
            const { apiKey } = await getGeminiConfigAction();
            workerRef.current?.postMessage({
                type: 'START_ENRICHMENT',
                payload: {
                    apiKey,
                    cardIds: filteredCards.map(c => c.id)
                }
            });
        } catch (error) {
            addLog("❌ Failed to initialize enrichment.", 'error');
            setIsProcessing(false);
        }
    };

    const handlePause = () => {
        setIsProcessing(false);
        workerRef.current?.postMessage({ type: 'STOP_ENRICHMENT' });
        addLog("⏸ Enrichment paused.", 'info');
    };

    const handleResume = () => {
        setIsProcessing(true);
        setIsQuotaLimit(false);
        workerRef.current?.postMessage({ type: 'RESUME_ENRICHMENT' });
        addLog("▶ Enrichment resumed.", 'info');
    };

    const handleReset = () => {
        setIsProcessing(false);
        setIsQuotaLimit(false);
        setProgress(0);
        setProcessedCount(0);
        setLogs([]);
        setPendingConfirmation(null);
        workerRef.current?.postMessage({ type: 'RESET_ENRICHMENT' });
        toast.info("Enrichment reset.");
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-4 text-muted-foreground">Analyzing collection...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Image Confirmation Dialog */}
            <Dialog open={!!pendingConfirmation} onOpenChange={() => {}}>
                <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ImageIcon className="h-5 w-5 text-primary" />
                            Image Confirmation
                        </DialogTitle>
                        <DialogDescription>
                            Gemini found this image for <strong>{pendingConfirmation?.cardTitle}</strong>. Is this the correct card?
                        </DialogDescription>
                    </DialogHeader>

                    {pendingConfirmation && (
                        <div className="flex flex-col items-center gap-4 py-4">
                            <div className="relative w-48 h-64 rounded-lg overflow-hidden border border-border bg-muted/30 shadow-md">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={pendingConfirmation.imageUrl}
                                    alt={pendingConfirmation.cardTitle}
                                    className="w-full h-full object-contain"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground break-all text-center max-w-xs">
                                {pendingConfirmation.imageUrl}
                            </p>
                        </div>
                    )}

                    <DialogFooter className="flex gap-2 sm:gap-2">
                        <Button
                            variant="outline"
                            onClick={handleSkipImage}
                            disabled={isFetchingImage}
                            className="flex-1"
                        >
                            <SkipForward className="h-4 w-4 mr-2" />
                            Skip Image
                        </Button>
                        <Button
                            onClick={handleConfirmImage}
                            disabled={isFetchingImage}
                            className="flex-1"
                        >
                            {isFetchingImage ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                            )}
                            {isFetchingImage ? "Copying..." : "Use This Image"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Control Header */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card
                    className={`cursor-pointer transition-all hover:shadow-md ${filter === 'all' ? 'border-primary ring-1 ring-primary' : ''}`}
                    onClick={() => !isProcessing && setFilter('all')}
                >
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
                            All Cards
                        </CardTitle>
                        <CardDescription className="text-2xl font-bold">{allCards.length}</CardDescription>
                    </CardHeader>
                </Card>
                <Card
                    className={`cursor-pointer transition-all hover:shadow-md ${filter === 'missing' ? 'border-amber-500 ring-1 ring-amber-500' : ''}`}
                    onClick={() => !isProcessing && setFilter('missing')}
                >
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-500">
                            <ImageIcon className="h-4 w-4" />
                            Missing Images
                        </CardTitle>
                        <CardDescription className="text-2xl font-bold">
                            {(Array.isArray(allCards) ? allCards : []).filter(c => !c.imageUrl || c.imageUrl.includes("picsum.photos") || c.imageUrl.includes("placeholder")).length}
                        </CardDescription>
                    </CardHeader>
                </Card>
                <Card
                    className={`cursor-pointer transition-all hover:shadow-md ${filter === 'outdated' ? 'border-rose-500 ring-1 ring-rose-500' : ''}`}
                    onClick={() => !isProcessing && setFilter('outdated')}
                >
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-rose-500">
                            <AlertCircle className="h-4 w-4" />
                            Outdated Data
                        </CardTitle>
                        <CardDescription className="text-2xl font-bold">
                            {(Array.isArray(allCards) ? allCards : []).filter(c => {
                                if (!c.lastEnriched) return true;
                                const lastEnriched = new Date(c.lastEnriched);
                                const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                                return lastEnriched < thirtyDaysAgo;
                            }).length}
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>

            {/* Processing UI */}
            <Card className="border-2">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-3">
                                Bulk Enrichment Engine
                                {isQuotaLimit && (
                                    <Badge variant="destructive" className="animate-pulse bg-orange-600 hover:bg-orange-600">
                                        QUOTA COOL-DOWN
                                    </Badge>
                                )}
                                {pendingConfirmation && (
                                    <Badge variant="outline" className="animate-pulse border-amber-400 text-amber-400">
                                        ⏸ AWAITING IMAGE REVIEW
                                    </Badge>
                                )}
                            </CardTitle>
                            <CardDescription>
                                High-Stability Serial Mode | <Badge variant="outline">{filter.toUpperCase()}</Badge> ({filteredCards.length} candidates)
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            {isProcessing ? (
                                <Button variant="outline" size="sm" onClick={handlePause} className="h-8" disabled={!!pendingConfirmation}>
                                    <Pause className="h-4 w-4 mr-2" /> Pause
                                </Button>
                            ) : (
                                (processedCount > 0 && processedCount < filteredCards.length) ? (
                                    <Button variant="default" size="sm" onClick={handleResume} className="h-8">
                                        <Play className="h-4 w-4 mr-2" /> Resume
                                    </Button>
                                ) : (
                                    <Button variant="default" size="sm" onClick={handleStart} disabled={filteredCards.length === 0} className="h-8">
                                        <Play className="h-4 w-4 mr-2" /> Start Enrichment
                                    </Button>
                                )
                            )}
                            <Button variant="ghost" size="sm" onClick={handleReset} disabled={isProcessing || processedCount === 0} className="h-8">
                                <RotateCcw className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span className="flex items-center gap-2">
                                {isProcessing && !isQuotaLimit && !pendingConfirmation && <Loader2 className="h-3 w-3 animate-spin" />}
                                {pendingConfirmation ? "Paused — review the image above to continue." : isQuotaLimit ? "Quota Limit Active - Waiting 15s..." : "Status: Active"}
                            </span>
                            <span>{progress}%</span>
                        </div>
                        <Progress
                            value={progress}
                            className={`h-3 transition-all duration-300 ${isQuotaLimit ? "[&>div]:bg-orange-500" : ""}`}
                        />
                        <div className="flex justify-between text-xs font-mono">
                            <span>Card {processedCount} of {filteredCards.length}</span>
                            <span className="text-muted-foreground italic">Target: 12 RPM (Stability Lock)</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h4 className="text-sm font-semibold">Activity Log</h4>
                        <ScrollArea className="h-[300px] w-full rounded-md border p-4 bg-slate-50 dark:bg-slate-900">
                            {logs.length === 0 && (
                                <div className="text-center py-12 text-muted-foreground italic text-sm">
                                    No activity yet. Select a filter and press Start.
                                </div>
                            )}
                            <div className="space-y-2">
                                {Array.isArray(logs) && logs.map((log) => (
                                    <div key={log.id} className="text-xs transition-all animate-in fade-in slide-in-from-top-1">
                                        <span className="text-muted-foreground mr-2">[{log.timestamp}]</span>
                                        <span className={
                                            log.type === 'success' ? 'text-green-600' :
                                            log.type === 'error' ? 'text-rose-600' : ''
                                        }>
                                            {log.message}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
