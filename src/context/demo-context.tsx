'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface DemoContextType {
  isDemo: boolean;
  setIsDemo: (value: boolean) => void;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [isDemo, setIsDemo] = useState(false);

  // Persistence check (optional, but requested to be set via /demo route)
  useEffect(() => {
    const savedDemo = localStorage.getItem('isDemo') === 'true';
    if (savedDemo) setIsDemo(true);
  }, []);

  const handleSetIsDemo = (value: boolean) => {
    setIsDemo(value);
    localStorage.setItem('isDemo', String(value));
  };

  return (
    <DemoContext.Provider value={{ isDemo, setIsDemo: handleSetIsDemo }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (context === undefined) {
    throw new Error('useDemo must be used within a DemoProvider');
  }
  return context;
}
