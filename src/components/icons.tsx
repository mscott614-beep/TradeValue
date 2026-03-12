import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <div className={cn("relative overflow-hidden rounded-full border border-border/50", className)}>
      <Image
        src="/logo.jpg"
        alt="TradeValue Logo"
        fill
        className="object-cover"
        priority
      />
    </div>
  );
}
