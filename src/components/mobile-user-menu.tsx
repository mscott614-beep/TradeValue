"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth, useUser } from "@/firebase";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useSettings } from "@/hooks/use-settings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  LogOut, 
  Settings2, 
  HelpCircle, 
  User, 
  ChevronRight,
  ShieldCheck,
  CreditCard
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface MobileUserMenuProps {
  children: React.ReactNode;
}

export function MobileUserMenu({ children }: MobileUserMenuProps) {
  const { user } = useUser();
  const { settings, updateSettings } = useSettings();
  const auth = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/login');
  };

  const getInitials = (email?: string | null) => {
    if (!email) return "U";
    return email.substring(0, 2).toUpperCase();
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-[20px] px-6 pb-12 pt-4 border-t-primary/20 bg-slate-950/95 backdrop-blur-xl">
        <SheetHeader className="text-left mb-6">
          <div className="flex items-center gap-4 mb-2">
            <Avatar className="h-14 w-14 ring-2 ring-primary/20 ring-offset-2 ring-offset-background">
              <AvatarImage src={user?.photoURL || `https://picsum.photos/seed/user/100/100`} />
              <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
                {getInitials(user?.email)}
              </AvatarFallback>
            </Avatar>
            <div>
              <SheetTitle className="text-xl font-bold">
                {user?.isAnonymous ? 'Anonymous' : (user?.displayName || user?.email?.split('@')[0] || 'Member')}
              </SheetTitle>
              <SheetDescription className="text-slate-400">
                {user?.isAnonymous ? 'Guest Access' : user?.email}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6">
          {/* Settings Section */}
          <div className="space-y-1">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 pl-1">Preferences</h4>
            <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Settings2 className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Market Ticker</p>
                  <p className="text-[10px] text-slate-500">Real-time valuation updates</p>
                </div>
              </div>
              <Switch 
                checked={settings.showTicker} 
                onCheckedChange={(checked) => updateSettings({ showTicker: checked })}
              />
            </div>
          </div>

          {/* Quick Links Section */}
          <div className="space-y-1">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 pl-1">Support & Privacy</h4>
            <div className="grid grid-cols-1 gap-2">
              <Link href="/help" className="flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-slate-800/50 active:bg-slate-800 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg">
                    <HelpCircle className="h-5 w-5 text-emerald-400" />
                  </div>
                  <span className="text-sm font-medium">Help Center</span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-600" />
              </Link>
              <div className="flex items-center justify-between p-4 bg-slate-900/10 rounded-2xl border border-slate-800/20 opacity-50 grayscale">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-lg">
                    <ShieldCheck className="h-5 w-5 text-purple-400" />
                  </div>
                  <span className="text-sm font-medium">Security</span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-600" />
              </div>
            </div>
          </div>

          {/* Sign Out */}
          <Button 
            variant="destructive" 
            className="w-full h-14 rounded-2xl text-base font-bold shadow-lg shadow-destructive/20 border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white transition-all group"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-5 w-5 transition-transform group-active:translate-x-1" />
            Log out
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
