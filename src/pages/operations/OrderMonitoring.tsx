import { OrderStatusSnapshots } from "@/components/dashboard/OrderStatusSnapshots";

const OrderMonitoring = () => {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Order Status Monitoring</h1>
        <p className="text-muted-foreground">Track order status snapshots and daily progress</p>
      </div>
      
      <OrderStatusSnapshots />
    </div>
  );
};

export default OrderMonitoring;
