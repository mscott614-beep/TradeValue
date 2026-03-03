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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lightbulb } from "lucide-react";

export default function ScannerPage() {
  return (
    <>
      <PageHeader
        title="AI Card Scanner"
        description="Upload an image of your trading card. Our AI will identify it and add it to your collection."
      />
      <div className="max-w-4xl mx-auto space-y-6">
        <Alert className="bg-primary/5 border-primary/20">
          <Lightbulb className="h-4 w-4 text-primary" />
          <AlertTitle className="text-primary font-bold">Pro-Tip</AlertTitle>
          <AlertDescription>
            For the most accurate valuation: Take the card out of its protective sleeve and photograph it against a dark, flat background in natural light.
          </AlertDescription>
        </Alert>
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
