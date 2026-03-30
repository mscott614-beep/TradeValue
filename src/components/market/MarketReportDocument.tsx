"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import { format } from "date-fns";
import { 
  FileText, 
  ShieldCheck, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MarketReportDocumentProps {
  content: string;
  date?: Date;
}

export function MarketReportDocument({ content, date = new Date() }: MarketReportDocumentProps) {
  return (
    <div className="report-card bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-10 md:p-16 shadow-2xl border border-slate-200 dark:border-slate-800 rounded-none max-w-4xl mx-auto report-container animate-fade-in relative overflow-hidden">
      
      {/* WATERMARK */}
      <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none select-none">
        <div className="text-[120px] font-black tracking-tighter rotate-12">TRADEVALUE</div>
      </div>

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start border-b-4 border-slate-900 dark:border-slate-100 pb-10 mb-12 gap-6 relative z-10">
        <div className="flex items-center gap-4">
          <div className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 p-3 rounded-none font-black text-3xl tracking-tighter">
            TV
          </div>
          <div>
            <span className="text-3xl font-black font-sans tracking-tighter uppercase block leading-none">TradeValue</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-[0.3em] font-sans font-bold">
              Market Intelligence Group
            </span>
          </div>
        </div>
        
        <div className="text-right flex flex-col items-end pt-2">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-500 mb-1">
            <ShieldCheck className="w-5 h-5 fill-current" />
            <span className="text-sm font-black font-sans uppercase tracking-widest">Confidential Market Intelligence</span>
          </div>
          <p className="text-lg font-sans font-bold border-t border-slate-200 dark:border-slate-800 pt-1 mt-1">
            {format(date, "MMMM d, yyyy")}
          </p>
        </div>
      </div>

      {/* BLURB / DISCLAIMER */}
      <div className="no-print mb-12 p-6 bg-slate-50 dark:bg-slate-900/50 border-l-4 border-slate-900 dark:border-slate-100 flex items-start gap-4">
        <Info className="w-6 h-6 text-slate-900 dark:text-slate-100 shrink-0 mt-0.5" />
        <p className="text-sm font-sans text-slate-600 dark:text-slate-400 leading-relaxed italic">
          This investor-grade intelligence report synthesizes real-time eBay liquidity data with proprietary AI analysis. 
          TradeValue provides data-driven insights; however, this document does not constitute formal financial advice.
        </p>
      </div>

      {/* CONTENT */}
      <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-sans prose-headings:font-black prose-headings:tracking-tighter prose-headings:uppercase prose-h1:text-4xl prose-h1:mb-10 prose-h1:border-b-2 prose-h1:pb-4 prose-h1:border-slate-200 dark:prose-h1:border-slate-800 prose-h2:text-2xl prose-h2:mt-16 prose-h2:mb-6 prose-h2:text-slate-900 dark:prose-h2:text-slate-100 prose-h2:border-l-4 prose-h2:border-slate-950 dark:prose-h2:border-white prose-h2:pl-4 prose-p:font-serif prose-p:text-xl prose-p:leading-[1.6] prose-p:mb-8 prose-p:text-slate-800 dark:prose-p:text-slate-200 prose-li:font-serif prose-li:text-xl prose-li:mb-2 prose-table:font-sans prose-table:text-base prose-blockquote:not-italic prose-blockquote:border-none prose-blockquote:p-0">
        <ReactMarkdown
          components={{
            // Custom table rendering for "Market Snapshot"
            table: ({ children }) => (
              <div className="my-12 overflow-hidden border-2 border-slate-900 dark:border-slate-100">
                <table className="w-full text-left border-collapse">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-sans uppercase text-xs tracking-widest">
                {children}
              </thead>
            ),
            th: ({ children }) => <th className="p-5 font-black uppercase">{children}</th>,
            td: ({ children }) => <td className="p-5 border-t border-slate-200 dark:border-slate-800 font-bold">{children}</td>,
            
            // Custom blockquote for "Investment Recommendation"
            blockquote: ({ children }) => (
              <div className="report-callout my-16 relative">
                <div className="absolute -top-4 left-6 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-1 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  <span className="font-sans font-black uppercase tracking-widest text-[10px]">Strategic Recommendation</span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/80 border-2 border-slate-900 dark:border-slate-100 p-8 pt-10 font-serif italic text-2xl text-slate-900 dark:text-slate-50 leading-tight shadow-lg">
                  {children}
                </div>
              </div>
            ),
            
            // Trend Indicators inside text using the professional hex codes
            strong: ({ children }) => {
              const text = String(children);
              if (text.includes("+") || text.toLowerCase().includes("gain") || text.toLowerCase().includes("up")) {
                return (
                  <span className="inline-flex items-center gap-1 font-black px-1.5 py-0.5 rounded-sm bg-[#39FF14]/10 text-[#39FF14] text-lg">
                    {children}
                  </span>
                );
              }
              if (text.includes("-") || text.toLowerCase().includes("risk") || text.toLowerCase().includes("loss") || text.toLowerCase().includes("down")) {
                return (
                  <span className="inline-flex items-center gap-1 font-black px-1.5 py-0.5 rounded-sm bg-[#FF3131]/10 text-[#FF3131] text-lg">
                    {children}
                  </span>
                );
              }
              return <strong className="font-black text-slate-950 dark:text-white underline decoration-2 decoration-slate-200 dark:decoration-slate-800 underline-offset-4">{children}</strong>;
            }
          }}
        >
          {content}
        </ReactMarkdown>
      </article>

      {/* FOOTER */}
      <div className="mt-32 pt-10 border-t-2 border-slate-900 dark:border-slate-100 flex flex-col md:flex-row justify-between items-center text-[11px] uppercase tracking-[0.4em] text-slate-500 dark:text-slate-400 font-sans font-black relative z-10">
        <div className="mb-6 md:mb-0">
          Generated via TradeValue Intelligence Core v4.2
        </div>
        <div className="flex items-center gap-8">
          <span>Page 01 of 01</span>
          <span className="opacity-20">|</span>
          <span className="text-slate-900 dark:text-slate-100">ID: TV-INTEL-{Math.random().toString(36).substring(7).toUpperCase()}</span>
        </div>
      </div>
      
      <div className="mt-8 text-[10px] text-center text-slate-400 font-sans max-w-2xl mx-auto italic leading-relaxed uppercase tracking-widest opacity-60">
        Property of TradeValue. Unauthorized distribution is prohibited. 
        Past performance does not guarantee future results.
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=Merriweather:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        
        .report-container {
          font-family: 'Inter', sans-serif;
        }
        
        @media print {
          .report-card {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
          }
          .prose-h2 {
            page-break-before: auto;
          }
          body {
            background: white !important;
          }
        }
      `}</style>
    </div>
  );
}
