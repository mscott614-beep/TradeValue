import type { SVGProps } from "react";

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg 
      width="32" 
      height="32" 
      viewBox="0 0 32 32" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path 
        d="M6 2L20 2L26 8V24L20 30H6L2 24V8L6 2Z" 
        stroke="hsl(var(--primary))" 
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path 
        d="M11 10H21" 
        stroke="hsl(var(--primary))" 
        strokeWidth="2" 
        strokeLinecap="round"
      />
      <path 
        d="M16 10V22" 
        stroke="hsl(var(--primary))" 
        strokeWidth="2" 
        strokeLinecap="round"
      />
      <path 
        d="M11 16L16 22L21 16" 
        stroke="hsl(var(--accent))" 
        strokeWidth="2" 
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
