'use client';

import { useFirestore, useUser, useMemoFirebase } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useMemo } from 'react';

export interface UserSettings {
  showTicker: boolean;
  // Add other settings here as needed
}

const DEFAULT_SETTINGS: UserSettings = {
  showTicker: true,
};

export function useSettings() {
  const { user } = useUser();
  const firestore = useFirestore();

  const settingsRef = useMemoFirebase(() => {
    if (!user) return null;
    return doc(firestore, 'users', user.uid, 'settings', 'preferences');
  }, [user, firestore]);

  const { data: settingsData, isLoading } = useDoc<UserSettings>(settingsRef);

  const settings = useMemo(() => {
    if (!settingsData) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...settingsData };
  }, [settingsData]);

  const updateSettings = async (newSettings: Partial<UserSettings>) => {
    if (!settingsRef) return;
    await setDoc(settingsRef, { ...settings, ...newSettings }, { merge: true });
  };

  return {
    settings,
    isLoading,
    updateSettings,
  };
}
