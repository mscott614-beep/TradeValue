'use client';

import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase";
import Image from "next/image";
import { collection } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import type { Portfolio } from "@/lib/types";

export default function CollectionPage() {
  const firestore = useFirestore();
  const { user } = useUser();

  const portfoliosCollection = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return collection(firestore, `users/${user.uid}/portfolios`);
  }, [firestore, user]);

  const { data: cards, isLoading } = useCollection<Portfolio>(portfoliosCollection);

  return (
    <>
      <PageHeader
        title="My Collection"
        description="A complete overview of your prized trading card collection."
      />
      {isLoading && <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}
      {!isLoading && cards && (
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
                          data-ai-hint="trading card"
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
      )}
      {!isLoading && (!cards || cards.length === 0) && (
        <div className="text-center py-12 text-muted-foreground">
          <h3 className="text-lg font-semibold">Your collection is empty.</h3>
          <p>Start by scanning a card on the Scanner page!</p>
        </div>
      )}
    </>
  );
}
