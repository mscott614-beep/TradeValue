'use client';

import { useEffect, useState } from 'react';
import { useAuth, useUser, initiateEmailSignUp, initiateEmailSignIn, initiateAnonymousSignIn } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Logo } from '@/components/icons';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function AuthForm() {
    const auth = useAuth();
    const { toast } = useToast();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleSignIn = () => {
        if (!email || !password) {
            toast({ title: 'Sign In Failed', description: 'Please enter email and password.', variant: 'destructive' });
            return;
        }
        initiateEmailSignIn(auth, email, password);
    };

    const handleSignUp = () => {
        if (!email || !password) {
            toast({ title: 'Sign Up Failed', description: 'Please enter email and password.', variant: 'destructive' });
            return;
        }
        initiateEmailSignUp(auth, email, password);
    };
    
    const handleAnonymousSignIn = () => {
        initiateAnonymousSignIn(auth);
    };

    return (
        <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
                <Card>
                    <CardHeader>
                        <CardTitle>Sign In</CardTitle>
                        <CardDescription>Enter your credentials to access your account.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="space-y-1">
                            <Label htmlFor="email-signin">Email</Label>
                            <Input id="email-signin" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="m@example.com" />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="password-signin">Password</Label>
                            <Input id="password-signin" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" onClick={handleSignIn}>Sign In</Button>
                    </CardFooter>
                </Card>
            </TabsContent>
            <TabsContent value="signup">
                <Card>
                    <CardHeader>
                        <CardTitle>Sign Up</CardTitle>
                        <CardDescription>Create a new account to get started.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                         <div className="space-y-1">
                            <Label htmlFor="email-signup">Email</Label>
                            <Input id="email-signup" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="m@example.com" />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="password-signup">Password</Label>
                            <Input id="password-signup" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" onClick={handleSignUp}>Sign Up</Button>
                    </CardFooter>
                </Card>
            </TabsContent>
            <div className="my-4 flex items-center">
                <div className="flex-grow border-t border-muted" />
                <span className="mx-4 text-xs uppercase text-muted-foreground">Or</span>
                <div className="flex-grow border-t border-muted" />
            </div>
            <Button variant="secondary" className="w-full" onClick={handleAnonymousSignIn}>
                Continue Anonymously
            </Button>
        </Tabs>
    );
}


export default function LoginPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || (!isUserLoading && user)) {
    return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-4">
            <div className="flex flex-col items-center space-y-2 text-center">
                 <Logo className="w-12 h-12" />
                <h1 className="text-2xl font-semibold tracking-tight">Welcome to TradeValue</h1>
                <p className="text-sm text-muted-foreground">Sign in to manage your trading card portfolio.</p>
            </div>
            <AuthForm />
        </div>
    </div>
  );
}
