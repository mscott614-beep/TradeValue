"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bell, TrendingUp, TrendingDown, AlertTriangle, Settings, RefreshCw, CheckCircle2, Trash2, CheckCheck } from "lucide-react";
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase";
import { collection, updateDoc, doc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";
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

    const metadataDocRef = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return doc(firestore, `users/${user.uid}/metadata/scanner`);
    }, [firestore, user]);

    const { data: cards, error: portfoliosError } = useCollection<Portfolio>(portfoliosCollection);
    const { data: configs, error: configsError } = useCollection<AlertConfig>(alertsConfigCollection);
    const { data: alerts, isLoading: loadingAlerts, error: alertsError } = useCollection<MarketAlert>(marketAlertsCollection);
    const { data: metadata, error: metadataError } = useDoc<any>(metadataDocRef);

    useEffect(() => {
        if (user) {
            console.log(`[AlertsPage] UID: ${user.uid}`);
            console.log(`[AlertsPage] Email: ${user.email}`);
            console.log(`[AlertsPage] Fetching: users/${user.uid}/marketAlerts`);
        }
    }, [user]);

    // Handle any fetch errors
    const [hasAttemptedInit, setHasAttemptedInit] = useState(false);
    const anyError = portfoliosError || configsError || alertsError || metadataError;

    // Heartbeat: Force-initialize the user document to "warm up" the permission rules
    useEffect(() => {
        if (user && firestore && !hasAttemptedInit) {
            const initUser = async () => {
                try {
                    await setDoc(doc(firestore, `users/${user.uid}`), {
                        lastSeen: new Date().toISOString(),
                        email: user.email
                    }, { merge: true });
                    console.log('[AlertsPage] Initialization Heartbeat Successful.');
                    setHasAttemptedInit(true);
                } catch (e) {
                    console.warn('[AlertsPage] Initialization Heartbeat Failed (expected for fresh auth):', e);
                }
            };
            initUser();
        }
    }, [user, firestore, hasAttemptedInit]);

    useEffect(() => {
        if (anyError) {
            const isPermissionError = anyError instanceof Error && 'code' in anyError && (anyError as any).code === 'permission-denied';
            
            console.warn('[AlertsPage] Firestore Sync Warning:', anyError);
            
            if (isPermissionError && !hasAttemptedInit) {
                // For new users, we don't want to spam toasts until they actually tray to run a scan
                console.log('[AlertsPage] Potential new user detected. Waiting for manual scan to initialize data.');
            } else if (isPermissionError) {
                toast.error("Access Restricted: Please perform a Hard Refresh (Ctrl+Shift+R) to sync your permissions.");
            }
        }
    }, [anyError, hasAttemptedInit]);

    // Sort alerts by timestamp descending (newest first)
    const sortedAlerts = alerts ? [...alerts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) : [];
    const unreadCount = sortedAlerts.filter(a => !a.read).length;

    const [scanType, setScanType] = useState<'standard' | 'deep'>('standard');

    const lastFullScan = metadata?.lastFullScan ? new Date(metadata.lastFullScan) : null;
    const isExempt = user?.email === 'mscott614@gmail.com';
    const canRunDeepScan = isExempt || !lastFullScan || (Date.now() - lastFullScan.getTime() > 24 * 60 * 60 * 1000);

    const handleRunScan = async () => {
        if (scanType === 'deep' && !canRunDeepScan) {
            const nextAvailable = new Date(lastFullScan!.getTime() + 24 * 60 * 60 * 1000);
            toast.error(`Deep Scan limit reached. Next available: ${nextAvailable.toLocaleTimeString()}`);
            return;
        }

        // Buffer for rule engine cluster propagation (essential for new user heartbeat sync)
        const delayPromise = new Promise(resolve => setTimeout(resolve, 2000));
        
        setIsScanning(true);
        const scanToast = toast.loading(scanType === 'deep' ? "Performing Deep Portfolio Scan... this may take 15-30s" : "Running Market Scan...");
        
        await delayPromise;

        try {
            const response = await runMarketScannerAction(
                user!.uid,
                scanType,
                user?.email || undefined
            );

            if (response.success && response.result && firestore && user) {
                const newAlerts = response.result.alerts;
                
                // If deep scan, update the limit metadata
                if (scanType === 'deep' && !isExempt) {
                    await setDoc(metadataDocRef!, { lastFullScan: new Date().toISOString() }, { merge: true });
                }

                if (newAlerts && newAlerts.length > 0) {
                    const batchPromises = newAlerts.map((alert: any) => {
                        const alertDocRef = doc(collection(firestore, `users/${user.uid}/marketAlerts`));
                        return setDoc(alertDocRef, {
                            ...alert,
                            timestamp: new Date().toISOString(),
                            read: false
                        });
                    });
                    await Promise.all(batchPromises);
                    toast.success(`Scan complete! Generated ${newAlerts.length} new insights.`, { id: scanToast });
                } else {
                    toast.info("Scan complete. No significant market movements detected.", { id: scanToast });
                }
            } else {
                toast.error(response.error || "Failed to run scan.", { id: scanToast });
            }
        } catch (error) {
            console.error(error);
            toast.error("An error occurred during the market scan.", { id: scanToast });
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
            toast.error("Failed to mark as read.");
        }
    };

    const handleMarkAllAsRead = async () => {
        if (!firestore || !user || !alerts) return;
        const unreadAlerts = alerts.filter(a => !a.read);
        if (unreadAlerts.length === 0) return;

        const markToast = toast.loading("Marking all as read...");
        try {
            const batch = writeBatch(firestore);
            unreadAlerts.forEach(alert => {
                const docRef = doc(firestore, `users/${user.uid}/marketAlerts`, alert.id!);
                batch.update(docRef, { read: true });
            });
            await batch.commit();
            toast.success("All alerts marked as read.", { id: markToast });
        } catch (error) {
            console.error("Failed to mark all as read:", error);
            toast.error("Failed to mark all as read.", { id: markToast });
        }
    };

    const handleDeleteAlert = async (id: string) => {
        if (!firestore || !user) return;
        try {
            await deleteDoc(doc(firestore, `users/${user.uid}/marketAlerts`, id));
            toast.success("Alert deleted.");
        } catch (error) {
            console.error("Failed to delete alert:", error);
            toast.error("Failed to delete alert.");
        }
    };

    const getAlertIcon = (type: string) => {
        switch (type) {
            case 'drop': return <TrendingDown className="w-5 h-5 text-green-500" />;
            case 'rise': return <TrendingUp className="w-5 h-5 text-blue-500" />;
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
                    <div className="flex bg-muted p-1 rounded-lg mr-2">
                        <button 
                            onClick={() => setScanType('standard')}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                scanType === 'standard' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            Standard
                        </button>
                        <button 
                            onClick={() => setScanType('deep')}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1",
                                scanType === 'deep' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                                !canRunDeepScan && scanType !== 'deep' ? "opacity-50 cursor-not-allowed" : ""
                            )}
                        >
                            Full Portfolio
                            {!canRunDeepScan && <Badge variant="outline" className="text-[10px] h-4 px-1 ml-1 opacity-70">1/day</Badge>}
                        </button>
                    </div>

                    <Link href="/dashboard/alerts/setup">
                        <Button variant="outline" size="sm">
                            <Settings className="w-4 h-4 mr-2" />
                            Rules
                        </Button>
                    </Link>
                    <Button onClick={handleRunScan} disabled={isScanning} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90">
                        {isScanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                        {scanType === 'deep' ? 'Run Deep Scan' : 'Run Market Scan'}
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
                        {unreadCount > 0 && (
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={handleMarkAllAsRead}
                                className="text-primary hover:text-primary/80 flex items-center gap-2"
                            >
                                <CheckCheck className="w-4 h-4" />
                                Mark all as Read
                            </Button>
                        )}
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
                                            "flex items-start gap-4 p-4 border rounded-lg transition-colors group relative",
                                            getAlertBackground(alert.type, alert.read)
                                        )}
                                    >
                                        <div className={cn("mt-1 p-2 rounded-full", alert.read ? "bg-muted" : "bg-background shadow-sm")}>
                                            {getAlertIcon(alert.type)}
                                        </div>
                                        <div className="flex-1 space-y-1 pr-8">
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
                                                    <Button variant="ghost" size="sm" className="h-8 text-xs font-semibold" onClick={() => handleMarkAsRead(alert.id!)}>
                                                        Mark as Read
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2"
                                            onClick={() => handleDeleteAlert(alert.id!)}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
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
