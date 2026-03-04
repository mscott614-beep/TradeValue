"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bell, TrendingUp, TrendingDown, AlertTriangle, Settings, RefreshCw, CheckCircle2 } from "lucide-react";
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase";
import { collection, updateDoc, doc, setDoc } from "firebase/firestore";
import type { AlertConfig, Portfolio, MarketAlert } from "@/lib/types";
import { runMarketScannerAction } from "@/app/actions/run-market-scanner";
import { toast } from "sonner";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function AlertsDashboardPage() {
    const firestore = useFirestore();
    const { user } = useUser();
    const [isScanning, setIsScanning] = useState(false);

    // Fetch necessary collections
    const portfoliosCollection = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return collection(firestore, `users/${user.uid}/portfolios`);
    }, [firestore, user]);

    const alertsConfigCollection = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return collection(firestore, `users/${user.uid}/alertsConfig`);
    }, [firestore, user]);

    const marketAlertsCollection = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return collection(firestore, `users/${user.uid}/marketAlerts`);
    }, [firestore, user]);

    const { data: cards } = useCollection<Portfolio>(portfoliosCollection);
    const { data: configs } = useCollection<AlertConfig>(alertsConfigCollection);
    const { data: alerts, isLoading: loadingAlerts } = useCollection<MarketAlert>(marketAlertsCollection);

    // Sort alerts by timestamp descending (newest first)
    const sortedAlerts = alerts ? [...alerts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) : [];
    const unreadCount = sortedAlerts.filter(a => !a.read).length;

    const handleRunScan = async () => {
        if (!cards || cards.length === 0) {
            toast.error("You need cards in your portfolio to run a scan.");
            return;
        }

        setIsScanning(true);
        try {
            const response = await runMarketScannerAction(cards, configs?.filter(c => c.isActive) || []);

            if (response.success && response.result && firestore && user) {
                const newAlerts = response.result.alerts;
                if (newAlerts && newAlerts.length > 0) {
                    // Save these new alerts to Firestore to persist them in the user's inbox
                    const batchPromises = newAlerts.map((alert: any) => {
                        const alertDocRef = doc(collection(firestore, `users/${user.uid}/marketAlerts`));
                        return setDoc(alertDocRef, {
                            ...alert,
                            timestamp: new Date().toISOString(),
                            read: false
                        });
                    });
                    await Promise.all(batchPromises);
                    toast.success(`Scan complete! Generated ${newAlerts.length} new insights.`);
                } else {
                    toast.info("Scan complete. No significant market movements detected.");
                }
            } else {
                toast.error("Failed to run scan.");
            }
        } catch (error) {
            console.error(error);
            toast.error("An error occurred during the market scan.");
        } finally {
            setIsScanning(false);
        }
    };

    const handleMarkAsRead = async (id: string) => {
        if (!firestore || !user) return;
        try {
            await updateDoc(doc(firestore, `users/${user.uid}/marketAlerts`, id), { read: true });
        } catch (error) {
            console.error("Failed to mark as read:", error);
        }
    };

    const getAlertIcon = (type: string) => {
        switch (type) {
            case 'drop': return <TrendingDown className="w-5 h-5 text-green-500" />; // Drop is a buying op
            case 'rise': return <TrendingUp className="w-5 h-5 text-blue-500" />; // Rise is a selling op
            case 'optimal_sell': return <CheckCircle2 className="w-5 h-5 text-purple-500" />;
            case 'red_flag': return <AlertTriangle className="w-5 h-5 text-red-500" />;
            default: return <Bell className="w-5 h-5 text-primary" />;
        }
    };

    const getAlertBackground = (type: string, read: boolean) => {
        if (read) return "bg-card opacity-75";

        switch (type) {
            case 'drop': return "bg-green-500/10 border-green-500/30";
            case 'rise': return "bg-blue-500/10 border-blue-500/30";
            case 'optimal_sell': return "bg-purple-500/10 border-purple-500/30";
            case 'red_flag': return "bg-red-500/10 border-red-500/30";
            default: return "bg-card";
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <PageHeader
                    title="Smart Notifications"
                    description="Your AI-curated inbox for market movements, buying opportunities, and risk alerts."
                />
                <div className="flex items-center gap-3">
                    <Link href="/dashboard/alerts/setup">
                        <Button variant="outline">
                            <Settings className="w-4 h-4 mr-2" />
                            Configure Rules
                        </Button>
                    </Link>
                    <Button onClick={handleRunScan} disabled={isScanning} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90">
                        {isScanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                        Run Market Scan
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-4">
                <Card className="md:col-span-1 border-dashed bg-muted/30">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-sm">Active Rules</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{configs?.filter(c => c.isActive).length || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Watching your portfolio</p>
                    </CardContent>
                </Card>

                <Card className="md:col-span-3">
                    <CardHeader className="flex flex-row items-center justify-between pb-4">
                        <div>
                            <CardTitle>Alert Inbox</CardTitle>
                            <CardDescription>
                                {unreadCount > 0 ? `You have ${unreadCount} unread market notifications.` : "You're all caught up."}
                            </CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingAlerts ? (
                            <div className="flex justify-center p-12">
                                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : sortedAlerts.length === 0 ? (
                            <div className="text-center p-12 border border-dashed rounded-lg bg-muted/10">
                                <Bell className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                                <h3 className="font-semibold mb-2">Inbox Empty</h3>
                                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                    Run a market scan or set up custom rules to start receiving proactive alerts about your collection.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {sortedAlerts.map(alert => (
                                    <div
                                        key={alert.id}
                                        className={cn(
                                            "flex items-start gap-4 p-4 border rounded-lg transition-colors",
                                            getAlertBackground(alert.type, alert.read)
                                        )}
                                    >
                                        <div className={cn("mt-1 p-2 rounded-full", alert.read ? "bg-muted" : "bg-background shadow-sm")}>
                                            {getAlertIcon(alert.type)}
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <div className="flex justify-between items-start">
                                                <h4 className={cn("font-semibold text-sm", alert.read ? "text-muted-foreground" : "")}>
                                                    {alert.title}
                                                </h4>
                                                <span className="text-xs text-muted-foreground ml-4 shrink-0">
                                                    {new Date(alert.timestamp).toLocaleDateString()}
                                                </span>
                                            </div>
                                            <p className={cn("text-sm", alert.read ? "text-muted-foreground" : "text-foreground")}>
                                                {alert.message}
                                            </p>

                                            {!alert.read && (
                                                <div className="pt-2 flex justify-end">
                                                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => handleMarkAsRead(alert.id!)}>
                                                        Mark as Read
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
