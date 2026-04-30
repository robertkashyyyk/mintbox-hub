import { OrderStatusSnapshots } from "@/components/dashboard/OrderStatusSnapshots";
import { BackorderAgeingSnapshot } from "@/components/dashboard/BackorderAgeingSnapshot";
import { SnapshotControls } from "@/components/operations/SnapshotControls";

const OrderMonitoring = () => {
  return (
    <div className="space-y-8">
      <div>
      <h1 className="text-2xl font-bold text-foreground">Order Status Monitoring</h1>
        <p className="text-foreground/60">Track order status snapshots and daily progress</p>
      </div>

      <SnapshotControls />
      
      <div className="grid gap-6 md:grid-cols-2">
        <OrderStatusSnapshots />
        <BackorderAgeingSnapshot />
      </div>
    </div>
  );
};

export default OrderMonitoring;
