import { OrderStatusSnapshots } from "@/components/dashboard/OrderStatusSnapshots";
import { BackorderAgeingSnapshot } from "@/components/dashboard/BackorderAgeingSnapshot";

const OrderMonitoring = () => {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Order Status Monitoring</h1>
        <p className="text-muted-foreground">Track order status snapshots and daily progress</p>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2">
        <OrderStatusSnapshots />
        <BackorderAgeingSnapshot />
      </div>
    </div>
  );
};

export default OrderMonitoring;
