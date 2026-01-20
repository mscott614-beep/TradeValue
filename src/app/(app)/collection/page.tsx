import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { cards } from "@/lib/data";
import Image from "next/image";

export default function CollectionPage() {
  return (
    <>
      <PageHeader
        title="My Collection"
        description="A complete overview of your prized hockey card collection."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {cards.map((card) => (
          <Card key={card.id} className="overflow-hidden transition-all hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-1">
            <CardContent className="p-0">
                <div className="aspect-[4/5.6] bg-muted relative">
                    <Image
                        src={card.imageUrl}
                        alt={card.title}
                        fill
                        className="object-cover"
                        data-ai-hint={card.imageHint}
                    />
                </div>
            </CardContent>
            <CardFooter className="flex-col items-start p-4">
              <p className="font-semibold truncate w-full" title={card.title}>{card.title}</p>
              <p className="text-sm text-muted-foreground">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(card.currentMarketValue)}</p>
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  );
}
