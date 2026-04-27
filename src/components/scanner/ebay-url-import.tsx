"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Link as LinkIcon, Download, PlusCircle, CheckCircle } from "lucide-react";
import { extractEbayListingAction } from "@/app/actions/extract-ebay";
import { useFirestore, useUser } from "@/firebase";
import { collection } from "firebase/firestore";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle } from "lucide-react";

export function EbayUrlImport() {
    const [url, setUrl] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<any>(null); // Uses the extracted Portfolio object
    const [showFallbackDialog, setShowFallbackDialog] = useState(false);

    const { toast } = useToast();
    const firestore = useFirestore();
    const { user } = useUser();

    const handleImport = async (useFallback: boolean = false) => {
        if (!url) return;

        setIsLoading(true);
        if (!useFallback) setResult(null);
        setShowFallbackDialog(false);

        try {
            const response = await extractEbayListingAction(url, useFallback);

            if (response.success && response.data) {
                setResult(response.data);
                toast({
                    title: useFallback ? "Fallback Import Successful" : "Import Successful",
                    description: `Card details extracted${useFallback ? ' using Gemini 1.5' : ''}.`,
                    action: <CheckCircle className="text-green-500" />,
                });
            } else if (response.isModelOverloaded && !useFallback) {
                setShowFallbackDialog(true);
                toast({
                    title: "Gemini is busy",
                    description: "The AI model is currently at capacity.",
                    variant: "default",
                });
            } else {
                toast({
                    title: "Import Failed",
                    description: response.error || "Could not extract card details.",
                    variant: "destructive",
                });
            }
        } catch (error: any) {
            toast({
                title: "Error",
                description: "Failed to connect to import service.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddToCollection = async () => {
        if (!result || !user || !firestore) {
            toast({
                title: "Error",
                description: "Missing data or session. Please try again.",
                variant: "destructive",
            });
            return;
        }

        setIsLoading(true);
        try {
            const portfoliosCollection = collection(firestore, `users/${user.uid}/portfolios`);

            // Defensive data extraction
            const brand = (result.brand || "Unknown").toString();
            const player = (result.player || "Unknown").toString();
            const year = (result.year || "").toString();
            const cleanCardNumber = (result.cardNumber || "").toString().replace('#', '').trim();
            const setName = (result.set || "").toString().trim();
            const currentMarketValue = result.currentMarketValue || 0;

            const cardDataForDb = {
                userId: user.uid,
                cardId: `ebay-${Date.now()}`,
                title: `${year} ${brand} ${setName} ${player}`.replace(/\s+/g, ' ').trim(),
                condition: result.condition || "Raw",
                purchasePrice: currentMarketValue, 
                currentMarketValue: currentMarketValue,
                dateAdded: new Date().toISOString(),
                year,
                brand,
                player,
                set: setName,
                cardNumber: cleanCardNumber,
                estimatedGrade: result.estimatedGrade || "",
                parallel: result.parallel || "",
                grader: result.grader || "None",
                features: result.features || []
            };

            await addDocumentNonBlocking(portfoliosCollection, cardDataForDb);

            toast({
                title: "Card Added",
                description: `${cardDataForDb.title} has been added to your collection.`,
            });

            // Reset
            setUrl("");
            setResult(null);
        } catch (error: any) {
            console.error("Failed to add card to collection:", error);
            toast({
                title: "Error",
                description: error.message || "Failed to add card to collection.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <LinkIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Paste eBay Listing URL here..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="pl-9 h-10"
                    />
                </div>
                <Button onClick={() => handleImport()} disabled={!url || isLoading} className="h-10">
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                    Import
                </Button>
            </div>

            {result && (
                <Card className="bg-muted/50 border-primary/20">
                    <CardContent className="p-6">
                        <h3 className="text-lg font-semibold mb-4 text-primary">Extracted Details</h3>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <p className="text-muted-foreground">Title:</p><p className="font-medium line-clamp-1" title={result.title}>{result.title}</p>
                            <p className="text-muted-foreground">Player:</p><p className="font-medium">{result.player}</p>
                            <p className="text-muted-foreground">Year:</p><p className="font-medium">{result.year}</p>
                            <p className="text-muted-foreground">Brand:</p><p className="font-medium">{result.brand}</p>
                            
                            {result.set && (
                                <>
                                    <p className="text-muted-foreground">Set:</p>
                                    <p className="font-medium">{result.set}</p>
                                </>
                            )}

                            {result.cardNumber && (
                                <>
                                    <p className="text-muted-foreground">Card #:</p>
                                    <p className="font-medium">
                                        {result.cardNumber.toString().match(/^\d+$/) ? `#${result.cardNumber}` : result.cardNumber}
                                    </p>
                                </>
                            )}
                            <p className="text-muted-foreground">Condition:</p><p className="font-medium">{result.condition}</p>
                            <p className="text-muted-foreground">Grader:</p>
                            <p className="font-medium text-purple-400">{result.grader}</p>

                            {result.parallel && (
                                <>
                                    <p className="text-muted-foreground">Parallel:</p>
                                    <p className="font-medium text-purple-400">{result.parallel}</p>
                                </>
                            )}

                            <p className="text-primary font-bold mt-2">Parsed Price:</p>
                            <p className="text-primary font-bold mt-2">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(result.currentMarketValue)}
                            </p>
                        </div>

                        {result.features && Array.isArray(result.features) && result.features.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-border">
                                <p className="text-xs text-muted-foreground mb-2">Features:</p>
                                <div className="flex flex-wrap gap-1">
                                    {result.features.map((f: string) => (
                                        <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 mt-6">
                            <Button className="flex-1" onClick={handleAddToCollection} disabled={isLoading}>
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                                Add to Collection
                            </Button>
                            <Button variant="outline" onClick={() => setResult(null)} disabled={isLoading}>
                                Cancel
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <AlertDialog open={showFallbackDialog} onOpenChange={setShowFallbackDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <div className="flex items-center gap-2 text-amber-500 mb-2">
                            <AlertCircle className="h-5 w-5" />
                            <AlertDialogTitle>AI Model Overloaded</AlertDialogTitle>
                        </div>
                        <AlertDialogDescription>
                            Gemini 3.1 is currently experiencing extremely high demand and is unavailable. 
                            Would you like to try using the slightly older but more available <strong>Gemini 2.5</strong> model to extract this card's details?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleImport(true)} className="bg-primary">
                            Try Gemini 2.5
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
