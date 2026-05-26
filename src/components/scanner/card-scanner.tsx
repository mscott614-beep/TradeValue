"use client";

import { useState, useRef } from "react";
import {
  scanCardAndAddMetadata,
  type ScanCardAndAddMetadataOutput,
} from "@/ai/flows/scan-card-and-add-metadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, WandSparkles, Loader2, CheckCircle, PlusCircle, LayoutGrid, Scan } from "lucide-react";
import Image from "next/image";
import { Card, CardContent } from "../ui/card";
import { useFirestore, useUser } from "@/firebase";
import { collection, doc, setDoc, onSnapshot } from "firebase/firestore";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { compressCardImage, blobToDataUrl } from "@/lib/image-processor";
import { buildCardTitle, buildFullSetName } from "@/lib/card-utils";
import { useAccountLimits } from "@/hooks/use-account-limits";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { BatchProcessor } from "./BatchProcessor";


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
        capture="environment"
        onChange={onFileChange}
      />
    </div>
  );
};


export function CardScanner() {
  const [scanMode, setScanMode] = useState<"single" | "batch">("single");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanCardAndAddMetadataOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);

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

    if (!backFile) {
      toast({
        title: "Back photo recommended",
        description:
          "Year and card number are often on the back. Without it, the scanner may confuse seasons (e.g. 1978-80 vs 1987-88).",
        duration: 8000,
      });
    }

    try {
      // Stricter compression to ensure we are well under the 1MB Firestore limit per document
      console.log("Starting image compression...");
      const frontBlob = await compressCardImage(frontFile);
      const frontPhotoDataUri = await blobToDataUrl(frontBlob);
      console.log(`Front Image compressed size: ${Math.round(frontPhotoDataUri.length / 1024)} KB`);
      
      let backPhotoDataUri: string | undefined = undefined;
      if (backFile) {
        const backBlob = await compressCardImage(backFile);
        backPhotoDataUri = await blobToDataUrl(backBlob);
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
          isSingleScan: true,
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
          setScanStatus(data.status);
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
              description: data.error || "AI failed to identify the card. Try adding a back photo.",
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
    setIsLoading(true);
    try {
      if (!result || !user || !firestore) {
        throw new Error("Missing data or user session. Please ensure you are logged in and the scan is complete.");
      }

      let compressedImageUrl: string | null = null;
      if (frontFile) {
        try {
          // Compress aggressively to fit under Firestore's 1MB doc limit
          const compressedBlob = await compressCardImage(frontFile);
          compressedImageUrl = await blobToDataUrl(compressedBlob);
          const sizeKb = Math.round(compressedImageUrl.length / 1024);
          console.log(`[Scanner] Compressed image size: ${sizeKb} KB`);
        } catch (error) {
          console.error("[Scanner] Failed to compress image:", error);
          // Non-fatal, continue without image
        }
      }

      const portfoliosCollection = collection(firestore, `users/${user.uid}/portfolios`);

      // Defensive data extraction
      const brand = (result.brand || "Unknown").toString();
      const player = (result.player || "Unknown").toString();
      const year = (result.year || "").toString();
      const cleanCardNumber = (result.cardNumber || "").toString().replace('#', '').trim();
      const setName = (result.set || "").toString().trim();
      
      const cardDataForDb: Record<string, any> = {
        userId: user.uid,
        cardId: `${brand}-${cleanCardNumber}-${player.replace(/\s+/g, '-')}`,
        title: buildCardTitle({
          year,
          brand,
          cardNumber: cleanCardNumber,
          player,
          parallel: (result as any).parallel || "",
          serialNumber: (result as any).serialNumber || ""
        }),
        condition: result.estimatedGrade || "Raw",
        purchasePrice: 0,
        currentMarketValue: result.estimatedMarketValue || 0,
        dateAdded: new Date().toISOString(),
        year,
        brand,
        player,
        set: buildFullSetName({ 
          year, 
          brand, 
          subset: setName,
          parallel: (result as any).parallel || ""
        }),
        cardNumber: cleanCardNumber,
        parallel: (result as any).parallel || "",
        serialNumber: (result as any).serialNumber || "",
        estimatedGrade: result.estimatedGrade || "Raw",
        grader: result.grader || "None",
        imageUrl: compressedImageUrl || "",
        conditionAssessment: result.conditionAssessment || null,
      };


      await addDocumentNonBlocking(portfoliosCollection, cardDataForDb);

      toast({
        title: "Card Added",
        description: `${cardDataForDb.title} has been added to your collection.`,
      });

      handleRemoveFrontImage();
      handleRemoveBackImage();
    } catch (error: any) {
      console.error("Failed to add card to collection:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to add card to collection. Please try again.",
        variant: "destructive",
      });
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
      {/* Mode Selector */}
      <div className="flex justify-center mb-2">
        <div className="bg-muted p-1 rounded-lg flex space-x-1 border border-border">
          <Button
            variant={scanMode === "single" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setScanMode("single")}
            className="font-semibold flex items-center space-x-1.5 px-4 py-1 h-8 shadow-sm"
          >
            <Scan className="w-4 h-4 text-primary" />
            <span>Single Scan</span>
          </Button>
          <Button
            variant={scanMode === "batch" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setScanMode("batch")}
            className="font-semibold flex items-center space-x-1.5 px-4 py-1 h-8 shadow-sm"
          >
            <LayoutGrid className="w-4 h-4 text-primary" />
            <span>Batch Scan (Grid)</span>
          </Button>
        </div>
      </div>

      {scanMode === "batch" ? (
        <BatchProcessor />
      ) : (
        <>
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
              title="Card Back (Recommended)"
              description="Card number & year — greatly improves ID accuracy"
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
              {isLoading ? (scanStatus === "processing" ? "Fetching Market Data..." : "Scanning...") : isLimitReached ? "Limit Reached" : "Scan Card with AI"}
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
                <div className="flex flex-col md:flex-row gap-6">
                  {frontPreview && (
                    <div className="shrink-0 mx-auto md:mx-0">
                      <img 
                        src={frontPreview} 
                        alt="Scanned card" 
                        className="rounded-lg object-contain w-[140px] h-[200px] border border-primary/20 shadow-md bg-background"
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-4 text-primary">Scan Results</h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">

                  <p className="text-muted-foreground">Player:</p><p className="font-medium">{result.player}</p>
                  <p className="text-muted-foreground">Year:</p><p className="font-medium">{result.year}</p>
                  <p className="text-muted-foreground">Brand:</p><p className="font-medium">{result.brand}</p>
                  <p className="text-muted-foreground">Set:</p><p className="font-medium">{result.set || 'Base Set'}</p>
                  <p className="text-muted-foreground">Card #:</p>
                  <p className="font-medium">
                    {result.cardNumber?.toString().match(/^\d+$/) ? `#${result.cardNumber}` : result.cardNumber}
                  </p>
                  <p className="text-muted-foreground">Condition:</p><p className="font-medium text-green-400">{result.estimatedGrade}</p>
                  <p className="text-muted-foreground">Grader:</p>
                  <p className="font-medium text-purple-400">
                    {result.grader && result.grader !== "null" ? result.grader : "None"}
                  </p>
                  <p className="text-primary font-bold">Est. Value:</p>
                  <p className="text-primary font-bold">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(result.estimatedMarketValue)}
                  </p>
                  {(result as any).yearCorrectionReason && (
                    <>
                      <p className="text-[10px] text-muted-foreground">Year fix:</p>
                      <p className="text-[10px] text-green-400">{(result as any).yearCorrectionReason}</p>
                    </>
                  )}
                </div>

                {result.conditionAssessment && (
                  <div className="mt-6 border border-primary/20 rounded-xl p-4 bg-background/50">
                    <h4 className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
                      <Scan className="w-4 h-4" />
                      Visual Condition Assessment
                    </h4>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <span className="text-xs text-muted-foreground">Est. Grade Target</span>
                        <span className={`text-xs px-2 py-1 rounded-md font-medium ${
                          (result.conditionAssessment.estimatedGradeTarget.toLowerCase().match(/9|10|mint|gem/)) 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : (result.conditionAssessment.estimatedGradeTarget.toLowerCase().match(/7|8|near/))
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}>
                          {result.conditionAssessment.estimatedGradeTarget}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-start">
                        <span className="text-xs text-muted-foreground">Centering</span>
                        <span className="text-xs font-medium text-right max-w-[180px]">{result.conditionAssessment.centeringRatio}</span>
                      </div>
                      
                      <div className="flex justify-between items-start">
                        <span className="text-xs text-muted-foreground">Confidence</span>
                        <span className="text-xs font-medium">{result.conditionAssessment.conditionConfidenceScore}%</span>
                      </div>
                      
                      {result.conditionAssessment.edgeWearAlerts && result.conditionAssessment.edgeWearAlerts.length > 0 && (
                        <div className="pt-2 border-t border-border/50">
                          <span className="text-xs text-muted-foreground block mb-2">Edge & Surface Alerts:</span>
                          <ul className="list-disc pl-4 space-y-1">
                            {result.conditionAssessment.edgeWearAlerts.map((alert, idx) => (
                              <li key={idx} className="text-xs text-amber-400/80">{alert}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="pt-3 mt-3 border-t border-border/50">
                        <div className="flex gap-2 items-start bg-muted/30 p-3 rounded-lg border border-border/50">
                          <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                          <p className="text-[10px] leading-relaxed text-muted-foreground">
                            <strong>Disclaimer:</strong> All grades provided by this tool are automated AI estimations based on visual image analysis. These metrics are strictly for informational and reference purposes and should not be interpreted as financial advice or legal guarantees of condition. Professional third-party grading services (such as PSA, BGS, or SGC) use specialized physical tools and human evaluation criteria that may yield different grading assessments. TradeValue is not liable for any discrepancies between this estimation and official certifications.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-6">
                  <Button className="flex-1" onClick={handleAddToCollection} disabled={isLoading || isLimitReached}>
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <PlusCircle className="mr-2 h-4 w-4" />
                    )}
                    {isLimitReached ? "Portfolio Full" : "Add to Collection"}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={handleScanAnother} disabled={isLoading}>Scan Another</Button>
                </div>
                </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
