"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Search,
  ScanLine,
  LayoutDashboard,
  Layers,
  TrendingUp,
  Bell,
  ShoppingCart,
  Star,
  CreditCard,
  Lightbulb,
  X,
  ZoomIn,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ─── Feature definitions (from user-guide.md section headers) ────────────────

const features = [
  {
    icon: ScanLine,
    title: "Dynamic Card Ingestion",
    description:
      "Ingest cards via Single Scan, Multi-Card Batch Scan (up to 8 cards in a grid), or bulk CSV upload with AI enhancement.",
    href: "/scanner",
    badge: "Batch Mode",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    infographic: "/infographics/card-scanner-infographic.png",
    infographicAlt: "AI Card Scanner — 3D Clay Style",
  },
  {
    icon: Layers,
    title: "Digital Binder",
    description:
      "Browse your full collection in List or Grid view. Filter, sort, search, and export to CSV.",
    href: "/collection",
    badge: "Collection",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    infographic: "/infographics/digital-binder-infographic.png",
    infographicAlt: "Digital Binder — Card Collection Gallery",
  },
  {
    icon: CreditCard,
    title: "Market Valuation",
    description:
      "Accurate pricing powered by our 4-tier Pricing Waterfall, robust Trimmed Mean calculations, and direct eBay sold matches.",
    href: "/collection",
    badge: "AI Powered",
    color: "text-primary",
    bg: "bg-primary/10",
    infographic: "/infographics/card-details-infographic.png",
    infographicAlt: "Card Details — AI Analysis & ROI",
  },
  {
    icon: LayoutDashboard,
    title: "Portfolio Analytics",
    description:
      "Track asset growth via the Historical Portfolio Equity Chart, view Total P&L, and monitor daily net changes.",
    href: "/dashboard",
    badge: "Production",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    infographic: "/infographics/portfolio-dashboard-infographic.png",
    infographicAlt: "Portfolio Management — Tradevalue Brand Dashboard",
  },
  {
    icon: Star,
    title: "AI Market Insights",
    description:
      "Gemini AI evaluates risk score (1–100), gives Buy/Sell/Hold/Hidden Gem signals, and optimization steps.",
    href: "/dashboard/insights",
    badge: "Gemini AI",
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    infographic: "/infographics/portfolio-insights-infographic.png",
    infographicAlt: "Portfolio Insights — Fintech Dashboard",
  },
  {
    icon: Bell,
    title: "Smart Notifications",
    description:
      "Configure price triggers and run AI market scans to get Rise, Drop, Optimal Sell, and Red Flag alerts.",
    href: "/dashboard/alerts",
    badge: "Alerts",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    infographic: "/infographics/smart-notifications-infographic.png",
    infographicAlt: "Smart Notifications — Price Alerts Dashboard",
  },
  {
    icon: ShoppingCart,
    title: "Market Reports",
    description:
      "Generate the Weekly Market Analyst Report, analyze risk/liquidity segmentation, and view Slab-to-Raw multipliers.",
    href: "/market",
    badge: "Market",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
    infographic: "/infographics/market-hub-infographic.png",
    infographicAlt: "Market Hub — Academic Data Visualization",
  },
  {
    icon: Lightbulb,
    title: "Tips & Best Practices",
    description:
      "Get the most out of TradeValue: set your cost basis, use AI CSV enhancement, and watch the real-time ticker.",
    href: "#faq",
    badge: "Guide",
    color: "text-teal-500",
    bg: "bg-teal-500/10",
    infographic: "/infographics/tips-best-practices-infographic.png",
    infographicAlt: "Tips & Best Practices — Pro Guide",
  },
];


// ─── FAQ data (extracted from user-guide.md content) ─────────────────────────

const faqs = [
  {
    category: "Ingestion & Scanning",
    question: "How do I scan cards into my portfolio?",
    answer:
      "You can use the Single Card Scanner for individual additions, or our new Multi-Card Batch Scan Mode to save time. For Batch Mode, simply upload a 2x2 (4 cards), 3x2 (6 cards), or 4x2 (8 cards) photo grid. Our system automatically segments the images on the client side and passes them concurrently into the geminiProcessingQueue for rapid identification.",
  },
  {
    category: "Ingestion & Scanning",
    question: "Why do I sometimes see a green \"Year fix:\" indicator?",
    answer:
      "Our background normalization engine actively monitors image OCR outputs. If it detects a common OCR date error (for instance, misreading 1999 as 1990), it intelligently overrides the error to protect your market queries. When this happens, a green \"Year fix:\" line displays to let you know the AI corrected the data.",
  },
  {
    category: "Ingestion & Scanning",
    question: "How do I bulk import my card collection?",
    answer:
      "Go to Add Cards → CSV Import tab. Upload your collection CSV. Common headers like \"Item Title\" and \"Purchase Price\" are auto-recognized. Click \"Enhance Rows with AI\" to extract Player, Year, Brand, Condition, and Special Features automatically.",
  },
  {
    category: "Market Valuation",
    question: "How does the advanced valuation engine calculate prices?",
    answer:
      "We use a strict 4-tier Pricing Waterfall to ensure accuracy and protect against market manipulation. First, we look for a High-Fidelity Header Price. Second, we calculate a Trimmed Mean of sold listings, deliberately throwing out extreme statistical outliers. Third, if data volume is exceptionally tight, we drop to a Listing Median Fallback. Finally, as an absolute last resort, the card defaults to an unpriced state requiring manual review.",
  },
  {
    category: "Market Valuation",
    question: "How do I update my purchase price?",
    answer:
      "Open the card's detail page and click the edit ✏️ icon next to Purchase Price. Enter the correct amount and save. Keeping this accurate is essential for correct ROI and Historical Portfolio Equity calculations.",
  },
  {
    category: "Portfolio Analytics",
    question: "How can I track my overall collection value over time?",
    answer:
      "Your dashboard features the Historical Portfolio Equity Chart, which tracks the cumulative net worth of your digital binder. A nightly background sync evaluates your active market values and plots your multi-month asset growth, net changes, and daily gains/losses, similar to a traditional financial portfolio.",
  },
  {
    category: "Portfolio Analytics",
    question: "Where does the Market Ticker get its data?",
    answer:
      "The ticker at the bottom of your screen displays real-time prices and 24-hour value changes pulled directly from our robust valuation engine, comparing your current live value against the previous day’s equity snapshot to show accurate gains or losses.",
  },
  {
    category: "Reports & Insights",
    question: "What is the Weekly Market Analyst Report?",
    answer:
      "Our Weekly Market Analyst Report is an automated newsletter generated by our intelligence engine. It analyzes market velocity alerts, risk and liquidity segmentation (comparing High-Velocity Modern cards against Blue-Chip Registry Assets), and utilizes our Slab-to-Raw Premium Multiplier Matrix to surface alternative asset market trends.",
  },
  {
    category: "Reports & Insights",
    question: "How is the Portfolio Risk Score calculated?",
    answer:
      "The Gemini AI evaluates your collection on four pillars: Diversification, Quality (Graded vs Raw ratio), Liquidity (star players vs commons), and Market Trends (peaking vs undervalued cards). It produces a score from 1–100, where lower is safer.",
  },
  {
    category: "Reports & Insights",
    question: "What do Buy, Sell, Hold, and Hidden Gem mean?",
    answer:
      "These are card-by-card AI signals: Hold = strong long-term outlook, keep it. Sell = low liquidity or declining market, consider exiting. Hidden Gem = undervalued relative to peers, a sleeper pick. Buy = favorable entry point, consider adding more.",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function HelpCenter() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(faqs.map((f) => f.category)));
    return ["All", ...cats];
  }, []);

  const filteredFaqs = useMemo(() => {
    const q = search.toLowerCase();
    return faqs.filter((faq) => {
      const matchesSearch =
        !q ||
        faq.question.toLowerCase().includes(q) ||
        faq.answer.toLowerCase().includes(q) ||
        faq.category.toLowerCase().includes(q);
      const matchesCategory =
        activeCategory === "All" || faq.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [search, activeCategory]);

  return (
    <div className="space-y-10">
      {/* ── Hero ── */}
      <div className="text-center space-y-3 py-6">
        <h1 className="text-3xl font-bold tracking-tight">Help Center</h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-sm">
          Your AI-powered trading card portfolio manager. Find answers, explore
          features, and get the most out of TradeValue.
        </p>
        {/* Search */}
        <div className="relative max-w-md mx-auto mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search the help docs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Features Overview Grid ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Features Overview</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <Card
                key={feat.title}
                className="h-full hover:border-primary/50 hover:shadow-md transition-all group overflow-hidden flex flex-col"
              >
                {/* Infographic thumbnail */}
                {feat.infographic && (
                  <div
                    className="relative w-full h-32 overflow-hidden cursor-zoom-in bg-muted/30"
                    onClick={() =>
                      setLightbox({ src: feat.infographic!, alt: feat.infographicAlt! })
                    }
                  >
                    <Image
                      src={feat.infographic}
                      alt={feat.infographicAlt!}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                    </div>
                  </div>
                )}
                <Link href={feat.href} className="flex-1 flex flex-col">
                  <CardHeader className="pb-3">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center mb-2",
                        feat.bg
                      )}
                    >
                      <Icon className={cn("h-5 w-5", feat.color)} />
                    </div>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold group-hover:text-primary transition-colors">
                        {feat.title}
                      </CardTitle>
                      <Badge variant="secondary" className="text-[10px]">
                        {feat.badge}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-xs leading-relaxed">
                      {feat.description}
                    </CardDescription>
                  </CardContent>
                </Link>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-1 hover:bg-black/80 transition-colors"
            onClick={() => setLightbox(null)}
          >
            <X className="h-6 w-6" />
          </button>
          <div className="relative w-full max-w-4xl aspect-video rounded-lg overflow-hidden shadow-2xl">
            <Image
              src={lightbox.src}
              alt={lightbox.alt}
              fill
              className="object-contain"
            />
          </div>
          <p className="absolute bottom-6 text-white/70 text-sm">{lightbox.alt}</p>
        </div>
      )}

      {/* ── Searchable FAQ ── */}
      <section id="faq" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            Frequently Asked Questions
          </h2>
          {/* Category filter pills */}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "text-xs px-3 py-1 rounded-full border transition-colors",
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {filteredFaqs.length === 0 ? (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No results found for &ldquo;{search}&rdquo;. Try a different
              search term or category.
            </CardContent>
          </Card>
        ) : (
          <Accordion type="multiple" className="space-y-2">
            {filteredFaqs.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="border rounded-lg px-4 bg-card"
              >
                <AccordionTrigger className="text-sm font-medium text-left hover:no-underline py-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {faq.category}
                    </Badge>
                    {faq.question}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground pb-4 leading-relaxed">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </section>

      {/* ── Tips footer ── */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-5 flex items-center gap-3">
          <Lightbulb className="h-5 w-5 text-primary shrink-0" />
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Pro Tip:</span>{" "}
            Always keep your Purchase Price up to date on the Card Details page
            — accurate cost basis powers your ROI, Gain/Loss, and AI Insight
            calculations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
