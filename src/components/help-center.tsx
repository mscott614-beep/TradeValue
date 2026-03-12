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
    title: "Add Cards",
    description:
      "Add cards via AI Camera Scan, eBay URL import, or bulk CSV upload with AI title enhancement.",
    href: "/scanner",
    badge: "3 Methods",
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
    title: "Card Details",
    description:
      "Deep-dive into any card: edit attributes, run AI Analysis, check grading ROI, and view price history.",
    href: "/collection",
    badge: "AI Powered",
    color: "text-primary",
    bg: "bg-primary/10",
    infographic: "/infographics/card-details-infographic.png",
    infographicAlt: "Card Details — AI Analysis & ROI",
  },
  {
    icon: LayoutDashboard,
    title: "Portfolio Dashboard",
    description:
      "6-month value chart, Total P&L, Raw vs. Graded breakdown, and your top daily performers.",
    href: "/dashboard",
    badge: "Real-time",
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
    title: "Market Hub",
    description:
      "Browse live auctions, generate weekly AI market reports, and compare two cards side-by-side.",
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
      "Get the most out of TradeValue: set your cost basis, use AI CSV enhancement, and run monthly insights.",
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
    category: "Adding Cards",
    question: "What's the best way to add a single graded card?",
    answer:
      "Use Camera Scan on the Add Cards page. Upload a photo of the front (and optionally the back) and the AI will read the slab label, identify the player, year, brand, and grading company, then estimate current market value. Place the card on a dark, non-reflective surface in natural light for best results.",
  },
  {
    category: "Adding Cards",
    question: "How do I bulk import my eBay sold listings?",
    answer:
      "Go to Add Cards → CSV Import tab. Upload your eBay export CSV. Common headers like \"Item Title\", \"Sold Price\", and \"Sale Date\" are auto-recognized. Click \"Enhance Rows with AI\" to have the AI clean up titles and extract Player, Year, Brand, Condition, Parallel, and Special Features automatically.",
  },
  {
    category: "Adding Cards",
    question: "Can I import from an active eBay listing?",
    answer:
      "Yes! Go to Add Cards → URL Import tab. Paste the full URL of an active eBay listing and click Import. The AI extracts all card details, price, and listing date automatically. Make sure the listing is still active — ended listings may not import correctly.",
  },
  {
    category: "Collection",
    question: "How do I switch between List and Grid view?",
    answer:
      "Use the view toggle icons in the top-right corner of the Collection page. List View shows a sortable table with key stats; Grid View shows a visual gallery of card images.",
  },
  {
    category: "Collection",
    question: "How do I export my collection?",
    answer:
      "Click the \"Export CSV\" button at the top of the Collection page. This downloads your entire (or currently filtered) portfolio as a spreadsheet, great for record-keeping or backups.",
  },
  {
    category: "Collection",
    question: "How do I delete a card?",
    answer:
      "In List View, click the three-dot menu (⋮) on the card's row and select Delete. This permanently removes the card from your portfolio.",
  },
  {
    category: "Card Details",
    question: "How do I update my purchase price?",
    answer:
      "Open the card's detail page and click the edit ✏️ icon next to Purchase Price. Enter the correct amount and save. Keeping this accurate is essential for correct ROI and Gain/Loss calculations.",
  },
  {
    category: "Card Details",
    question: "What does the AI Analysis tab tell me?",
    answer:
      "Click Run AI Analysis on any card to get: Grading ROI (should you send it to PSA/BGS?), Grade Probabilities (odds of PSA 10/9/lower), Investment Outlook (Bullish/Neutral/Bearish short & long term), and Historical Significance of the card in the hobby.",
  },
  {
    category: "Card Details",
    question: "How do I add or change a card's image?",
    answer:
      "On the card detail page, click \"Upload Image\", select a photo from your device. The image is automatically compressed and saved to the card.",
  },
  {
    category: "AI Insights",
    question: "How is the Portfolio Risk Score calculated?",
    answer:
      "The Gemini AI evaluates your collection on four pillars: Diversification (era concentration), Quality (Graded vs Raw ratio), Liquidity (star players vs commons), and Market Trends (peaking vs undervalued cards). It produces a score from 1–100, where lower is safer, and labels it Low, Moderate, or High risk.",
  },
  {
    category: "AI Insights",
    question: "What do Buy, Sell, Hold, and Hidden Gem mean?",
    answer:
      "These are card-by-card AI signals: Hold = strong long-term outlook, keep it. Sell = low liquidity or declining market, consider exiting. Hidden Gem = undervalued relative to peers, a sleeper pick. Buy = favorable entry point, consider adding more. Each comes with a written reasoning.",
  },
  {
    category: "AI Insights",
    question: "Why did the Market Report fail to generate?",
    answer:
      "This is usually a temporary API rate limit. If you've run several AI operations recently (scans, CSV enhance, etc.), the Gemini API free tier may need ~60 seconds to reset. Wait a moment and try again.",
  },
  {
    category: "Alerts",
    question: "How do I set up a price alert for a specific player?",
    answer:
      "Go to Dashboard → Smart Notifications → Configure Rules. Set Target Type to \"Specific Player\", enter the player's name (e.g. \"Connor McDavid\"), choose a Condition (e.g. Rises Above $), set your Threshold, and save. Then click Run Market Scan to check immediately.",
  },
  {
    category: "Alerts",
    question: "What are the different alert types?",
    answer:
      "Price Drop (green) = buying opportunity. Price Rise (blue) = sell or hold signal. Optimal Sell (purple) = AI-identified profit-taking moment. Red Flag (red) = risk warning such as an overvalued card or soft market.",
  },
  {
    category: "Market Hub",
    question: "How do I compare two cards?",
    answer:
      "On the Market page, click Compare Cards (top-right button). Select two cards from your portfolio in the dropdowns and click Run Comparison. The AI generates a side-by-side report with Grading ROI, Grade Probabilities, Investment Outlook, and a final AI Verdict on which is the stronger hold.",
  },
  {
    category: "Market Hub",
    question: "Can I focus the Weekly Market Report on a specific topic?",
    answer:
      "Yes. On the Market → Market Intelligence tab, type a topic in the optional input field before clicking Generate (e.g., \"Connor McDavid\" or \"Junk Wax era\"). A focused report is far more actionable than a general overview.",
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
