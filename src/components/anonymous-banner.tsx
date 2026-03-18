'use client';

import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { AlertCircle, UserPlus } from "lucide-react";
import Link from "next/link";

export function AnonymousBanner() {
  const { user } = useUser();

  if (!user || !user.isAnonymous) {
    return null;
  }

  return (
    <div className="bg-sky-500/10 border-b border-sky-500/20 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-sky-500/20 p-2 rounded-full">
            <AlertCircle className="h-4 w-4 text-sky-400" />
          </div>
          <p className="text-sm text-slate-300">
            <span className="font-semibold text-white">Guest Mode Active.</span> Create a full account to save your collection permanently and unlock unlimited scans.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" className="text-xs h-8 border-slate-700 bg-slate-800 hover:bg-slate-700" asChild>
            <Link href="/login">Dismiss</Link>
          </Button>
          <Button size="sm" className="text-xs h-8 bg-sky-500 hover:bg-sky-600 text-white border-0" asChild>
            <Link href="/login" className="flex items-center gap-1">
              <UserPlus className="h-3 w-3" /> Sign Up
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
