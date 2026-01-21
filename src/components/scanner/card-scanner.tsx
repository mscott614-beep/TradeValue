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
        <Image
          src={preview}
          alt={`${title} preview`}
          width={400}
          height={560}
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
    inputRef: React.RefObject<HTMLInputElement>
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

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
  };

  const handleScan = async () => {
    if (!frontFile) {
        toast({
            title: "No front image selected",
            description: "Please select an image of the card front.",
            variant: "destructive",
        });
        return;
    }

    setIsLoading(true);
    setResult(null);

    try {
        const frontPhotoDataUri = await readFileAsDataURL(frontFile);
        let backPhotoDataUri: string | undefined = undefined;
        if (backFile) {
            backPhotoDataUri = await readFileAsDataURL(backFile);
        }

        const aiResult = await scanCardAndAddMetadata({
            frontPhotoDataUri,
            backPhotoDataUri,
        });

        setResult(aiResult);
        toast({
            title: "Scan Successful",
            description: "AI has identified your card.",
            action: <CheckCircle className="text-green-500" />,
        });
    } catch (error) {
        console.error("AI Scan or File Read Error:", error);
        toast({
            title: "Scan Failed",
            description: "Could not read the file or the AI failed to identify the card. Please try another image.",
            variant: "destructive",
        });
    } finally {
        setIsLoading(false);
    }
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
        imageUrl: frontPreview,
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
          inputRef={frontFileInputRef}
          title="Card Front"
          description="Upload or drag & drop"
        />
        <ImageUploader 
          file={backFile}
          preview={backPreview}
          onFileChange={(e) => handleFileChange(e, setBackFile, setBackPreview)}
          onRemoveImage={handleRemoveBackImage}
          inputRef={backFileInputRef}
          title="Card Back (Optional)"
          description="For better accuracy"
        />
      </div>

      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={handleScan}
          disabled={!frontFile || isLoading}
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
                <Button variant="outline" className="flex-1" onClick={handleScanAnother}>Scan Another</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
