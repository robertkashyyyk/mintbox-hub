import { OrderStatusSnapshots } from "@/components/dashboard/OrderStatusSnapshots";
import { BackorderAgeingSnapshot } from "@/components/dashboard/BackorderAgeingSnapshot";
import { SnapshotControls } from "@/components/operations/SnapshotControls";
import ModuleHeader from "@/components/ModuleHeader";
import { Activity } from "lucide-react";

const OrderMonitoring = () => {
  return (
    <div className="space-y-8">
      <ModuleHeader
        title="Order Status Monitoring"
        description="Track order status snapshots and daily progress."
        icon={Activity}
      />

      <SnapshotControls />
      
      <div className="grid gap-6 md:grid-cols-2">
        <OrderStatusSnapshots />
        <BackorderAgeingSnapshot />
      </div>
    </div>
  );
};

export default OrderMonitoring;
