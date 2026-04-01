"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Portfolio } from "@/lib/types";
import { getEnrichmentPool } from "@/app/actions/get-enrichment-pool";
import { saveEnrichmentResultAction, getGeminiConfigAction } from "@/app/actions/enrich-card";
import { refreshCardValueAction } from "@/app/actions/refresh-card-value";
import { fetchAndEncodeImageAction } from "@/app/actions/fetch-image";
import { auditImageLinksAction, AuditResult } from "@/app/actions/audit-images";
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
import {
    Play,
    Pause,
    RotateCcw,
    ImageIcon,
    AlertCircle,
    CheckCircle2,
    Loader2,
    SkipForward,
    SearchCheck,
} from "lucide-react";
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
    /** Already-fetched base64 data URL — safe to render in <img> */
    previewDataUrl: string;
    metadata: any;
    price: number;
    log: string;
}

export function BulkEnrichmentDashboard({ userId }: { userId: string }) {
    const [allCards, setAllCards] = useState<Portfolio[]>([]);
    const [filter, setFilter] = useState<'all' | 'missing' | 'outdated'>('all');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isQuotaLimit, setIsQuotaLimit] = useState(false);
    const [progress, setProgress] = useState(0);
    const [processedCount, setProcessedCount] = useState(0);
    const [logs, setLogs] = useState<EnrichmentLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Image confirmation state
    const [pendingConfirmation, setPendingConfirmation] = useState<PendingImageConfirmation | null>(null);
    const [isSavingConfirm, setIsSavingConfirm] = useState(false);

    // Dead link audit state
    const [isAuditing, setIsAuditing] = useState(false);
    const [auditResult, setAuditResult] = useState<AuditResult | null>(null);

    const workerRef = useRef<Worker | null>(null);
    const allCardsRef = useRef<Portfolio[]>([]);
    const processingQueueSizeRef = useRef<number>(0);

    useEffect(() => { allCardsRef.current = allCards; }, [allCards]);

    // Initial pool load
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

    const addLog = useCallback((message: string, type: 'info' | 'success' | 'error') => {
        setLogs(prev => {
            const newLog: EnrichmentLog = {
                id: Math.random().toString(36).substring(2, 11),
                message,
                type,
                timestamp: new Date().toLocaleTimeString(),
            };
            return Array.isArray(prev) ? [newLog, ...prev].slice(0, 50) : [newLog];
        });
    }, []);

    /** Commits enrichment result and signals the worker to advance. */
    const commitAndContinue = useCallback(async (
        cardId: string,
        metadata: any,
        price: number,
        log: string,
        resolvedImageUrl: string | null
    ) => {
        const updates: any = { ...metadata, currentMarketValue: price };
        if (resolvedImageUrl) updates.imageUrl = resolvedImageUrl;

        const saveResult = await saveEnrichmentResultAction(userId, cardId, updates);
        if (saveResult.success) {
            addLog(log, 'success');
            setProcessedCount(prev => {
                const newCount = prev + 1;
                setProgress(Math.round((newCount / (processingQueueSizeRef.current || 1)) * 100));
                return newCount;
            });
        } else {
            addLog(`❌ Failed to save: ${saveResult.error}`, 'error');
        }
        workerRef.current?.postMessage({ type: 'CARD_COMMITTED' });
    }, [userId, addLog]);

    // ─── Image Confirmation Handlers ────────────────────────────────────────

    const handleConfirmImage = useCallback(async () => {
        if (!pendingConfirmation) return;
        const { cardId, previewDataUrl, metadata, price, log } = pendingConfirmation;
        setIsSavingConfirm(true);
        try {
            await commitAndContinue(cardId, metadata, price, log, previewDataUrl);
        } finally {
            setIsSavingConfirm(false);
            setPendingConfirmation(null);
        }
    }, [pendingConfirmation, commitAndContinue]);

    const handleSkipImage = useCallback(async () => {
        if (!pendingConfirmation) return;
        const { cardId, metadata, price, log } = pendingConfirmation;
        addLog(`⏭ Image skipped. Saving metadata only.`, 'info');
        setPendingConfirmation(null);
        await commitAndContinue(cardId, metadata, price, log, null);
    }, [pendingConfirmation, commitAndContinue, addLog]);

    // ─── Worker Initialization ───────────────────────────────────────────────

    useEffect(() => {
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
                const result = await refreshCardValueAction(userId, payload.card);
                workerRef.current?.postMessage({ type: 'PRICING_RESULT', payload: result });

            } else if (type === 'CARD_ENRICHED') {
                const { cardId, title, metadata, price, log, imageUrl } = payload;

                if (imageUrl) {
                    // ── Pre-fetch the image server-side BEFORE showing dialog ──
                    addLog(`📥 Verifying image for ${title}...`, 'info');
                    const fetchResult = await fetchAndEncodeImageAction(imageUrl);

                    if (fetchResult.success && fetchResult.dataUrl) {
                        // Image is downloadable — show dialog with working base64 preview
                        addLog(`🖼️ Image verified. Awaiting your confirmation...`, 'info');
                        setPendingConfirmation({
                            cardId,
                            cardTitle: title,
                            previewDataUrl: fetchResult.dataUrl,
                            metadata,
                            price,
                            log,
                        });
                        // Worker waits for CARD_COMMITTED from the dialog handler
                    } else {
                        // Dead URL — skip dialog, auto-commit without image
                        addLog(`⚠️ Image unreachable (${fetchResult.error}). Saving without image.`, 'error');
                        await commitAndContinue(cardId, metadata, price, log, null);
                    }
                } else {
                    // No image found by AI — commit immediately
                    await commitAndContinue(cardId, metadata, price, log, null);
                }

            } else if (type === 'CARD_ERROR') {
                addLog(payload.log, 'error');
                setProcessedCount(prev => {
                    const newCount = prev + 1;
                    setProgress(Math.round((newCount / (processingQueueSizeRef.current || 1)) * 100));
                    return newCount;
                });
                workerRef.current?.postMessage({ type: 'CARD_COMMITTED' });

            } else if (type === 'ENRICHMENT_COMPLETE') {
                setIsProcessing(false);
                setIsQuotaLimit(false);
                addLog("✨ Bulk enrichment complete!", 'info');
                toast.success("Enrichment complete!");
            }
        };

        return () => { workerRef.current?.terminate(); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Dead Link Audit ─────────────────────────────────────────────────────

    const handleAudit = useCallback(async () => {
        setIsAuditing(true);
        setAuditResult(null);
        addLog("🔍 Scanning collection for dead image links...", 'info');

        const result = await auditImageLinksAction(userId);

        if (result.success && result.result) {
            setAuditResult(result.result);
            const { total, copied, fixed } = result.result;
            addLog(`✅ Audit complete: ${copied} images permanently copied, ${fixed} dead links cleared (${total} external URLs scanned).`, 'success');
            toast.success(`Audit complete! ${copied} saved, ${fixed} dead links removed.`);
        } else {
            addLog(`❌ Audit failed: ${result.error}`, 'error');
            toast.error("Audit failed. Check the activity log.");
        }
        setIsAuditing(false);
    }, [userId, addLog]);

    // ─── Filtering ───────────────────────────────────────────────────────────

    const safeCards = Array.isArray(allCards) ? allCards : [];

    const filteredCards = safeCards.filter(card => {
        if (filter === 'all') return true;
        if (filter === 'missing') {
            const url = card.imageUrl;
            return !url || url.includes("picsum.photos") || url.includes("placeholder") || (url.startsWith('http') && !url.startsWith('data:'));
        }
        if (filter === 'outdated') {
            if (!card.lastEnriched) return true;
            return new Date(card.lastEnriched) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        }
        return true;
    });

    const missingCount = safeCards.filter(c => {
        const url = c.imageUrl;
        return !url || url.includes("picsum.photos") || url.includes("placeholder") || (!!url && url.startsWith('http') && !url.startsWith('data:'));
    }).length;

    const outdatedCount = safeCards.filter(c => {
        if (!c.lastEnriched) return true;
        return new Date(c.lastEnriched) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }).length;

    // ─── Control Handlers ────────────────────────────────────────────────────

    const handleStart = async () => {
        if (filteredCards.length === 0) { toast.error("No cards found for this filter."); return; }
        setIsProcessing(true);
        setProcessedCount(0);
        setProgress(0);
        setLogs([]);
        processingQueueSizeRef.current = filteredCards.length;
        try {
            const { apiKey } = await getGeminiConfigAction();
            workerRef.current?.postMessage({
                type: 'START_ENRICHMENT',
                payload: { apiKey, cardIds: filteredCards.map(c => c.id) }
            });
        } catch {
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
        setAuditResult(null);
        workerRef.current?.postMessage({ type: 'RESET_ENRICHMENT' });
        toast.info("Enrichment reset.");
    };

    // ─── Render ──────────────────────────────────────────────────────────────

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

            {/* ── Image Confirmation Dialog ─────────────────────────────── */}
            <Dialog open={!!pendingConfirmation} onOpenChange={() => {}}>
                <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ImageIcon className="h-5 w-5 text-primary" />
                            Image Confirmation
                        </DialogTitle>
                        <DialogDescription>
                            Found a verified image for <strong>{pendingConfirmation?.cardTitle}</strong>.
                            Is this the correct card?
                        </DialogDescription>
                    </DialogHeader>

                    {pendingConfirmation && (
                        <div className="flex flex-col items-center gap-3 py-4">
                            <div className="relative w-48 h-64 rounded-lg overflow-hidden border border-border bg-muted/30 shadow-md">
                                {/* Uses base64 preview — guaranteed to load */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={pendingConfirmation.previewDataUrl}
                                    alt={pendingConfirmation.cardTitle}
                                    className="w-full h-full object-contain"
                                />
                            </div>
                            <Badge variant="outline" className="text-xs text-green-600 border-green-400">
                                ✅ Image verified & ready to save
                            </Badge>
                        </div>
                    )}

                    <DialogFooter className="flex gap-2 sm:gap-2">
                        <Button
                            variant="outline"
                            onClick={handleSkipImage}
                            disabled={isSavingConfirm}
                            className="flex-1"
                        >
                            <SkipForward className="h-4 w-4 mr-2" />
                            Skip Image
                        </Button>
                        <Button
                            onClick={handleConfirmImage}
                            disabled={isSavingConfirm}
                            className="flex-1"
                        >
                            {isSavingConfirm
                                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                : <CheckCircle2 className="h-4 w-4 mr-2" />
                            }
                            {isSavingConfirm ? "Saving..." : "Use This Image"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Filter Cards ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card
                    className={`cursor-pointer transition-all hover:shadow-md ${filter === 'all' ? 'border-primary ring-1 ring-primary' : ''}`}
                    onClick={() => !isProcessing && setFilter('all')}
                >
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium text-primary">All Cards</CardTitle>
                        <CardDescription className="text-2xl font-bold">{safeCards.length}</CardDescription>
                    </CardHeader>
                </Card>
                <Card
                    className={`cursor-pointer transition-all hover:shadow-md ${filter === 'missing' ? 'border-amber-500 ring-1 ring-amber-500' : ''}`}
                    onClick={() => !isProcessing && setFilter('missing')}
                >
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-500">
                            <ImageIcon className="h-4 w-4" /> Missing / External Images
                        </CardTitle>
                        <CardDescription className="text-2xl font-bold">{missingCount}</CardDescription>
                    </CardHeader>
                </Card>
                <Card
                    className={`cursor-pointer transition-all hover:shadow-md ${filter === 'outdated' ? 'border-rose-500 ring-1 ring-rose-500' : ''}`}
                    onClick={() => !isProcessing && setFilter('outdated')}
                >
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-rose-500">
                            <AlertCircle className="h-4 w-4" /> Outdated Data
                        </CardTitle>
                        <CardDescription className="text-2xl font-bold">{outdatedCount}</CardDescription>
                    </CardHeader>
                </Card>
            </div>

            {/* ── Dead Link Audit ───────────────────────────────────────── */}
            <Card className="border border-dashed border-amber-500/40 bg-amber-500/5">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <SearchCheck className="h-4 w-4" />
                        Dead Link Audit
                    </CardTitle>
                    <CardDescription className="text-xs">
                        Scans all cards with external image URLs (e.g. COMC, TCDB). Live images are permanently copied to your database; dead links are cleared so cards show a clean placeholder.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAudit}
                        disabled={isAuditing || isProcessing}
                        className="border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                    >
                        {isAuditing
                            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning...</>
                            : <><SearchCheck className="h-4 w-4 mr-2" /> Run Audit</>
                        }
                    </Button>
                    {auditResult && (
                        <div className="text-xs text-muted-foreground space-x-3">
                            <span className="text-green-600 font-medium">✅ {auditResult.copied} copied</span>
                            <span className="text-rose-600 font-medium">🗑️ {auditResult.fixed} dead links cleared</span>
                            <span className="text-muted-foreground">{auditResult.total} external URLs scanned</span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Enrichment Engine ─────────────────────────────────────── */}
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
                                        ⏸ IMAGE REVIEW
                                    </Badge>
                                )}
                            </CardTitle>
                            <CardDescription>
                                High-Stability Serial Mode &nbsp;|&nbsp;
                                <Badge variant="outline">{filter.toUpperCase()}</Badge> ({filteredCards.length} candidates)
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            {isProcessing ? (
                                <Button variant="outline" size="sm" onClick={handlePause}
                                    disabled={!!pendingConfirmation} className="h-8">
                                    <Pause className="h-4 w-4 mr-2" /> Pause
                                </Button>
                            ) : (
                                processedCount > 0 && processedCount < filteredCards.length ? (
                                    <Button variant="default" size="sm" onClick={handleResume} className="h-8">
                                        <Play className="h-4 w-4 mr-2" /> Resume
                                    </Button>
                                ) : (
                                    <Button variant="default" size="sm" onClick={handleStart}
                                        disabled={filteredCards.length === 0} className="h-8">
                                        <Play className="h-4 w-4 mr-2" /> Start Enrichment
                                    </Button>
                                )
                            )}
                            <Button variant="ghost" size="sm" onClick={handleReset}
                                disabled={isProcessing || processedCount === 0} className="h-8">
                                <RotateCcw className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span className="flex items-center gap-2">
                                {isProcessing && !pendingConfirmation && !isQuotaLimit &&
                                    <Loader2 className="h-3 w-3 animate-spin" />}
                                {pendingConfirmation
                                    ? "⏸ Paused — confirm the image above to continue."
                                    : isQuotaLimit
                                        ? "⏳ Quota cool-down (15s)..."
                                        : isProcessing
                                            ? "Running..."
                                            : "Ready"}
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
                                    <div key={log.id}
                                        className="text-xs transition-all animate-in fade-in slide-in-from-top-1">
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
