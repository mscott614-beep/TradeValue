import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { DemoProvider } from '@/context/demo-context';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TradeValue',
  description: 'AI-powered trading card portfolio tracking and valuation.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={cn('min-h-screen bg-background text-foreground antialiased', inter.className)}>
        <FirebaseClientProvider>
          <DemoProvider>
            {children}
          </DemoProvider>
        </FirebaseClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
