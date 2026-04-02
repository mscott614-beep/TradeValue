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

export function EbayUrlImport() {
    const [url, setUrl] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<any>(null); // Uses the extracted Portfolio object

    const { toast } = useToast();
    const firestore = useFirestore();
    const { user } = useUser();

    const handleImport = async () => {
        if (!url) return;

        setIsLoading(true);
        setResult(null);

        try {
            const response = await extractEbayListingAction(url);

            if (response.success && response.data) {
                setResult(response.data);
                toast({
                    title: "Import Successful",
                    description: "Card details extracted from eBay.",
                    action: <CheckCircle className="text-green-500" />,
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
        if (!result || !user || !firestore) return;

        setIsLoading(true);
        try {
            const portfoliosCollection = collection(firestore, `users/${user.uid}/portfolios`);

            const cardDataForDb = {
                userId: user.uid,
                cardId: `ebay-${Date.now()}`,
                title: `${result.year} ${result.brand} ${result.player}`,
                condition: result.condition,
                purchasePrice: result.currentMarketValue || 0, // Assume purchase price is what it sold/listed for if imported
                currentMarketValue: result.currentMarketValue || 0,
                dateAdded: new Date().toISOString(),
                ...result
            };

            addDocumentNonBlocking(portfoliosCollection, cardDataForDb);

            toast({
                title: "Card Added",
                description: `${cardDataForDb.title} has been added to your collection.`,
                action: <PlusCircle className="text-green-500" />
            });

            // Reset
            setUrl("");
            setResult(null);
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
                <Button onClick={handleImport} disabled={!url || isLoading} className="h-10">
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
                            <p className="text-muted-foreground">Brand/Set:</p><p className="font-medium">{result.brand}</p>
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
        </div>
    );
}
