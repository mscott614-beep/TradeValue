'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDemo } from '@/context/demo-context';

export default function DemoPage() {
  const { setIsDemo } = useDemo();
  const router = useRouter();

  useEffect(() => {
    setIsDemo(true);
    router.push('/dashboard');
  }, [setIsDemo, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-emerald-500 animate-pulse mb-4">
          Entering Sandbox Mode...
        </h1>
        <p className="text-muted-foreground">Preparing your Whale Collection experience.</p>
      </div>
    </div>
  );
}
