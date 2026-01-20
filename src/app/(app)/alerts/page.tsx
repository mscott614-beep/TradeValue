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
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MoreHorizontal, BellPlus } from "lucide-react";
import { alerts } from "@/lib/data";

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        title="Price Alerts"
        description="Get notified when a card's market value hits your target price."
        action={
          <Button>
            <BellPlus className="mr-2 h-4 w-4" />
            Create Alert
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Active Alerts</CardTitle>
          <CardDescription>
            You will be notified when these conditions are met.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    <span className="font-semibold text-primary">{alert.type}</span>{" "}
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(alert.targetPrice)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch defaultChecked={alert.active} id={`alert-status-${alert.id}`} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
