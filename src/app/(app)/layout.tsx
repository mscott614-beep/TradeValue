'use client';

import type { ReactNode } from "react";
import { SidebarProvider, Sidebar, SidebarInset } from "@/components/ui/sidebar";
import { MainNav } from "@/components/main-nav";
import { UserNav } from "@/components/user-nav";
import { Logo } from "@/components/icons";
import { SidebarHeader, SidebarFooter, SidebarContent } from "@/components/ui/sidebar";
import Link from 'next/link';
import { useUser } from "@/firebase";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AnonymousBanner } from "@/components/anonymous-banner";
import { TickerComponent } from "@/components/ticker-component";
import { useSettings } from "@/hooks/use-settings";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, isUserLoading } = useUser();
  const { settings } = useSettings();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [isUserLoading, user, router]);

  if (isUserLoading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar className={settings.showTicker ? "pb-12" : ""}>
        <SidebarHeader>
           <Link href="/dashboard" className="flex items-center gap-2">
            <Logo className="w-8 h-8" />
            <span className="font-semibold text-lg">TradeValue</span>
           </Link>
        </SidebarHeader>
        <SidebarContent>
          <MainNav />
        </SidebarContent>
        <SidebarFooter className={settings.showTicker ? "pb-12" : ""}>
          <UserNav />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className={settings.showTicker ? "pb-12" : ""}>
        <AnonymousBanner />
        <div className="p-4 sm:p-6 lg:p-8">
            {children}
        </div>
        {settings.showTicker && <TickerComponent />}
      </SidebarInset>
    </SidebarProvider>
  );
}
