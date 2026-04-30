import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, BarChart3, ClipboardList, Settings, Truck } from "lucide-react";

const CarriersIndex = () => {
  const navigate = useNavigate();

  const options = [
    {
      title: "Documents",
      description: "Upload invoices and penalty notices. AI auto-extracts the line items.",
      icon: FileText,
      onClick: () => navigate("/operations/carriers/documents"),
      primary: true,
    },
    {
      title: "Penalties Dashboard",
      description: "Weekly cost trend, 4–6 week averages, breakdown by reason and SKU.",
      icon: BarChart3,
      onClick: () => navigate("/operations/carriers/penalties"),
    },
    {
      title: "Remeasure Queue",
      description: "Packer worklist for SKUs flagged by penalties — re-measure and update.",
      icon: ClipboardList,
      onClick: () => navigate("/operations/carriers/remeasure"),
    },
    {
      title: "Settings",
      description: "Carriers, reason codes, and packer assignments.",
      icon: Settings,
      onClick: () => navigate("/operations/carriers/settings"),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
          <Truck className="h-7 w-7 text-primary" />
          Carriers
        </h1>
        <p className="text-muted-foreground mt-1">
          Reduce courier penalty costs by surfacing mis-declared parcels and routing them to packers for re-measurement.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {options.map((option) => (
          <Card
            key={option.title}
            className={`cursor-pointer bg-card hover:border-primary/50 transition-all hover:shadow-lg group ${
              option.primary ? "border-primary/30" : ""
            }`}
            onClick={option.onClick}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <option.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-base">{option.title}</CardTitle>
              </div>
              <CardDescription className="text-xs">{option.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default CarriersIndex;
