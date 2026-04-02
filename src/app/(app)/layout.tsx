'use client';

import type { ReactNode } from "react";
import { SidebarProvider, Sidebar, SidebarInset } from "@/components/ui/sidebar";
import { MainNav } from "@/components/main-nav";
import { UserNav } from "@/components/user-nav";
import { Logo } from "@/components/icons";
import { cn } from "@/lib/utils";
import { SidebarHeader, SidebarFooter, SidebarContent } from "@/components/ui/sidebar";
import Link from 'next/link';
import { useUser } from "@/firebase";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AnonymousBanner } from "@/components/anonymous-banner";
import { TickerComponent } from "@/components/ticker-component";
import { useSettings } from "@/hooks/use-settings";
import { useDemo } from "@/context/demo-context";

import { BottomNav } from "@/components/bottom-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, isUserLoading } = useUser();
  const { settings } = useSettings();
  const router = useRouter();
  const { isDemo } = useDemo();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [isUserLoading, user, router]);

  const showTicker = settings.showTicker || isDemo;
  const paddingClass = showTicker ? (isDemo ? "pb-24" : "pb-12") : "";

  if (isUserLoading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar className={cn("hidden md:flex", paddingClass)}>
        <SidebarHeader>
           <Link href="/dashboard" className="flex items-center gap-2">
            <Logo className="w-8 h-8" />
            <span className="font-semibold text-lg">TradeValue</span>
           </Link>
        </SidebarHeader>
        <SidebarContent>
          <MainNav />
        </SidebarContent>
        <SidebarFooter className={paddingClass}>
          <UserNav />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className={cn("pb-36 sm:pb-24 md:pb-0", paddingClass)}>
        <AnonymousBanner />
        <div className="p-4 sm:p-6 lg:p-8">
            {children}
        </div>
        {showTicker && <TickerComponent />}
        <BottomNav />
      </SidebarInset>
    </SidebarProvider>
  );
}
