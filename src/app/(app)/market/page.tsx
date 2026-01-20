import { PageHeader } from "@/components/page-header";
import { AuctionList } from "@/components/market/auction-list";
import { auctions } from "@/lib/data";

export default function MarketPage() {
  return (
    <>
      <PageHeader
        title="Auction Market"
        description="Track live auctions and analyze your chances with our AI-powered Win Probability predictor."
      />
      <AuctionList initialAuctions={auctions} />
    </>
  );
}
