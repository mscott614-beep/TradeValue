import type { Metadata } from 'next';
import { Inter, Merriweather } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { Toaster as SonnerToaster } from 'sonner';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { DemoProvider } from '@/context/demo-context';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const merriweather = Merriweather({ 
  subsets: ['latin'], 
  weight: ['300', '400', '700'],
  variable: '--font-serif' 
});

export const metadata: Metadata = {
  title: 'TradeValue',
  description: 'AI-powered trading card portfolio tracking and valuation.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'TradeValue',
  },
  icons: {
    apple: '/icon-512.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={cn(
        'min-h-screen bg-background text-foreground antialiased font-sans', 
        inter.variable, 
        merriweather.variable
      )}>
        <FirebaseClientProvider>
          <DemoProvider>
            {children}
          </DemoProvider>
        </FirebaseClientProvider>
        <Toaster />
        <SonnerToaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
