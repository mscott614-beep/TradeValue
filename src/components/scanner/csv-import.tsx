"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, CheckCircle, FileText, AlertCircle } from "lucide-react";
import { useFirestore, useUser } from "@/firebase";
import { collection, doc, writeBatch } from "firebase/firestore";
import Papa from "papaparse";
import { normalizeCsvRow } from "@/lib/csv-utils";
import type { Portfolio } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { parseCsvTitlesAction } from "@/app/actions/parse-csv-action";
import { BrainCircuit } from "lucide-react";

export function CsvImport() {
    const [isImporting, setIsImporting] = useState(false);
    const [preview, setPreview] = useState<Partial<Portfolio>[]>([]);
    const [fileName, setFileName] = useState<string>("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const firestore = useFirestore();
    const { user } = useUser();

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setIsImporting(true);
        console.log("Starting CSV parse for:", file.name);

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                console.log("Parse complete. Rows found:", results.data?.length);
                if (!results.data || results.data.length === 0) {
                    toast({
                        title: "Empty File",
                        description: "The CSV file appears to be empty.",
                        variant: "destructive"
                    });
                    setIsImporting(false);
                    return;
                }

                const normalizedData = results.data.map((row, i) => {
                    const normalized = normalizeCsvRow(row);
                    if (i === 0) console.log("First row normalization test:", { original: row, normalized });
                    return normalized;
                }).filter(row => row.title || row.player);

                console.log("Normalized rows with Title/Player:", normalizedData.length);

                setPreview(normalizedData);
                setIsImporting(false);

                if (normalizedData.length === 0) {
                    console.warn("No cards identified. Check headers:", Object.keys(results.data[0] as any));
                    toast({
                        title: "No Data Identified",
                        description: "Could not find 'Title' or 'Player' columns. Please check your CSV headers.",
                        variant: "destructive"
                    });
                } else {
                    toast({
                        title: "Import Ready",
                        description: `Identified ${normalizedData.length} cards. Click 'Confirm' to save.`,
                    });
                }
            },
            error: (error) => {
                console.error("PapaParse error:", error);
                toast({
                    title: "Import Error",
                    description: `Failed to parse CSV: ${error.message}`,
                    variant: "destructive"
                });
                setIsImporting(false);
            }
        });
    };

    const handleEnhanceWithAI = async () => {
        setIsImporting(true);
        const BATCH_SIZE = 20; // Safe batch size

        let updatedPreview = [...preview];

        try {
            for (let i = 0; i < updatedPreview.length; i += BATCH_SIZE) {
                const batch = updatedPreview.slice(i, i + BATCH_SIZE);
                // Extract titles for cases where player/year is missing or we just want better parsing
                const titlesToParse = batch.map(row => row.title || "");

                toast({
                    title: "AI Processing",
                    description: `Analyzing rows ${i + 1} to ${Math.min(i + BATCH_SIZE, updatedPreview.length)} of ${updatedPreview.length}...`,
                });

                const response = await parseCsvTitlesAction(titlesToParse);

                if (response.success && response.result) {
                    // Merge results back
                    response.result.forEach((parsedData, index) => {
                        const globalIndex = i + index;
                        updatedPreview[globalIndex] = {
                            ...updatedPreview[globalIndex],
                            player: parsedData.player || updatedPreview[globalIndex].player,
                            year: parsedData.year || updatedPreview[globalIndex].year,
                            brand: parsedData.brand || updatedPreview[globalIndex].brand,
                            condition: parsedData.condition || updatedPreview[globalIndex].condition,
                            grader: parsedData.grader || updatedPreview[globalIndex].grader,
                            parallel: parsedData.parallel || updatedPreview[globalIndex].parallel,
                            features: parsedData.features && parsedData.features.length > 0 ? parsedData.features : updatedPreview[globalIndex].features,
                        };
                    });

                    // Update state to show progress
                    setPreview([...updatedPreview]);
                } else {
                    console.error("Batch failed", response.error);
                    throw new Error(response.error);
                }
            }

            toast({
                title: "AI Enhancement Complete",
                description: "Successfully extracted metadata from eBay titles.",
                action: <CheckCircle className="text-green-500" />
            });

        } catch (error: any) {
            toast({
                title: "Enhancement Failed",
                description: error.message || "Failed to contact AI parser.",
                variant: "destructive"
            });
        } finally {
            setIsImporting(false);
        }
    }

    const handleUpload = async () => {
        if (!preview.length || !user || !firestore) return;

        setIsImporting(true);
        try {
            const batch = writeBatch(firestore);
            const portfoliosRef = collection(firestore, `users/${user.uid}/portfolios`);

            preview.forEach((card) => {
                const newDocRef = doc(portfoliosRef);
                const cardData: Omit<Portfolio, 'id'> = {
                    userId: user.uid,
                    cardId: `csv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    imageUrl: '',
                    title: card.title || "Untitled Card",
                    player: card.player || "Unknown Player",
                    year: (card.year || new Date().getFullYear()).toString(),
                    brand: card.brand || "Unknown Brand",
                    condition: card.condition || "Raw",
                    estimatedGrade: card.condition || "Raw",
                    grader: card.grader || "None",
                    cardNumber: card.cardNumber || "",
                    parallel: card.parallel || "",
                    features: Array.isArray(card.features) ? card.features : (typeof card.features === 'string' ? (card.features as string).split(',').map(s => s.trim()) : []),
                    purchasePrice: Number(card.purchasePrice) || 0,
                    currentMarketValue: Number(card.currentMarketValue) || 0,
                    dateAdded: new Date().toISOString(),
                };
                batch.set(newDocRef, cardData);
            });

            await batch.commit();

            toast({
                title: "Import Complete",
                description: `Successfully added ${preview.length} cards to your collection.`,
                action: <CheckCircle className="text-green-500" />
            });

            // Reset
            setPreview([]);
            setFileName("");
            if (fileInputRef.current) fileInputRef.current.value = "";
        } catch (error: any) {
            toast({
                title: "Upload Failed",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-primary/20 rounded-xl p-10 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer"
                onClick={() => {
                    if (fileInputRef.current) fileInputRef.current.value = "";
                    fileInputRef.current?.click();
                }}>
                <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                />
                <div className="bg-primary/20 p-4 rounded-full mb-4">
                    <Upload className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-1">Click to Upload CSV</h3>
                <p className="text-sm text-muted-foreground text-center max-w-xs">
                    Supports eBay exports and standard trading card spreadsheets.
                </p>
                {fileName && <p className="mt-4 text-primary font-medium flex items-center bg-primary/10 px-3 py-1 rounded-full text-xs">
                    <FileText className="w-3 h-3 mr-1" /> {fileName}
                </p>}
            </div>

            {preview.length > 0 && (
                <Card className="bg-muted/30 border-primary/10">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-semibold flex items-center">
                                Preview <Badge variant="outline" className="ml-2 font-mono">{preview.length} rows</Badge>
                            </h3>
                            <div className="flex gap-2">
                                <Button size="sm" variant="secondary" onClick={handleEnhanceWithAI} disabled={isImporting} className="border-primary/50 text-primary hover:bg-primary/10">
                                    {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
                                    <span className="hidden sm:inline">Enhance Rows with AI</span>
                                    <span className="sm:hidden">Enhance</span>
                                </Button>
                                <Button size="sm" onClick={handleUpload} disabled={isImporting}>
                                    {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                                    <span className="hidden sm:inline">Confirm Import</span>
                                    <span className="sm:hidden">Confirm</span>
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { setPreview([]); setFileName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }} disabled={isImporting}>
                                    Clear
                                </Button>
                            </div>
                        </div>

                        <div className="max-h-[300px] overflow-y-auto rounded-md border border-border bg-background">
                            <table className="w-full text-sm">
                                <thead className="bg-muted sticky top-0">
                                    <tr className="text-left">
                                        <th className="p-3 font-semibold">Title</th>
                                        <th className="p-3 font-semibold">Player</th>
                                        <th className="p-3 font-semibold">Year</th>
                                        <th className="p-3 font-semibold">Parallel</th>
                                        <th className="p-3 font-semibold">Features</th>
                                        <th className="p-3 font-semibold">Value</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {preview.slice(0, 50).map((row, i) => (
                                        <tr key={i} className="hover:bg-muted/30 transition-colors">
                                            <td className="p-3 truncate max-w-[200px]" title={row.title}>{row.title || "---"}</td>
                                            <td className="p-3 font-medium">{row.player || "---"}</td>
                                            <td className="p-3 text-muted-foreground">{row.year || "---"}</td>
                                            <td className="p-3 text-muted-foreground">{row.parallel || "---"}</td>
                                            <td className="p-3 text-muted-foreground text-xs truncate max-w-[150px]" title={row.features?.join(', ')}>
                                                {row.features?.length ? row.features.join(', ') : "---"}
                                            </td>
                                            <td className="p-3 text-green-500 font-mono">
                                                {row.currentMarketValue ? `$${Number(row.currentMarketValue).toFixed(2)}` : "---"}
                                            </td>
                                        </tr>
                                    ))}
                                    {preview.length > 50 && (
                                        <tr>
                                            <td colSpan={4} className="p-3 text-center text-muted-foreground italic">
                                                + {preview.length - 50} more rows...
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg border border-border">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <p>
                                Make sure your CSV has headers like <strong>Title</strong>, <strong>Player</strong>, and <strong>Price</strong>.
                                Common eBay headers like "Item Title" are automatically recognized.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
