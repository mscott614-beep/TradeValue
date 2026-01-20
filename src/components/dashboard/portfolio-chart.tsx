"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts"

import {
  ChartContainer,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { PortfolioHistory } from "@/lib/types"

interface PortfolioChartProps {
  data: PortfolioHistory[];
}

const chartConfig = {
  value: {
    label: "Value",
    color: "hsl(var(--primary))",
  },
}

export default function PortfolioChart({ data }: PortfolioChartProps) {
  return (
    <ChartContainer config={chartConfig} className="h-[250px] w-full">
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{
          left: 12,
          right: 12,
          top: 10
        }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => value.slice(0, 3)}
        />
        <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => `$${Number(value) / 1000}k`}
        />
        <Tooltip
            cursor={{ fill: 'hsl(var(--secondary))', radius: 4 }}
            content={
              <ChartTooltipContent
                indicator="dot"
                formatter={(value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value))}
              />
            }
        />
        <defs>
            <linearGradient id="fillValue" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0.8}
              />
              <stop
                offset="95%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0.1}
              />
            </linearGradient>
        </defs>
        <Area
          dataKey="value"
          type="natural"
          fill="url(#fillValue)"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={{
            fill: "hsl(var(--background))",
            stroke: "hsl(var(--primary))",
            strokeWidth: 2,
            r: 4,
          }}
          activeDot={{
            r: 6,
          }}
        />
      </AreaChart>
    </ChartContainer>
  )
}
