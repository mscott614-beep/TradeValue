"use client";

import { useState, useRef } from "react";
import {
  scanCardAndAddMetadata,
  type ScanCardAndAddMetadataOutput,
} from "@/ai/flows/scan-card-and-add-metadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, WandSparkles, Loader2, CheckCircle, PlusCircle } from "lucide-react";
import Image from "next/image";
import { Card, CardContent } from "../ui/card";
import { useFirestore, useUser } from "@/firebase";
import { collection } from "firebase/firestore";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";

export function CardScanner() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanCardAndAddMetadataOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const firestore = useFirestore();
  const { user } = useUser();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
      setResult(null);
    }
  };

  const handleRemoveImage = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleScan = async () => {
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select an image file to scan.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = async () => {
      const base64data = reader.result as string;
      try {
        const aiResult = await scanCardAndAddMetadata({
          photoDataUri: base64data,
        });
        setResult(aiResult);
        toast({
            title: "Scan Successful",
            description: "AI has identified your card.",
            action: <CheckCircle className="text-green-500"/>
        });
      } catch (error) {
        console.error("AI Scan Error:", error);
        toast({
          title: "Scan Failed",
          description: "The AI could not identify the card. Please try another image.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
     reader.onerror = () => {
        setIsLoading(false);
        toast({
          title: "File Read Error",
          description: "Could not read the selected file.",
          variant: "destructive",
        });
    };
  };

  const handleAddToCollection = () => {
    if (!result || !user || !firestore) {
      toast({
        title: "Error",
        description: "Cannot add card to collection. Missing data or user not logged in.",
        variant: "destructive",
      });
      return;
    }

    const portfoliosCollection = collection(firestore, `users/${user.uid}/portfolios`);
    
    const cardDataForDb = {
        userId: user.uid,
        cardId: `${result.brand}-${result.cardNumber}-${result.player.replace(/\s+/g, '-')}`,
        title: `${result.year} ${result.brand} ${result.player} #${result.cardNumber}`,
        condition: result.estimatedGrade,
        purchasePrice: 0,
        currentMarketValue: 0,
        dateAdded: new Date().toISOString(),
        imageUrl: preview,
        ...result
    };

    addDocumentNonBlocking(portfoliosCollection, cardDataForDb);
    
    toast({
      title: "Card Added",
      description: `${cardDataForDb.title} has been added to your collection.`,
      action: <PlusCircle className="text-green-500" />
    });

    handleRemoveImage();
  };

  return (
    <div className="space-y-6">
      {!preview ? (
        <div
          className="relative w-full h-64 border-2 border-dashed border-muted-foreground/50 rounded-lg flex flex-col justify-center items-center text-muted-foreground cursor-pointer hover:bg-muted/50 hover:border-primary transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-12 w-12 mb-2" />
          <p className="font-semibold">Click to upload or drag & drop</p>
          <p className="text-sm">PNG, JPG, or WEBP (max 5MB)</p>
          <Input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png, image/jpeg, image/webp"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="relative w-full max-w-sm mx-auto">
          <Image
            src={preview}
            alt="Card preview"
            width={400}
            height={560}
            className="rounded-lg object-contain"
          />
          <Button
            variant="destructive"
            size="icon"
            className="absolute -top-4 -right-4 rounded-full h-9 w-9"
            onClick={handleRemoveImage}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      )}

      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={handleScan}
          disabled={!file || isLoading}
          className="w-full max-w-sm"
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <WandSparkles className="mr-2 h-5 w-5" />
          )}
          {isLoading ? "Scanning..." : "Scan Card with AI"}
        </Button>
      </div>

      {result && (
        <Card className="bg-muted/50">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4 text-primary">Scan Results</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <p className="text-muted-foreground">Player:</p><p className="font-medium">{result.player}</p>
                <p className="text-muted-foreground">Year:</p><p className="font-medium">{result.year}</p>
                <p className="text-muted-foreground">Brand:</p><p className="font-medium">{result.brand}</p>
                <p className="text-muted-foreground">Card #:</p><p className="font-medium">{result.cardNumber}</p>
                <p className="text-muted-foreground">Est. Grade:</p><p className="font-medium">{result.estimatedGrade}</p>
            </div>
             <div className="flex gap-2 mt-6">
                <Button className="flex-1" onClick={handleAddToCollection}>Add to Collection</Button>
                <Button variant="outline" className="flex-1" onClick={handleRemoveImage}>Scan Another</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
