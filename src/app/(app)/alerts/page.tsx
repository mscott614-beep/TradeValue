"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { BellPlus, Loader2, MoreHorizontal, Trash2, Bell } from "lucide-react";
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import type { PriceAlert } from "@/lib/types";
import { toast } from "sonner";

export default function AlertsPage() {
  const firestore = useFirestore();
  const { user } = useUser();

  const [open, setOpen] = useState(false);
  const [cardTitle, setCardTitle] = useState("");
  const [alertType, setAlertType] = useState<"above" | "below">("above");
  const [targetPrice, setTargetPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const alertsCollection = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return collection(firestore, `users/${user.uid}/priceAlerts`);
  }, [firestore, user]);

  const { data: alerts, isLoading } = useCollection<PriceAlert>(alertsCollection);

  const handleCreate = async () => {
    if (!cardTitle.trim()) { toast.error("Card name is required."); return; }
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) { toast.error("Enter a valid target price."); return; }
    if (!firestore || !user) return;

    setSaving(true);
    try {
      await addDoc(collection(firestore, `users/${user.uid}/priceAlerts`), {
        cardTitle: cardTitle.trim(),
        type: alertType,
        targetPrice: price,
        active: true,
        createdAt: new Date().toISOString(),
      });
      toast.success("Alert created!");
      setCardTitle("");
      setTargetPrice("");
      setAlertType("above");
      setOpen(false);
    } catch (e) {
      toast.error("Failed to create alert.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    if (!firestore || !user) return;
    try {
      await updateDoc(doc(firestore, `users/${user.uid}/priceAlerts`, id), { active: !current });
    } catch {
      toast.error("Failed to update alert.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!firestore || !user) return;
    try {
      await deleteDoc(doc(firestore, `users/${user.uid}/priceAlerts`, id));
      toast.success("Alert deleted.");
    } catch {
      toast.error("Failed to delete alert.");
    }
  };

  return (
    <>
      <PageHeader
        title="Price Alerts"
        description="Get notified when a card's market value hits your target price."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <BellPlus className="mr-2 h-4 w-4" />
                Create Alert
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>New Price Alert</DialogTitle>
                <DialogDescription>
                  Set a target price for a card. You'll be notified when it's reached.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="card-title">Card Name</Label>
                  <Input
                    id="card-title"
                    placeholder="e.g. 2015 UD Young Guns Connor McDavid"
                    value={cardTitle}
                    onChange={(e) => setCardTitle(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Condition</Label>
                    <Select value={alertType} onValueChange={(v) => setAlertType(v as "above" | "below")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="above">Price rises above</SelectItem>
                        <SelectItem value="below">Price drops below</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="target-price">Target Price (USD)</Label>
                    <Input
                      id="target-price"
                      type="number"
                      placeholder="e.g. 3500"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Alert
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Active Alerts</CardTitle>
          <CardDescription>You will be notified when these conditions are met.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !alerts || alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed rounded-lg bg-muted/10">
              <Bell className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold mb-2">No Alerts Yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Create your first price alert to track when a card hits your target price.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Card</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell className="font-medium">{alert.cardTitle}</TableCell>
                    <TableCell>
                      Price is{" "}
                      <Badge variant="outline" className={alert.type === "above" ? "border-green-500/40 text-green-500" : "border-orange-500/40 text-orange-400"}>
                        {alert.type}
                      </Badge>{" "}
                      <span className="font-semibold">
                        {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(alert.targetPrice)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={alert.active}
                        onCheckedChange={() => handleToggle(alert.id!, alert.active)}
                        id={`alert-status-${alert.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(alert.id!)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
