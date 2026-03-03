'use client';
import {
    Auth,
    signInAnonymously,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from 'firebase/auth';

type ToastFunction = (options: {
    title: string;
    description: string;
    variant: 'destructive';
}) => void;


const getAuthErrorMessage = (error: any): string => {
    console.error('Firebase Auth Error:', error);
    if (error && typeof error === 'object' && 'code' in error) {
        switch (error.code) {
            case 'auth/invalid-email':
                return 'The email address is not valid.';
            case 'auth/user-disabled':
                return 'This user account has been disabled.';
            case 'auth/user-not-found':
                return 'No user found with this email.';
            case 'auth/wrong-password':
                return 'Incorrect password. Please try again.';
            case 'auth/email-already-in-use':
                return 'This email is already registered.';
            case 'auth/weak-password':
                return 'The password is too weak. Please use at least 6 characters.';
            case 'auth/invalid-credential':
                return 'Invalid credentials. Please check your email and password.';
            case 'auth/operation-not-allowed':
                return 'Email/Password sign-in is not enabled. Please enable it in the Firebase Console.';
            default:
                return `An unexpected error occurred (${error.code}). Please try again.`;
        }
    }
    return error.message || 'An unknown error occurred.';
}


/** Initiate anonymous sign-in (non-blocking). */
export function initiateAnonymousSignIn(authInstance: Auth, toast: ToastFunction): void {
    signInAnonymously(authInstance)
        .catch(error => {
            toast({
                title: 'Anonymous Sign-In Failed',
                description: getAuthErrorMessage(error),
                variant: 'destructive'
            });
        });
}

/** Initiate email/password sign-up (non-blocking). */
export function initiateEmailSignUp(authInstance: Auth, email: string, password: string, toast: ToastFunction): void {
    createUserWithEmailAndPassword(authInstance, email, password)
        .catch(error => {
            toast({
                title: 'Sign Up Failed',
                description: getAuthErrorMessage(error),
                variant: 'destructive'
            });
        });
}

/** Initiate email/password sign-in (non-blocking). */
export function initiateEmailSignIn(authInstance: Auth, email: string, password: string, toast: ToastFunction): void {
    signInWithEmailAndPassword(authInstance, email, password)
        .catch(error => {
            toast({
                title: 'Sign In Failed',
                description: getAuthErrorMessage(error),
                variant: 'destructive'
            });
        });
}

/** Initiate Google sign-in (non-blocking). */
export function initiateGoogleSignIn(authInstance: Auth, toast: ToastFunction): void {
    const provider = new GoogleAuthProvider();
    signInWithPopup(authInstance, provider)
        .catch(error => {
            toast({
                title: 'Google Sign-In Failed',
                description: getAuthErrorMessage(error),
                variant: 'destructive'
            });
        });
}
