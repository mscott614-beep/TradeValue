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
import { collection, doc, setDoc, onSnapshot } from "firebase/firestore";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { compressImage } from "@/lib/image-utils";
import { useAccountLimits } from "@/hooks/use-account-limits";
import { AlertCircle } from "lucide-react";
import Link from "next/link";

interface ImageUploaderProps {
  file: File | null;
  preview: string | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  title: string;
  description: string;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
  preview,
  onFileChange,
  onRemoveImage,
  inputRef,
  title,
  description
}) => {
  if (preview) {
    return (
      <div className="relative w-full max-w-sm mx-auto">
        <img
          src={preview}
          alt={`${title} preview`}
          className="rounded-lg object-contain w-full"
        />
        <Button
          variant="destructive"
          size="icon"
          className="absolute -top-4 -right-4 rounded-full h-9 w-9 z-10"
          onClick={onRemoveImage}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-64 border-2 border-dashed border-muted-foreground/50 rounded-lg flex flex-col justify-center items-center text-center text-muted-foreground cursor-pointer hover:bg-muted/50 hover:border-primary transition-colors p-4"
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="h-10 w-10 mb-2" />
      <p className="font-semibold text-foreground">{title}</p>
      <p className="text-sm">{description}</p>
      <Input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/png, image/jpeg, image/webp"
        onChange={onFileChange}
      />
    </div>
  );
};


export function CardScanner() {
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanCardAndAddMetadataOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const frontFileInputRef = useRef<HTMLInputElement>(null);
  const backFileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const firestore = useFirestore();
  const { user } = useUser();
  const { isAnonymous, isLimitReached, portfolioLimit, cardCount } = useAccountLimits();

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<File | null>>,
    previewSetter: React.Dispatch<React.SetStateAction<string | null>>
  ) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setter(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        previewSetter(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
      setResult(null);
    }
  };

  const createRemoveImageHandler = (
    fileSetter: React.Dispatch<React.SetStateAction<File | null>>,
    previewSetter: React.Dispatch<React.SetStateAction<string | null>>,
    inputRef: React.RefObject<HTMLInputElement | null>
  ) => () => {
    fileSetter(null);
    previewSetter(null);
    setResult(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleRemoveFrontImage = createRemoveImageHandler(setFrontFile, setFrontPreview, frontFileInputRef);
  const handleRemoveBackImage = createRemoveImageHandler(setBackFile, setBackPreview, backFileInputRef);

  const canAction = !isLimitReached;

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleScan = async () => {
    if (!frontFile || !user || !firestore) {
      toast({
        title: "Missing requirements",
        description: "Please select an image and ensure you are logged in.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      // Stricter compression to ensure we are well under the 1MB Firestore limit per document
      console.log("Starting image compression...");
      const frontPhotoDataUri = await compressImage(frontFile, 800);
      console.log(`Front Image compressed size: ${Math.round(frontPhotoDataUri.length / 1024)} KB`);
      
      let backPhotoDataUri: string | undefined = undefined;
      if (backFile) {
        backPhotoDataUri = await compressImage(backFile, 800);
        console.log(`Back Image compressed size: ${Math.round(backPhotoDataUri.length / 1024)} KB`);
      }

      // Create a new scan job
      const scanJobsRef = collection(firestore, "scanJobs");
      const jobId = `${user.uid}-${Date.now()}`;
      const jobData = {
        userId: user.uid,
        status: "pending",
        type: "image-scan",
        payload: {
          frontPhotoDataUri,
          backPhotoDataUri: backPhotoDataUri ?? null,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      console.log(`Creating image-scan job ${jobId}. Total payload size estimate: ${Math.round(JSON.stringify(jobData).length / 1024)} KB`);
      const jobDocRef = doc(scanJobsRef, jobId);
      await setDoc(jobDocRef, jobData);
      console.log(`Job ${jobId} created in Firestore successfully.`);

      // Listen for updates
      const unsubscribe = onSnapshot(jobDocRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          if (data.status === "completed") {
            setResult(data.result);
            setIsLoading(false);
            toast({
              title: "Scan Successful",
              description: "AI has identified your card.",
              action: <CheckCircle className="text-green-500" />,
            });
            unsubscribe();
          } else if (data.status === "error") {
            setIsLoading(false);
            toast({
              title: "Scan Failed",
              description: data.error || "AI failed to identify the card.",
              variant: "destructive",
            });
            unsubscribe();
          }
        }
      });

    } catch (error) {
      console.error("AI Scan Error:", error);
      toast({
        title: "Scan Failed",
        description: "Failed to start the scan process. Please try again.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleAddToCollection = async () => {
    if (!result || !user || !firestore) {
      toast({
        title: "Error",
        description: "Cannot add card to collection. Missing data or user not logged in.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      let compressedImageUrl = null;
      if (frontFile) {
        try {
          // Compress the image to fit under Firestore's 1MB limit
          compressedImageUrl = await compressImage(frontFile);
        } catch (error) {
          console.error("Failed to compress image:", error);
          toast({
            title: "Warning",
            description: "Could not compress the image, it will be skipped. The card will still be saved.",
            variant: "destructive"
          })
        }
      }

      const portfoliosCollection = collection(firestore, `users/${user.uid}/portfolios`);

      const cardDataForDb = {
        userId: user.uid,
        cardId: `${result.brand}-${result.cardNumber}-${result.player.replace(/\s+/g, '-')}`,
        title: `${result.year} ${result.brand} ${result.player} #${result.cardNumber}`,
        condition: result.estimatedGrade,
        purchasePrice: 0,
        currentMarketValue: result.estimatedMarketValue || 0,
        dateAdded: new Date().toISOString(),
        ...(compressedImageUrl ? { imageUrl: compressedImageUrl } : {}),
        ...result
      };

      addDocumentNonBlocking(portfoliosCollection, cardDataForDb);

      toast({
        title: "Card Added",
        description: `${cardDataForDb.title} has been added to your collection.`,
        action: <PlusCircle className="text-green-500" />
      });

      handleRemoveFrontImage();
      handleRemoveBackImage();
    } finally {
      setIsLoading(false);
    }
  };

  const handleScanAnother = () => {
    handleRemoveFrontImage();
    handleRemoveBackImage();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ImageUploader
          file={frontFile}
          preview={frontPreview}
          onFileChange={(e) => handleFileChange(e, setFrontFile, setFrontPreview)}
          onRemoveImage={handleRemoveFrontImage}
          inputRef={frontFileInputRef as any}
          title="Card Front"
          description="Upload or drag & drop"
        />
        <ImageUploader
          file={backFile}
          preview={backPreview}
          onFileChange={(e) => handleFileChange(e, setBackFile, setBackPreview)}
          onRemoveImage={handleRemoveBackImage}
          inputRef={backFileInputRef as any}
          title="Card Back (Optional)"
          description="For better accuracy"
        />
      </div>

      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={handleScan}
          disabled={!frontFile || isLoading || !canAction}
          className="w-full max-w-sm"
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <WandSparkles className="mr-2 h-5 w-5" />
          )}
          {isLoading ? "Scanning..." : isLimitReached ? "Limit Reached" : "Scan Card with AI"}
        </Button>
      </div>

      {isLimitReached && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-200">Guest Portfolio Limit Reached</p>
              <p className="text-xs text-slate-400">You've used all {portfolioLimit} card slots available for guests.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/login">Sign Up to Unlock</Link>
          </Button>
        </div>
      )}

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
              <p className="text-muted-foreground">Grader:</p>
              <p className="font-medium text-purple-400">{result.grader}</p>
              <p className="text-primary font-bold">Est. Value:</p>
              <p className="text-primary font-bold">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(result.estimatedMarketValue)}
              </p>
            </div>
            <div className="flex gap-2 mt-6">
              <Button className="flex-1" onClick={handleAddToCollection} disabled={isLimitReached}>
                {isLimitReached ? "Portfolio Full" : "Add to Collection"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleScanAnother}>Scan Another</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
