"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { 
  Upload, 
  X, 
  WandSparkles, 
  Loader2, 
  CheckCircle, 
  PlusCircle, 
  Grid3X3, 
  AlertCircle,
  Sparkles
} from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { useFirestore, useUser } from "@/firebase";
import { collection, doc, setDoc, onSnapshot, writeBatch } from "firebase/firestore";
import { compressImage } from "@/lib/image-utils";
import { buildCardTitle, buildFullSetName } from "@/lib/card-utils";
import { useAccountLimits } from "@/hooks/use-account-limits";

interface GridSlot {
  id: number;
  row: number;
  col: number;
  dataUrl: string | null;
  status: "idle" | "pending" | "queued" | "processing" | "completed" | "error";
  jobId: string | null;
  result: any | null;
  errorMsg: string | null;
}

export function BatchProcessor() {
  const [gridSize, setGridSize] = useState<"2x2" | "3x2" | "4x2">("2x2");
  const [gridImage, setGridImage] = useState<File | null>(null);
  const [gridPreview, setGridPreview] = useState<string | null>(null);
  const [slots, setSlots] = useState<GridSlot[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [batchYearOverride, setBatchYearOverride] = useState<string>("");
  const [userHasEditedOverride, setUserHasEditedOverride] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { toast } = useToast();
  const firestore = useFirestore();
  const { user } = useUser();
  const { isLimitReached, portfolioLimit } = useAccountLimits();

  // Resolve grid dimensions
  const getGridConfig = () => {
    switch (gridSize) {
      case "2x2": return { rows: 2, cols: 2 };
      case "3x2": return { rows: 2, cols: 3 };
      case "4x2": return { rows: 2, cols: 4 };
    }
  };

  const { rows, cols } = getGridConfig();

  // Create slot array when gridSize or gridPreview changes
  useEffect(() => {
    const nextSlots: GridSlot[] = [];
    let id = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        nextSlots.push({
          id: id++,
          row: r,
          col: c,
          dataUrl: null,
          status: "idle",
          jobId: null,
          result: null,
          errorMsg: null,
        });
      }
    }
    setSlots(nextSlots);
  }, [gridSize, gridPreview, rows, cols]);

  // Automatically detect and propose/fill the majority year among scanned cards
  useEffect(() => {
    if (userHasEditedOverride) return;

    const completedYears = slots
      .filter(s => s.status === "completed" && s.result?.year)
      .map(s => s.result.year.toString().trim());

    if (completedYears.length > 0) {
      // Find frequency of each year
      const frequencies: Record<string, number> = {};
      completedYears.forEach(y => {
        frequencies[y] = (frequencies[y] || 0) + 1;
      });

      // Find majority/mode year
      let maxYear = "";
      let maxCount = 0;
      Object.entries(frequencies).forEach(([y, count]) => {
        if (count > maxCount) {
          maxCount = count;
          maxYear = y;
        }
      });

      if (maxYear && maxCount >= Math.ceil(completedYears.length / 2)) {
        setBatchYearOverride(maxYear);
      }
    }
  }, [slots, userHasEditedOverride]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setGridImage(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        setGridPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const handleRemoveImage = () => {
    setGridImage(null);
    setGridPreview(null);
    setSlots([]);
    setIsProcessing(false);
    setBatchYearOverride("");
    setUserHasEditedOverride(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Slice image into equal-ratio cells using client-side canvas
  const sliceAndScan = async () => {
    if (!gridPreview || !imageRef.current || !firestore || !user) return;

    setIsProcessing(true);

    const img = imageRef.current;
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    const cellWidth = naturalWidth / cols;
    const cellHeight = naturalHeight / rows;

    const updatedSlots = [...slots];

    // 1. Slice image elements on canvas
    for (let i = 0; i < updatedSlots.length; i++) {
      const slot = updatedSlots[i];
      
      // Calculate target dimensions scaling down to max 800px width
      const maxCropWidth = 800;
      let targetWidth = cellWidth;
      let targetHeight = cellHeight;
      if (cellWidth > maxCropWidth) {
        const scale = maxCropWidth / cellWidth;
        targetWidth = maxCropWidth;
        targetHeight = cellHeight * scale;
      }

      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = targetWidth;
      cropCanvas.height = targetHeight;
      const ctx = cropCanvas.getContext("2d");

      if (!ctx) {
        toast({
          title: "Canvas Error",
          description: "Could not initialize canvas rendering.",
          variant: "destructive",
        });
        setIsProcessing(false);
        return;
      }

      // Draw segment of source image onto scaled-down crop canvas
      ctx.drawImage(
        img,
        slot.col * cellWidth,
        slot.row * cellHeight,
        cellWidth,
        cellHeight,
        0,
        0,
        targetWidth,
        targetHeight
      );

      // Compress to dataURL format
      const dataUrl = cropCanvas.toDataURL("image/jpeg", 0.85);
      slot.dataUrl = dataUrl;
      slot.status = "queued";
    }

    setSlots(updatedSlots);

    // 2. Perform throttled ingestion loop (concurrency = 2)
    const activeJobs = new Set<Promise<void>>();
    const pool = [...updatedSlots];

    // Worker function that executes single slot scan
    const runScanJob = async (slotIndex: number) => {
      const slot = updatedSlots[slotIndex];
      if (!slot.dataUrl) return;

      setSlots(prev => prev.map((s, idx) => idx === slotIndex ? { ...s, status: "pending" } : s));

      const jobId = `${user.uid}-${Date.now()}-${slotIndex}`;
      const jobData = {
        userId: user.uid,
        status: "pending",
        type: "image-scan",
        payload: {
          frontPhotoDataUri: slot.dataUrl,
          backPhotoDataUri: null,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        const scanJobsRef = collection(firestore, "scanJobs");
        const docRef = doc(scanJobsRef, jobId);
        
        await setDoc(docRef, jobData);
        
        setSlots(prev => prev.map((s, idx) => idx === slotIndex ? { ...s, jobId, status: "queued" } : s));

        // Setup individual live Firestore listener
        await new Promise<void>((resolve, reject) => {
          const unsubscribe = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
              const data = snap.data();
              if (data) {
                setSlots(prev => prev.map((s, idx) => idx === slotIndex ? { ...s, status: data.status } : s));

                if (data.status === "completed") {
                  setSlots(prev => prev.map((s, idx) => idx === slotIndex ? { 
                    ...s, 
                    status: "completed", 
                    result: data.result,
                    errorMsg: null 
                  } : s));
                  unsubscribe();
                  resolve();
                } else if (data.status === "error") {
                  setSlots(prev => prev.map((s, idx) => idx === slotIndex ? { 
                    ...s, 
                    status: "error", 
                    errorMsg: data.error || "Vision identification failed." 
                  } : s));
                  unsubscribe();
                  resolve(); // resolve normally so the queue sequence doesn't crash completely
                }
              }
            }
          }, (err) => {
            console.error("Firestore snapshot error:", err);
            unsubscribe();
            reject(err);
          });
        });

      } catch (error: any) {
        console.error("Batch Job Trigger Failed for Slot:", slotIndex, error);
        setSlots(prev => prev.map((s, idx) => idx === slotIndex ? { 
          ...s, 
          status: "error", 
          errorMsg: error.message || "Failed to initiate scan." 
        } : s));
      }
    };

    // Sequential/parallel scheduler loop maintaining max 2 concurrent jobs
    for (let i = 0; i < pool.length; i++) {
      if (activeJobs.size >= 2) {
        // Wait for at least one active job to complete
        await Promise.race(activeJobs);
      }

      const p = runScanJob(i).finally(() => {
        activeJobs.delete(p);
      });
      activeJobs.add(p);
    }

    // Wait for all remaining jobs in pool to complete
    await Promise.all(Array.from(activeJobs));
    setIsProcessing(false);

    toast({
      title: "Batch Scan Completed",
      description: "Finished processing all segmented cards.",
    });
  };

  // Perform Firestore Batch Write transaction
  const handleAddAllToCollection = async () => {
    if (!firestore || !user || slots.length === 0) return;

    setIsSaving(true);
    document.body.style.pointerEvents = 'none';

    try {
      const batch = writeBatch(firestore);
      const portfoliosCollection = collection(firestore, `users/${user.uid}/portfolios`);
      let additionCount = 0;

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.status === "completed" && slot.result && slot.dataUrl) {
          const result = slot.result;

          // Aggressive image compression for each slot element before uploading
          let compressedImageUrl = "";
          try {
            // Convert dataurl back to file or compress directly via dummy canvas / compressImage utility
            const blob = await fetch(slot.dataUrl).then(res => res.blob());
            const file = new File([blob], `cropped-card-${i}.jpg`, { type: "image/jpeg" });
            compressedImageUrl = await compressImage(file, 400);

            // Double check safe dimensions
            if (compressedImageUrl.length > 700 * 1024) {
              compressedImageUrl = await compressImage(file, 250);
            }
          } catch (compressErr) {
            console.error("Cropped image compression error:", compressErr);
            compressedImageUrl = slot.dataUrl; // fallback
          }

          const brand = (result.brand || "Unknown").toString();
          const player = (result.player || "Unknown").toString();
          const year = (batchYearOverride || result.year || "").toString();
          const cleanCardNumber = (result.cardNumber || "").toString().replace('#', '').trim();
          const setName = (result.set || "").toString().trim();

          const cardDocRef = doc(portfoliosCollection);
          const cardDataForDb: Record<string, any> = {
            userId: user.uid,
            cardId: `${brand}-${cleanCardNumber}-${player.replace(/\s+/g, '-')}-${Date.now()}-${i}`,
            title: buildCardTitle({
              year,
              brand,
              cardNumber: cleanCardNumber,
              player,
              parallel: result.parallel || "",
              serialNumber: result.serialNumber || ""
            }),
            condition: result.estimatedGrade || "Raw",
            purchasePrice: 0,
            currentMarketValue: result.estimatedMarketValue || 0.99,
            dateAdded: new Date().toISOString(),
            year,
            brand,
            player,
            set: buildFullSetName({ 
              year, 
              brand, 
              subset: setName,
              parallel: result.parallel || ""
            }),
            cardNumber: cleanCardNumber,
            parallel: result.parallel || "",
            serialNumber: result.serialNumber || "",
            estimatedGrade: result.estimatedGrade || "Raw",
            grader: result.grader || "None",
            imageUrl: compressedImageUrl,
          };

          batch.set(cardDocRef, cardDataForDb);
          additionCount++;
        }
      }

      if (additionCount > 0) {
        await batch.commit();
        toast({
          title: "Batch Addition Complete",
          description: `Successfully added ${additionCount} cards to your portfolio.`,
          action: <CheckCircle className="text-green-500" />,
        });
        handleRemoveImage();
      } else {
        toast({
          title: "No Cards Added",
          description: "There were no successfully identified cards to add.",
          variant: "destructive"
        });
      }

    } catch (error: any) {
      console.error("Batch Add To Collection Error:", error);
      toast({
        title: "Batch Add Failed",
        description: error.message || "Failed to commit cards to portfolio.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
      document.body.style.pointerEvents = 'auto';
    }
  };

  const hasSuccessfulScans = slots.some(s => s.status === "completed" && s.result);

  return (
    <div className="space-y-6">
      {/* Configuration Header */}
      {!gridPreview && (
        <div className="flex flex-col items-center justify-center p-6 bg-muted/40 border border-border rounded-xl max-w-md mx-auto space-y-4">
          <div className="flex items-center space-x-2 text-primary font-bold">
            <Grid3X3 className="h-6 w-6" />
            <span>Select Grid Template</span>
          </div>
          <div className="grid grid-cols-3 gap-2 w-full">
            {(["2x2", "3x2", "4x2"] as const).map((size) => (
              <Button
                key={size}
                variant={gridSize === size ? "default" : "outline"}
                className="w-full text-sm font-semibold"
                onClick={() => setGridSize(size)}
              >
                {size === "2x2" ? "2x2 (4 Cards)" : size === "3x2" ? "3x2 (6 Cards)" : "4x2 (8 Cards)"}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Grid Image Uploader */}
      {!gridPreview ? (
        <div
          className="relative w-full h-80 border-2 border-dashed border-muted-foreground/40 rounded-xl flex flex-col justify-center items-center text-center cursor-pointer hover:bg-muted/30 hover:border-primary transition-all p-6"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-12 w-12 text-primary/80 mb-4 animate-pulse" />
          <p className="font-semibold text-lg text-foreground">Upload Batch Grid Image</p>
          <p className="text-sm text-muted-foreground max-w-sm mt-1">
            Capture a single photo containing a grid layout of your trading cards. Supports png, jpeg, webp.
          </p>
          <Input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png, image/jpeg, image/webp"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Preview and Canvas segmenter */}
          <div className="relative max-w-2xl mx-auto border border-border rounded-xl overflow-hidden shadow-lg bg-background">
            <img
              ref={imageRef}
              src={gridPreview}
              alt="Batch source preview"
              className="w-full object-contain max-h-[500px]"
            />
            
            {/* Absolute SVG overlay showing split coordinates */}
            <svg 
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ mixBlendMode: "difference" }}
            >
              {/* Columns partition lines */}
              {Array.from({ length: cols - 1 }).map((_, i) => {
                const percent = ((i + 1) / cols) * 100;
                return (
                  <line
                    key={`col-${i}`}
                    x1={`${percent}%`}
                    y1="0%"
                    x2={`${percent}%`}
                    y2="100%"
                    stroke="#22c55e"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                );
              })}
              {/* Rows partition lines */}
              {Array.from({ length: rows - 1 }).map((_, i) => {
                const percent = ((i + 1) / rows) * 100;
                return (
                  <line
                    key={`row-${i}`}
                    x1="0%"
                    y1={`${percent}%`}
                    x2="100%"
                    y2={`${percent}%`}
                    stroke="#22c55e"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                );
              })}
            </svg>

            {/* Remove button */}
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-4 right-4 rounded-full h-10 w-10 z-20 shadow-md"
              disabled={isProcessing}
              onClick={handleRemoveImage}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Slicing Actions */}
          <div className="flex justify-center gap-4">
            <Button
              size="lg"
              className="w-full max-w-xs font-bold text-md shadow-md"
              disabled={isProcessing || !gridPreview || isLimitReached}
              onClick={sliceAndScan}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <WandSparkles className="mr-2 h-5 w-5" />
                  Slice & Scan Batch
                </>
              )}
            </Button>
          </div>

          {isLimitReached && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center justify-between max-w-2xl mx-auto">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-red-400" />
                <div>
                  <p className="text-sm font-medium text-red-200">Guest Portfolio Limit Reached</p>
                  <p className="text-xs text-slate-400">You have already reached the guest limit of {portfolioLimit} cards.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grid Results display */}
      {slots.some(s => s.dataUrl) && (
        <div className="space-y-6">
          <div className="flex justify-between items-center border-b border-border pb-4">
            <h3 className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span>Segmented Batch Positions ({slots.length})</span>
            </h3>
            {hasSuccessfulScans && (
              <Button 
                onClick={handleAddAllToCollection} 
                disabled={isSaving || isProcessing}
                className="shadow-md font-bold px-6 bg-green-600 hover:bg-green-700"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding Cards...
                  </>
                ) : isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning Grid ({slots.filter(s => s.status === "completed" || s.status === "error").length}/{slots.length})...
                  </>
                ) : (
                  <>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add All to Collection ({slots.filter(s => s.status === "completed" && s.result).length})
                  </>
                )}
              </Button>
            )}
          </div>

          {hasSuccessfulScans && (
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-center p-4 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 backdrop-blur-md shadow-inner animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex items-center gap-3">
                <div className="bg-primary/20 p-2 rounded-lg text-primary animate-pulse">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">Set Standardization</h4>
                  <p className="text-[11px] text-muted-foreground">Unify the release year of all scanned cards automatically or manually</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-muted/40 p-1.5 rounded-lg border border-border">
                <span className="text-xs font-semibold px-2 text-foreground">Release Year:</span>
                <Input
                  type="text"
                  placeholder="e.g. 1969"
                  className="w-24 h-8 text-center text-xs font-mono font-bold bg-background border-primary/30 focus:border-primary rounded"
                  value={batchYearOverride}
                  onChange={(e) => {
                    setBatchYearOverride(e.target.value);
                    setUserHasEditedOverride(true);
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {slots.map((slot) => {
              const isIdle = slot.status === "idle";
              const isSearching = ["pending", "queued", "processing"].includes(slot.status);
              const isCompleted = slot.status === "completed" && slot.result;
              const isError = slot.status === "error";

              return (
                <Card 
                  key={slot.id} 
                  className={`overflow-hidden border transition-all ${
                    isCompleted ? "border-green-500/40 bg-green-500/5 shadow-sm" : 
                    isError ? "border-red-500/30 bg-red-500/5" : "border-border"
                  }`}
                >
                  {/* Cropped Preview Header */}
                  {slot.dataUrl && (
                    <div className="relative h-40 bg-muted/40 flex justify-center items-center border-b border-border overflow-hidden">
                      <img
                        src={slot.dataUrl}
                        alt={`Slot ${slot.id + 1} cropped preview`}
                        className="h-full object-contain"
                      />
                      <div className="absolute top-2 left-2 bg-background/80 backdrop-blur-sm border border-border px-2 py-0.5 rounded text-[10px] font-bold">
                        Slot {slot.id + 1}
                      </div>

                      {/* Floating status badges */}
                      {isSearching && (
                        <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] flex flex-col justify-center items-center gap-2">
                          <Loader2 className="h-6 w-6 text-primary animate-spin" />
                          <span className="text-xs font-bold text-foreground">
                            {slot.status === "processing" ? "Analyzing Market Data..." : "In Queue..."}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <CardContent className="p-4 space-y-4">
                    {/* Idle state */}
                    {isIdle && (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        Ready to scan
                      </div>
                    )}

                    {/* Queued/Processing state (Skeleton loading simulation) */}
                    {isSearching && (
                      <div className="space-y-2.5 animate-pulse">
                        <div className="h-4 bg-muted-foreground/20 rounded w-3/4"></div>
                        <div className="h-3 bg-muted-foreground/20 rounded w-1/2"></div>
                        <div className="h-3 bg-muted-foreground/20 rounded w-2/3"></div>
                        <div className="h-3 bg-muted-foreground/20 rounded w-1/3"></div>
                      </div>
                    )}

                    {/* Error state */}
                    {isError && (
                      <div className="space-y-2 text-center py-4">
                        <AlertCircle className="h-8 w-8 text-red-500 mx-auto" />
                        <h4 className="text-sm font-semibold text-red-400">Scan Failed</h4>
                        <p className="text-[11px] text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                          {slot.errorMsg || "Vision system failed to analyze this sector."}
                        </p>
                      </div>
                    )}

                    {/* Completed identified metadata display */}
                    {isCompleted && (
                      <div className="text-xs space-y-2">
                        {/* Player name */}
                        <div className="font-bold text-sm text-primary truncate">
                          {slot.result.player}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px]">
                          <span className="text-muted-foreground">Year:</span>
                          <span className="font-medium text-foreground">
                            {batchYearOverride && slot.result.year !== batchYearOverride ? (
                              <span className="text-amber-400 font-bold flex items-center gap-1">
                                {batchYearOverride}
                                <span className="text-[10px] text-muted-foreground font-normal line-through">
                                  ({slot.result.year})
                                </span>
                              </span>
                            ) : (
                              slot.result.year
                            )}
                          </span>

                          <span className="text-muted-foreground">Brand:</span>
                          <span className="font-medium text-foreground">{slot.result.brand}</span>

                          <span className="text-muted-foreground">Set:</span>
                          <span className="font-medium text-foreground truncate">{slot.result.set || "Base"}</span>

                          <span className="text-muted-foreground">Card #:</span>
                          <span className="font-medium text-foreground">
                            {slot.result.cardNumber?.toString().match(/^\d+$/) ? `#${slot.result.cardNumber}` : slot.result.cardNumber}
                          </span>

                          <span className="text-muted-foreground">Condition:</span>
                          <span className="font-semibold text-green-400">
                            {slot.result.conditionAssessment || slot.result.estimatedGrade || "Raw"}
                          </span>

                          <span className="text-muted-foreground">Grader:</span>
                          <span className="font-medium text-purple-400">{slot.result.grader || "None"}</span>

                          <span className="text-primary font-bold text-[12px]">Est. Value:</span>
                          <span className="text-primary font-bold text-[12px] font-mono">
                            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(slot.result.estimatedMarketValue || 0.99)}
                          </span>
                        </div>

                        {/* Extra OCR / Year Correction debug output */}
                        {slot.result.yearCorrectionReason && (
                          <div className="border-t border-green-500/10 pt-1.5 mt-1.5 flex flex-col gap-0.5 text-[10px]">
                            <span className="text-muted-foreground">Year fix:</span>
                            <span className="text-green-400 italic leading-snug">{slot.result.yearCorrectionReason}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
