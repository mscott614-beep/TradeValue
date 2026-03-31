"use client";

import React, { useState, useEffect, useRef } from "react";
import { Portfolio } from "@/lib/types";
import { getEnrichmentPool } from "@/app/actions/get-enrichment-pool";
import { enrichCardsBatchAction } from "@/app/actions/enrich-card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, RotateCcw, ImageIcon, AlertCircle, CheckCircle2, Loader2, Gauge } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface EnrichmentLog {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error';
    timestamp: string;
}

export function BulkEnrichmentDashboard({ userId }: { userId: string }) {
    const [allCards, setAllCards] = useState<Portfolio[]>([]);
    const [filter, setFilter] = useState<'all' | 'missing' | 'outdated'>('all');
    const [speed, setSpeed] = useState<number>(3000); // Default to Safe/Standard (3s)
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [processedCount, setProcessedCount] = useState(0);
    const [logs, setLogs] = useState<EnrichmentLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const workerRef = useRef<Worker | null>(null);
    const logScrollRef = useRef<HTMLDivElement>(null);

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

    // Initialize Web Worker
    useEffect(() => {
        workerRef.current = new Worker(new URL("/workers/enrichment-worker.js", window.location.origin));

        workerRef.current.onmessage = async (e) => {
            const { type, payload } = e.data;

            if (type === 'PROCESS_BATCH') {
                const { batchIds, currentIndex: batchStart, total, message } = payload;
                const batchCards = filteredCards.filter(c => batchIds.includes(c.id));
                
                if (batchCards.length > 0) {
                    addLog(`📦 ${message}`, 'info');
                    
                    // Call the batch server action
                    const result = await enrichCardsBatchAction(userId, batchCards);
                    
                    if (result.success && result.batchResults) {
                        let successCount = 0;
                        result.batchResults.forEach((res: any) => {
                            if (res.success) successCount++;
                            addLog(
                                res.success ? `✅ ${res.title} enriched.` : `❌ ${res.title} failed: ${res.error || 'Unknown error'}`,
                                res.success ? 'success' : 'error'
                            );
                        });

                        // Update overall progress
                        const totalProcessed = batchStart + batchIds.length;
                        setProcessedCount(totalProcessed);
                        setProgress(Math.round((totalProcessed / total) * 100));

                        // Signal worker that batch is done and it can start the cooldown timer
                        workerRef.current?.postMessage({ type: 'BATCH_SUCCESS' });
                    } else {
                        addLog(`❌ Batch failed: ${result.error}`, 'error');
                        // Even on failure, we signal worker to potentially continue or stop
                        workerRef.current?.postMessage({ type: 'BATCH_SUCCESS' });
                    }
                }
            } else if (type === 'PROGRESS_UPDATE') {
                addLog(payload.message, payload.status === 'warning' ? 'error' : 'info');
            } else if (type === 'ENRICHMENT_COMPLETE') {
                setIsProcessing(false);
                addLog("✨ Bulk enrichment complete!", 'info');
                toast.success("Enrichment complete!");
            }
        };

        return () => {
            workerRef.current?.terminate();
        };
    }, [allCards, filter]); // Re-init if filter changes (simplified for now)

    // Filtering logic
    const filteredCards = allCards.filter(card => {
        if (filter === 'all') return true;
        if (filter === 'missing') {
            // Check for placeholder images
            return !card.imageUrl || card.imageUrl.includes("picsum.photos") || card.imageUrl.includes("placeholder");
        }
        if (filter === 'outdated') {
            // Check if last enriched > 30 days or never enriched
            if (!card.lastEnriched) return true;
            const lastEnriched = new Date(card.lastEnriched);
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            return lastEnriched < thirtyDaysAgo;
        }
        return true;
    });

    const addLog = (message: string, type: 'info' | 'success' | 'error') => {
        const newLog: EnrichmentLog = {
            id: Math.random().toString(36).substring(2, 11),
            message,
            type,
            timestamp: new Date().toLocaleTimeString()
        };
        setLogs(prev => [newLog, ...prev].slice(0, 50)); // Keep last 50 logs
    };

    const handleStart = () => {
        if (filteredCards.length === 0) {
            toast.error("No cards found for this filter.");
            return;
        }
        setIsProcessing(true);
        setProcessedCount(0);
        setProgress(0);
        setLogs([]);
        addLog(`🚀 Starting enrichment at ${speed}ms interval...`, 'info');
        
        workerRef.current?.postMessage({
            type: 'START_ENRICHMENT',
            payload: {
                cardIds: filteredCards.map(c => c.id),
                batchSize: 5,
                batchDelay: speed // Use the user-selected speed as the gap between batches (default 3s)
            }
        });
    };

    const handlePause = () => {
        setIsProcessing(false);
        workerRef.current?.postMessage({ type: 'STOP_ENRICHMENT' });
        addLog("⏸ Enrichment paused.", 'info');
    };

    const handleResume = () => {
        setIsProcessing(true);
        workerRef.current?.postMessage({ type: 'RESUME_ENRICHMENT' });
        addLog("▶ Enrichment resumed.", 'info');
    };

    const handleReset = () => {
        setIsProcessing(false);
        setProgress(0);
        setProcessedCount(0);
        setLogs([]);
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
                            {allCards.filter(c => !c.imageUrl || c.imageUrl.includes("picsum.photos") || c.imageUrl.includes("placeholder")).length}
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
                            {allCards.filter(c => {
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
                            <CardTitle>Bulk Enrichment Engine</CardTitle>
                            <CardDescription>
                                Currently processing: <Badge variant="outline">{filter.toUpperCase()}</Badge> ({filteredCards.length} candidates)
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-1.5 min-w-[140px]">
                                <Label htmlFor="speed" className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1">
                                    <Gauge className="h-3 w-3" /> Processing Speed
                                </Label>
                                <Select 
                                    value={speed.toString()} 
                                    onValueChange={(v) => setSpeed(parseInt(v))}
                                    disabled={isProcessing}
                                >
                                    <SelectTrigger id="speed" className="h-8 text-xs">
                                        <SelectValue placeholder="Select speed" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1000">Turbo (1s)</SelectItem>
                                        <SelectItem value="3000">Standard (3s)</SelectItem>
                                        <SelectItem value="5000">Safe (5s)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center gap-2 pt-5">
                                {isProcessing ? (
                                    <Button variant="outline" size="sm" onClick={handlePause} className="h-8">
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
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Processing Queue</span>
                            <span>{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-3" />
                        <div className="flex justify-between text-xs font-mono">
                            <span>Card {processedCount} of {filteredCards.length}</span>
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
                                {logs.map((log) => (
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

