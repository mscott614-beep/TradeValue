"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Bell, Plus, Trash2, ArrowLeft } from "lucide-react";
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase";
import { collection, addDoc, deleteDoc, doc, updateDoc } from "firebase/firestore";
import type { AlertConfig } from "@/lib/types";
import { toast } from "sonner";
import Link from "next/link";

export default function AlertsSetupPage() {
    const firestore = useFirestore();
    const { user } = useUser();
    const [isAdding, setIsAdding] = useState(false);

    // Form State
    const [targetType, setTargetType] = useState<AlertConfig['targetType']>('player');
    const [targetValue, setTargetValue] = useState("");
    const [condition, setCondition] = useState<AlertConfig['condition']>('above');
    const [threshold, setThreshold] = useState("");

    const alertsCollection = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return collection(firestore, `users/${user.uid}/alertsConfig`);
    }, [firestore, user]);

    const { data: alerts, isLoading } = useCollection<AlertConfig>(alertsCollection);

    const handleAddAlert = async () => {
        if (!alertsCollection) return;
        if (targetType !== 'portfolio' && !targetValue) {
            toast.error("Please enter a target value (e.g., Player Name)");
            return;
        }
        if (!threshold || isNaN(Number(threshold))) {
            toast.error("Please enter a valid number for the threshold");
            return;
        }

        setIsAdding(true);
        try {
            await addDoc(alertsCollection, {
                targetType,
                targetValue: targetType === 'portfolio' ? 'Entire Portfolio' : targetValue,
                condition,
                threshold: Number(threshold),
                isActive: true
            });
            toast.success("Alert configured successfully!");
            setTargetValue("");
            setThreshold("");
        } catch (error) {
            console.error("Error adding alert:", error);
            toast.error("Failed to save alert configuration.");
        } finally {
            setIsAdding(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!firestore || !user) return;
        try {
            await deleteDoc(doc(firestore, `users/${user.uid}/alertsConfig`, id));
            toast.success("Alert deleted.");
        } catch (error) {
            console.error("Error deleting alert:", error);
            toast.error("Failed to delete alert.");
        }
    };

    const handleToggle = async (id: string, currentStatus: boolean) => {
        if (!firestore || !user) return;
        try {
            await updateDoc(doc(firestore, `users/${user.uid}/alertsConfig`, id), {
                isActive: !currentStatus
            });
        } catch (error) {
            console.error("Error toggling alert:", error);
            toast.error("Failed to update alert status.");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/dashboard/alerts">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <PageHeader
                    title="Alert Configuration"
                    description="Set up custom triggers to monitor specific cards, players, or your entire portfolio."
                />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Plus className="h-5 w-5 text-primary" />
                            Create New Alert
                        </CardTitle>
                        <CardDescription>Define the logic for your market watchdog.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Target Type</Label>
                            <Select value={targetType} onValueChange={(val: any) => setTargetType(val)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select target..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="player">Specific Player</SelectItem>
                                    <SelectItem value="brand">Specific Brand/Set</SelectItem>
                                    <SelectItem value="card">Specific Card ID</SelectItem>
                                    <SelectItem value="portfolio">Entire Portfolio</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {targetType !== 'portfolio' && (
                            <div className="space-y-2">
                                <Label>Target Value</Label>
                                <Input
                                    placeholder={targetType === 'player' ? "e.g. Connor McDavid" : targetType === 'brand' ? "e.g. Upper Deck" : "Enter Card ID"}
                                    value={targetValue}
                                    onChange={(e) => setTargetValue(e.target.value)}
                                />
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Condition</Label>
                            <Select value={condition} onValueChange={(val: any) => setCondition(val)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select condition..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="above">Rises Above ($)</SelectItem>
                                    <SelectItem value="below">Drops Below ($)</SelectItem>
                                    <SelectItem value="rises_by_percent">Rises By (%)</SelectItem>
                                    <SelectItem value="drops_by_percent">Drops By (%)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Threshold {condition.includes('percent') ? '(%)' : '($)'}</Label>
                            <Input
                                type="number"
                                placeholder={condition.includes('percent') ? "15" : "500"}
                                value={threshold}
                                onChange={(e) => setThreshold(e.target.value)}
                            />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" onClick={handleAddAlert} disabled={isAdding}>
                            {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                            Save Alert Rule
                        </Button>
                    </CardFooter>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Bell className="h-5 w-5 text-primary" />
                            Active Alerts
                        </CardTitle>
                        <CardDescription>Manage your currently configured triggers.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex justify-center p-8">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : !alerts || alerts.length === 0 ? (
                            <div className="text-center p-8 border border-dashed rounded-lg bg-muted/30">
                                <p className="text-sm text-muted-foreground">No alerts configured yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {alerts.map(alert => (
                                    <div key={alert.id} className="flex flex-col gap-2 p-3 border rounded-lg bg-card shadow-sm">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-semibold text-sm">
                                                    {alert.targetType === 'portfolio' ? 'Portfolio' : alert.targetValue}
                                                </div>
                                                <div className="text-xs text-muted-foreground capitalize">
                                                    {alert.condition.replace(/_/g, ' ')} {alert.threshold}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Switch
                                                    checked={alert.isActive}
                                                    onCheckedChange={() => handleToggle(alert.id!, alert.isActive)}
                                                />
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(alert.id!)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
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
