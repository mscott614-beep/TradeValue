"use client";

import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ShieldCheck, Mail, Calendar } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { triggerAdminMarketRefreshAction } from "@/app/actions/admin-actions";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const { user } = useUser();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isAdmin = user?.email === "mscott614@gmail.com";

  const handleManualRefresh = async () => {
    if (!isAdmin || !user?.email) return;

    setIsRefreshing(true);
    const toastId = toast.loading("Triggering global market refresh (8:00 AM Task)...");

    try {
      const result = await triggerAdminMarketRefreshAction(user.email);
      if (result.success) {
        toast.success(result.message, { id: toastId });
      } else {
        toast.error(result.error || "Failed to trigger refresh", { id: toastId });
      }
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred", { id: toastId });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account preferences and system utilities.</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
            <CardDescription>Details about your current session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 border border-slate-800">
               <div className="p-2 rounded-full bg-blue-500/10">
                 <Mail className="h-5 w-5 text-blue-400" />
               </div>
               <div>
                  <p className="text-sm font-medium text-slate-400">Email Address</p>
                  <p className="font-mono">{user?.email || "Guest User"}</p>
               </div>
               {isAdmin && (
                 <Badge variant="outline" className="ml-auto bg-blue-500/10 text-blue-400 border-blue-500/20">
                   Lead Data Architect
                 </Badge>
               )}
            </div>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card className="border-blue-500/20 bg-blue-500/5 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <ShieldCheck className="h-24 w-24 text-blue-400" />
            </div>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-400" />
                <CardTitle className="text-blue-400">Admin Utilities</CardTitle>
              </div>
              <CardDescription>
                Exclusive tools for managing the TradeValue engine.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-blue-500/20 mt-1">
                    <Calendar className="h-5 w-5 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-blue-200">Scheduled Market Refresh</p>
                    <p className="text-sm text-blue-300/70 mb-4">
                      This triggers the automated task that normally runs at **8:00 AM EST**. 
                      It will re-valuation EVERY card in the global database using the Lead Data Architect pricing engine.
                    </p>
                    <Button 
                      onClick={handleManualRefresh}
                      disabled={isRefreshing}
                      className="bg-blue-600 hover:bg-blue-500 text-white border-none shadow-lg shadow-blue-900/40"
                    >
                      <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
                      {isRefreshing ? "Refreshing Market..." : "Run Scheduled Sync Now"}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
