"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  LayoutGrid,
  RectangleStack,
  ScanLine,
  Store,
  Bell,
} from "lucide-react";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/collection", label: "Collection", icon: RectangleStack },
  { href: "/scanner", label: "Scanner", icon: ScanLine },
  { href: "/market", label: "Market", icon: Store },
  { href: "/alerts", label: "Alerts", icon: Bell },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <SidebarMenu>
      {links.map((link) => (
        <SidebarMenuItem key={link.href}>
          <Link href={link.href} passHref>
            <SidebarMenuButton
              isActive={pathname.startsWith(link.href)}
              tooltip={link.label}
            >
              <link.icon className="h-5 w-5" />
              <span>{link.label}</span>
            </SidebarMenuButton>
          </Link>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
