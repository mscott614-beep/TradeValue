"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Layers,
  ScanLine,
  Store,
  Bell,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "Home", icon: LayoutGrid },
  { href: "/collection", label: "Binder", icon: Layers },
  { href: "/scanner", label: "Scan", icon: ScanLine, primary: true },
  { href: "/market", label: "Market", icon: Store },
  { href: "/dashboard/alerts", label: "Alerts", icon: Bell },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around bg-background/80 backdrop-blur-lg border-t border-border px-4 pb-safe pt-2 sm:hidden h-20">
      {links.map((link) => {
        const isActive = pathname.startsWith(link.href);
        const Icon = link.icon;

        if (link.primary) {
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex flex-col items-center justify-center -mt-12"
            >
              <div className={cn(
                "flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all",
                isActive 
                  ? "bg-primary text-primary-foreground scale-110 shadow-primary/40 ring-4 ring-background" 
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              )}>
                <Icon className="h-7 w-7" />
              </div>
              <span className={cn(
                "mt-2 text-[10px] font-medium tracking-wide",
                isActive ? "text-primary" : "text-muted-foreground invisible"
              )}>
                {link.label}
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center justify-center px-2 py-1 transition-all"
          >
            <div className={cn(
              "p-1.5 rounded-xl transition-colors",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            )}>
              <Icon className={cn("h-6 w-6", isActive && "fill-current/10")} />
            </div>
            <span className={cn(
              "mt-1 text-[10px] font-medium transition-colors",
              isActive ? "text-primary font-bold" : "text-muted-foreground"
            )}>
              {link.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
