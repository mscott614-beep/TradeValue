import { PageHeader } from "@/components/page-header";
import { CardScanner } from "@/components/scanner/card-scanner";
import { EbayUrlImport } from "@/components/scanner/ebay-url-import";
import { CsvImport } from "@/components/scanner/csv-import";
import { ScanLine, Link as LinkIcon, Lightbulb, FileSpreadsheet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ScannerPage() {
  return (
    <>
      <PageHeader
        title="Add to Collection"
        description="Add trading cards via AI scanning, eBay URL, or CSV bulk import."
      />
      <div className="max-w-4xl mx-auto space-y-6">
        <Alert className="bg-primary/5 border-primary/20">
          <Lightbulb className="h-4 w-4 text-primary" />
          <AlertTitle className="text-primary font-bold">Pro-Tip</AlertTitle>
          <AlertDescription>
            For image scanning, use a dark background in natural light. For URL imports, ensure the eBay listing is active and contains the full card details in the title or description.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="scan" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="scan"><ScanLine className="w-4 h-4 mr-2" /> Camera Scan</TabsTrigger>
            <TabsTrigger value="url"><LinkIcon className="w-4 h-4 mr-2" /> URL Import</TabsTrigger>
            <TabsTrigger value="csv"><FileSpreadsheet className="w-4 h-4 mr-2" /> CSV Import</TabsTrigger>
          </TabsList>

          <TabsContent value="scan">
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto bg-primary/10 text-primary p-3 rounded-full w-fit">
                  <ScanLine className="h-8 w-8" />
                </div>
                <CardTitle>Scan Your Card</CardTitle>
                <CardDescription>
                  Upload front and back photos of your card for AI identification.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CardScanner />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="url">
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto bg-primary/10 text-primary p-3 rounded-full w-fit">
                  <LinkIcon className="h-8 w-8" />
                </div>
                <CardTitle>Import from eBay</CardTitle>
                <CardDescription>
                  Paste the URL of an active eBay listing to instantly extract the card details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EbayUrlImport />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="csv">
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto bg-primary/10 text-primary p-3 rounded-full w-fit">
                  <FileSpreadsheet className="h-8 w-8" />
                </div>
                <CardTitle>Bulk CSV Import</CardTitle>
                <CardDescription>
                  Upload a CSV file from eBay or your own spreadsheet to bulk-add cards.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CsvImport />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
    </>
  );
}
