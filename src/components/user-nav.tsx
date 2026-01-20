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
import { ChevronUp, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export function UserNav() {
  const { user } = useUser();
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
          <DropdownMenuItem disabled>Profile</DropdownMenuItem>
          <DropdownMenuItem disabled>Settings</DropdownMenuItem>
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
