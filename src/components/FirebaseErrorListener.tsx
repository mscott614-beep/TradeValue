'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

/**
 * An invisible component that listens for globally emitted 'permission-error' events.
 * It provides UI feedback via toasts and logs detailed error context.
 */
export const FirebaseErrorListener = () => {
  const [error, setError] = useState<FirestorePermissionError | null>(null);
  const { user } = useUser();
  const { toast } = useToast();

  useEffect(() => {
    // Log identity immediately on mount/change to provide context for any upcoming errors
    if (user) {
      console.log(`[FirebaseErrorListener] Identity: ${user.email} (UID: ${user.uid})`);
    }

    const handleError = (error: FirestorePermissionError) => {
      console.error('Firestore Permission Error Details:', error);
      
      // Trigger a detailed toast so the user knows EXACTLY what failed
      toast({
        title: "Firestore Permission Denied",
        description: `Failed to ${error.request.method} at path: ${error.request.path.replace('/databases/(default)/documents/', '')}`,
        variant: "destructive",
      });

      setError(error);
    };

    // Global catch-all for unhandled rejections (often where native Firestore errors end up)
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason?.message?.includes('permission') || reason?.code === 'permission-denied') {
        console.error('Caught Unhandled Firestore Permission Error:', reason);
        
        toast({
          title: "Critical Permission Error",
          description: reason.message || "Missing or insufficient permissions.",
          variant: "destructive",
        });
      }
    };

    errorEmitter.on('permission-error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      errorEmitter.off('permission-error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [user, toast]);

  // If an error is severe enough, it will still propagate through the state
  // But for now, we rely on the Toast for user feedback and the Console for developer feedback
  
  return null;
}
