'use client';

import { useUser, useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { collection } from "firebase/firestore";
import type { Portfolio } from "@/lib/types";

export const PORTFOLIO_LIMIT_ANONYMOUS = 5;
export const SCAN_LIMIT_ANONYMOUS = 3;

export function useAccountLimits() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();

  const portfoliosCollection = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return collection(firestore, `users/${user.uid}/portfolios`);
  }, [firestore, user]);

  const { data: cards, isLoading: isCollectionLoading } = useCollection<Portfolio>(portfoliosCollection);

  const isAnonymous = user?.isAnonymous || false;
  const cardCount = cards?.length || 0;
  
  const canAddCard = !isAnonymous || cardCount < PORTFOLIO_LIMIT_ANONYMOUS;
  
  // For scans, since we don't have a persistent counter yet, 
  // we could either add one or just limit it to the portfolio size for now.
  // Actually, let's just use the portfolio size as the proxy for "what they can do".
  const canScan = !isAnonymous || cardCount < PORTFOLIO_LIMIT_ANONYMOUS;

  return {
    isAnonymous,
    cardCount,
    canAddCard,
    canScan,
    portfolioLimit: isAnonymous ? PORTFOLIO_LIMIT_ANONYMOUS : Infinity,
    isLimitReached: !canAddCard,
    isLoading: isUserLoading || isCollectionLoading
  };
}
