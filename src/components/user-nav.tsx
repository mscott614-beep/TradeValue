"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, useUser } from "@/firebase";
import { signOut } from "firebase/auth";
import { ChevronUp, LogOut, RefreshCw, Settings, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/hooks/use-settings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { triggerAdminMarketRefreshAction } from "@/app/actions/admin-actions";
import { toast } from "sonner";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function UserNav() {
  const { user } = useUser();
  const { settings, updateSettings } = useSettings();
  const auth = useAuth();
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/login');
  };

  const handleAdminSync = async () => {
    if (!user?.email) return;
    
    setIsRefreshing(true);
    const toastId = toast.loading("Starting global market synchronization...");
    
    try {
      const result = await triggerAdminMarketRefreshAction(user.email);
      if (result.success) {
        toast.success(result.message, { id: toastId });
      } else {
        toast.error(result.error || "Failed to start synchronization", { id: toastId });
      }
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred", { id: toastId });
    } finally {
      setIsRefreshing(false);
    }
  };

  const getInitials = (email?: string | null) => {
    if (!email) return "U";
    return email.substring(0, 2).toUpperCase();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-14 w-full justify-start gap-2 px-2 group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:justify-center">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.photoURL || `https://picsum.photos/seed/user/100/100`} alt={user?.displayName || "User"} data-ai-hint="person portrait" />
              <AvatarFallback>{getInitials(user?.email)}</AvatarFallback>
            </Avatar>
            <div className="text-left group-data-[collapsible=icon]:hidden">
                <p className="font-medium text-sm">{user?.isAnonymous ? 'Anonymous User' : (user?.displayName || user?.email || 'User')}</p>
                <p className="text-xs text-muted-foreground">
                  {user?.isAnonymous ? `ID: ${user.uid.substring(0,6)}...` : user?.email}
                </p>
            </div>
          <ChevronUp className="w-4 h-4 ml-auto group-data-[collapsible=icon]:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 mb-2" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user?.isAnonymous ? 'Anonymous User' : (user?.displayName || user?.email || 'User')}</p>
            <p className="text-xs leading-none text-muted-foreground">
               {user?.isAnonymous ? `ID: ${user.uid}` : user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground pt-2">Preferences</DropdownMenuLabel>
          <div className="flex items-center justify-between px-2 py-2">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="ticker-toggle" className="text-sm font-medium cursor-pointer">Market Ticker</Label>
            </div>
            <Switch 
              id="ticker-toggle" 
              checked={settings.showTicker} 
              onCheckedChange={(checked) => updateSettings({ showTicker: checked })}
            />
          </div>
          
          {/* Admin Tools - mscott614@gmail.com ONLY */}
          {user?.email === 'mscott614@gmail.com' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-semibold text-blue-400 pt-2 flex items-center gap-1">
                Admin Utilities
              </DropdownMenuLabel>
              <DropdownMenuItem 
                onClick={handleAdminSync} 
                disabled={isRefreshing}
                className="cursor-pointer text-blue-400 focus:text-blue-300 focus:bg-blue-400/10"
              >
                <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
                <span>{isRefreshing ? 'Syncing Market...' : 'Force Global Sync'}</span>
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuItem disabled>
            <Settings className="mr-2 h-4 w-4" />
            <span>Advanced Settings</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
