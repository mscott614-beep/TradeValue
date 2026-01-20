import { PageHeader } from "@/components/page-header";
import { CardScanner } from "@/components/scanner/card-scanner";
import { ScanLine } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ScannerPage() {
  return (
    <>
      <PageHeader
        title="AI Card Scanner"
        description="Upload an image of your hockey card. Our AI will identify it and add it to your collection."
      />
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto bg-primary/10 text-primary p-3 rounded-full w-fit">
              <ScanLine className="h-8 w-8" />
            </div>
            <CardTitle>Scan Your Card</CardTitle>
            <CardDescription>
              For best results, use a clear image with a neutral background.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CardScanner />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
