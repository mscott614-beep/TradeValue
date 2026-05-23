"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Calendar } from "lucide-react";

interface SnapshotPoint {
  date: string;
  displayDate: string;
  totalValue: number;
  cardCount: number;
  netChange: number;
}

interface PortfolioChartProps {
  data: SnapshotPoint[];
}

const chartConfig = {
  totalValue: {
    label: "Total Value",
    color: "hsl(var(--primary))",
  },
};

export default function PortfolioChart({ data = [] }: PortfolioChartProps) {
  const [timeframe, setTimeframe] = useState<"7D" | "1M" | "3M" | "ALL">("1M");

  // Client-side filtering logic to maintain excellent performance and zero extra read costs
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Chronologically sort data (oldest first for charting)
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

    switch (timeframe) {
      case "7D":
        return sorted.slice(-7);
      case "1M":
        return sorted.slice(-30);
      case "3M":
        return sorted.slice(-90);
      case "ALL":
      default:
        return sorted;
    }
  }, [data, timeframe]);

  // Overall metrics based on the current filtered view
  const metrics = useMemo(() => {
    if (filteredData.length < 2) {
      return { totalGainLoss: 0, gainLossPercent: 0, isGain: true };
    }
    const firstPoint = filteredData[0];
    const lastPoint = filteredData[filteredData.length - 1];
    
    const totalGainLoss = (lastPoint?.totalValue || 0) - (firstPoint?.totalValue || 0);
    const startValue = firstPoint?.totalValue || 1; // avoid divide by zero
    const gainLossPercent = (totalGainLoss / startValue) * 100;
    
    return {
      totalGainLoss,
      gainLossPercent,
      isGain: totalGainLoss >= 0,
    };
  }, [filteredData]);

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[280px] text-center space-y-4">
        <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary animate-pulse">
          <Calendar className="h-6 w-6" />
        </div>
        <div>
          <h4 className="font-semibold text-sm text-foreground">Equity Tracking Initialized</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm px-6 leading-relaxed">
            Your daily historical snapshots will start compiling tonight at midnight EST. Check back tomorrow to see your first equity performance point.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Visual Header & Timeframe Buttons */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          {metrics.totalGainLoss !== 0 && (
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm",
              metrics.isGain 
                ? "bg-green-500/10 text-green-400 border border-green-500/20" 
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            )}>
              {metrics.isGain ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              <span>
                {metrics.isGain ? "+" : ""}
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(metrics.totalGainLoss)}
                {" "}
                ({metrics.isGain ? "+" : ""}
                {metrics.gainLossPercent.toFixed(2)}%)
              </span>
              <span className="text-[10px] opacity-75 font-normal">
                {timeframe === "7D" ? "last 7d" : timeframe === "1M" ? "last 30d" : timeframe === "3M" ? "last 90d" : "all-time"}
              </span>
            </div>
          )}
        </div>

        {/* Dynamic timeframe toggle pills */}
        <div className="flex bg-muted/40 p-1 rounded-lg border border-border">
          {(["7D", "1M", "3M", "ALL"] as const).map((t) => (
            <Button
              key={t}
              variant="ghost"
              size="sm"
              onClick={() => setTimeframe(t)}
              className={cn(
                "h-7 px-3 text-[11px] font-bold rounded transition-all",
                timeframe === t 
                  ? "bg-background shadow text-primary font-extrabold" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>

      {/* Main Responsive AreaChart with customized linear gradients */}
      <div className="h-[230px] w-full">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              accessibilityLayer
              data={filteredData}
              margin={{ left: 5, right: 5, top: 10, bottom: 5 }}
            >
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0.01}
                  />
                </linearGradient>
              </defs>
              
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted/30" />
              
              <XAxis
                dataKey="displayDate"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-[10px] text-muted-foreground fill-muted-foreground font-semibold"
              />
              
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-[10px] text-muted-foreground fill-muted-foreground font-mono font-semibold"
                tickFormatter={(val) => {
                  if (Number(val) >= 1000000) {
                    return `$${(Number(val) / 1000000).toFixed(1)}M`;
                  }
                  if (Number(val) >= 1000) {
                    return `$${(Number(val) / 1000).toFixed(0)}k`;
                  }
                  return `$${val}`;
                }}
              />
              
              <Tooltip
                cursor={{ stroke: "hsl(var(--primary)/30)", strokeWidth: 1.5, strokeDasharray: "4 4" }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const dataPoint = payload[0].payload as SnapshotPoint;
                    const isUp = dataPoint.netChange >= 0;
                    
                    return (
                      <div className="bg-background/95 backdrop-blur border border-border p-3 rounded-lg shadow-xl space-y-1.5 animate-in fade-in zoom-in-95 duration-150">
                        <div className="text-[10px] font-bold text-muted-foreground flex items-center gap-1.5">
                          <Calendar className="h-3 w-3" />
                          <span>{dataPoint.displayDate}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between items-baseline gap-6">
                            <span className="text-[11px] font-medium text-foreground">Equity Value:</span>
                            <span className="text-sm font-black font-mono text-primary">
                              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dataPoint.totalValue)}
                            </span>
                          </div>
                          <div className="flex justify-between items-baseline gap-6 border-t border-muted/30 pt-1 mt-1">
                            <span className="text-[10px] text-muted-foreground">Daily Change:</span>
                            <span className={cn(
                              "text-[10px] font-bold font-mono",
                              isUp ? "text-green-400" : "text-red-400"
                            )}>
                              {isUp ? "+" : ""}
                              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dataPoint.netChange)}
                            </span>
                          </div>
                          <div className="flex justify-between items-baseline gap-6">
                            <span className="text-[10px] text-muted-foreground">Cards Tracked:</span>
                            <span className="text-[10px] font-semibold text-foreground">
                              {dataPoint.cardCount} cards
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              
              <Area
                dataKey="totalValue"
                type="monotone"
                fill="url(#equityFill)"
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={false}
                activeDot={{
                  r: 5.5,
                  fill: "hsl(var(--primary))",
                  stroke: "hsl(var(--background))",
                  strokeWidth: 2,
                  className: "shadow-lg"
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </div>
  );
}
