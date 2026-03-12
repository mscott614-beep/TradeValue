"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { 
  TrendingUp, 
  BarChart3, 
  LineChart, 
  Wallet, 
  Search, 
  BrainCircuit, 
  ShieldCheck, 
  Zap,
  ArrowRight,
  Menu,
  X,
  ChevronRight,
  Activity,
  DollarSign
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

const chartData = [
  { name: 'Jan', value: 4000 },
  { name: 'Feb', value: 3000 },
  { name: 'Mar', value: 5000 },
  { name: 'Apr', value: 4500 },
  { name: 'May', value: 6000 },
  { name: 'Jun', value: 5500 },
  { name: 'Jul', value: 7000 },
];

const liveFeeds = [
  { name: '1999 Base Set Charizard', price: '$420,000', change: '+5.2%', up: true },
  { name: '2000 Tom Brady RC', price: '$2,500', change: '+12.8%', up: true },
  { name: '2023 Connor Bedard Young Guns', price: '$850', change: '-2.1%', up: false },
  { name: '1986 Fleer Michael Jordan', price: '$15,400', change: '+1.4%', up: true },
  { name: '2015 Connor McDavid Collection', price: '$1,200', change: '+8.5%', up: true },
];

export default function Home() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 selection:bg-[#38bdf8]/30 selection:text-[#38bdf8]">
      {/* NAVIGATION */}
      <header 
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${
          isScrolled ? 'bg-[#0f172a]/80 backdrop-blur-md border-b border-white/5 py-4' : 'bg-transparent py-6'
        }`}
      >
        <div className="container mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-[#38bdf8] to-[#0ea5e9] flex items-center justify-center">
              <TrendingUp className="text-[#0f172a] h-5 w-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white uppercase">TradeValue</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
            <Link href="#features" className="hover:text-[#38bdf8] transition-colors">Features</Link>
            <Link href="#market" className="hover:text-[#38bdf8] transition-colors">Market</Link>
            <Link href="#pricing" className="hover:text-[#38bdf8] transition-colors">Insights</Link>
          </nav>

          <div className="hidden md:flex items-center gap-4">
            <Button variant="ghost" className="text-slate-400 hover:text-white" asChild>
              <Link href="/login">Login</Link>
            </Button>
            <Button className="bg-[#38bdf8] hover:bg-[#0ea5e9] text-[#0f172a] font-bold px-6 border-0" asChild>
              <Link href="/dashboard">Launch App</Link>
            </Button>
          </div>

          <button 
            className="md:hidden text-white"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[#38bdf8]/5 rounded-full blur-[120px] -z-10" />
        
        <div className="container mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#38bdf8]/10 border border-[#38bdf8]/20 text-[#38bdf8] text-xs font-bold uppercase tracking-widest mb-8 animate-fade-in">
            <ShieldCheck className="w-3.5 h-3.5" /> Trusted by 10k+ Collectors
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tight mb-6 animate-slide-up">
            Master the Trade with <br />
            <span className="text-[#38bdf8]">Real-Time Analytics</span>
          </h1>
          
          <p className="max-w-2xl mx-auto text-lg text-slate-400 mb-10 animate-slide-up [animation-delay:200ms]">
            Historical sold data and portfolio tracking powered by the 
            <span className="text-white font-medium"> eBay Marketplace</span>. The Bloomberg Terminal for the trading card hobby.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20 animate-slide-up [animation-delay:400ms]">
            <Button size="lg" className="bg-[#38bdf8] hover:bg-[#0ea5e9] text-[#0f172a] font-bold px-8 h-14 text-base w-full sm:w-auto" asChild>
              <Link href="/dashboard">Get Started Free <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button size="lg" variant="outline" className="border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-white h-14 px-8 text-base w-full sm:w-auto">
              View Live Demo
            </Button>
          </div>

          {/* Dashboard Preview */}
          <div className="relative max-w-5xl mx-auto animate-slide-up [animation-delay:600ms]">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-[#38bdf8]/50 to-transparent rounded-2xl blur opacity-30 group-hover:opacity-100 transition" />
            <div className="relative bg-[#1e293b]/50 border border-slate-800 rounded-xl overflow-hidden backdrop-blur-xl shadow-2xl">
              {/* Fake Window Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#0f172a]/80">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                </div>
                <div className="text-[10px] text-slate-500 font-mono tracking-widest uppercase flex items-center gap-2">
                  <Activity className="h-3 w-3" /> system.status: optimal
                </div>
              </div>
              
              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        Market Performance <Badge variant="outline" className="border-[#38bdf8]/30 text-[#38bdf8] text-[10px]">REAL-TIME</Badge>
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">Aggregated data from eBay Marketplace Insights</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-mono font-bold text-green-400">+$2,482.10</p>
                      <p className="text-[10px] text-slate-500 tracking-tighter uppercase">Portfolio P/L (30D)</p>
                    </div>
                  </div>
                  
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis 
                          dataKey="name" 
                          stroke="#475569" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false} 
                        />
                        <YAxis 
                          stroke="#475569" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false} 
                          tickFormatter={(value) => `$${value/1000}k`}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#0f172a', 
                            borderColor: '#38bdf833',
                            borderRadius: '8px',
                            color: '#fff'
                          }} 
                        />
                        <Area 
                          type="monotone" 
                          dataKey="value" 
                          stroke="#38bdf8" 
                          strokeWidth={2}
                          fillOpacity={1} 
                          fill="url(#colorValue)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Recent Appraisals</h4>
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-800">
                      <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center">
                        <Image 
                          src={`https://images.unsplash.com/photo-1541807084-5c52b6b3adef?q=80&w=40&h=40&auto=format&fit=crop`} 
                          alt="card"
                          width={40}
                          height={40}
                          className="rounded opacity-60"
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-white truncate">2003 LeBron James RC</p>
                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Search className="h-2 w-2" /> Upper Deck #1
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-[#38bdf8]">$1,250.00</p>
                        <p className="text-[9px] text-green-500">+4.2%</p>
                      </div>
                    </div>
                  ))}
                  <div className="pt-4 mt-auto">
                    <div className="p-3 bg-[#38bdf8]/5 rounded-lg border border-[#38bdf8]/10 text-center">
                      <p className="text-[10px] text-slate-400">Next Major Catalyst:</p>
                      <p className="text-[11px] font-bold text-white mt-0.5">NBA Play-In Tournament</p>
                      <Progress value={78} className="h-1 mt-2 bg-slate-800" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* LIVE MARKET FEEDS - MARQUEE */}
      <div className="bg-[#1e293b]/30 py-4 border-y border-slate-800 relative overflow-hidden">
        <div className="flex animate-marquee whitespace-nowrap">
          {[...liveFeeds, ...liveFeeds].map((item, i) => (
            <div key={i} className="flex items-center gap-4 mx-8">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-widest">{item.name}</span>
              <span className="text-sm font-bold text-white">{item.price}</span>
              <span className={`text-xs font-bold ${item.up ? 'text-green-500' : 'text-red-500'}`}>
                {item.up ? '▲' : '▼'} {item.change}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* FEATURE GRID */}
      <section id="features" className="py-32 relative">
        <div className="container mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-20">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Designed for Serious Investors</h2>
            <p className="text-slate-400">Professional-grade tools to manage, value, and trade your assets with clinical precision.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Search className="h-6 w-6 text-[#38bdf8]" />}
              title="Market Comp Engine"
              description="Instantly fetch real-world sold data from multiple marketplaces to find the most accurate comps."
              delay="0ms"
            />
            <FeatureCard 
              icon={<Wallet className="h-6 w-6 text-[#38bdf8]" />}
              title="Portfolio P/L Tracking"
              description="Live tracking of your collection's value over time. Visualize gains, losses, and diversification."
              delay="100ms"
            />
            <FeatureCard 
              icon={<BrainCircuit className="h-6 w-6 text-[#38bdf8]" />}
              title="Automated Appraisal"
              description="AI-driven valuation that considers grading, centering, and current market sentiment."
              delay="200ms"
            />
          </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <section className="py-32">
        <div className="container mx-auto px-6">
          <div className="relative p-12 md:p-20 rounded-3xl overflow-hidden text-center bg-gradient-to-br from-slate-900 to-[#1e293b] border border-slate-800">
            {/* Background pattern */}
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #38bdf8 1px, transparent 0)', backgroundSize: '24px 24px' }} />
            
            <div className="relative z-10 max-w-3xl mx-auto">
              <h2 className="text-4xl md:text-6xl font-bold text-white mb-8">Ready to value your collection?</h2>
              <p className="text-xl text-slate-400 mb-12">Join thousands of investors using TradeValue to gain the upper hand in the marketplace.</p>
              <Button size="lg" className="bg-[#38bdf8] hover:bg-[#0ea5e9] text-[#0f172a] font-bold px-12 h-16 text-lg rounded-xl shadow-lg shadow-[#38bdf8]/20" asChild>
                <Link href="/dashboard">Launch Dashboard Now</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 border-t border-slate-800">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center">
              <TrendingUp className="text-[#38bdf8] h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-bold tracking-tight text-white uppercase">TradeValue</span>
          </div>
          <p className="text-sm text-slate-500">© 2024 TradeValue Market Insight. All rights reserved.</p>
          <div className="flex gap-6 text-sm text-slate-500">
            <Link href="#" className="hover:text-white transition-colors">Twitter</Link>
            <Link href="#" className="hover:text-white transition-colors">Discord</Link>
            <Link href="#" className="hover:text-white transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description, delay }: { icon: React.ReactNode, title: string, description: string, delay: string }) {
  return (
    <Card className="bg-[#1e293b]/50 border-slate-800 hover:border-[#38bdf8]/30 transition-all duration-300 group hover:-translate-y-1 animate-slide-up" style={{ animationDelay: delay }}>
      <CardContent className="pt-8">
        <div className="w-12 h-12 rounded-lg bg-slate-900 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
          {icon}
        </div>
        <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
        <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
        <div className="mt-6 flex items-center gap-1 text-xs font-bold text-[#38bdf8] uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
          Learn More <ChevronRight className="h-3 w-3" />
        </div>
      </CardContent>
    </Card>
  );
}

function Badge({ children, variant, className }: { children: React.ReactNode, variant?: 'outline', className?: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${variant === 'outline' ? 'border border-slate-700' : ''} ${className}`}>
      {children}
    </span>
  );
}

function Progress({ value, className }: { value: number, className?: string }) {
  return (
    <div className={`w-full bg-slate-800 rounded-full h-1 overflow-hidden ${className}`}>
      <div className="bg-[#38bdf8] h-full rounded-full transition-all duration-1000" style={{ width: `${value}%` }} />
    </div>
  );
}
