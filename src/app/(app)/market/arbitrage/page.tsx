"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ArbitrageDashboard } from "@/components/market/arbitrage-dashboard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scale } from "lucide-react";

export default function MarketArbitragePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title="Market Arbitrage"
          description="Slab-to-raw spread alerts from live eBay comps vs PSA 10 registry valuations."
          className="mb-0"
        />
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" asChild>
            <Link href="/market">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Market Hub
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/market/compare">
              <Scale className="mr-2 h-4 w-4" />
              Compare
            </Link>
          </Button>
        </div>
      </div>
      <ArbitrageDashboard />
    </div>
  );
}
