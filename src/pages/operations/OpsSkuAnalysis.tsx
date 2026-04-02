import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpsSkuAnalysis } from "@/hooks/useOpsSkuAnalysis";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { AlertTriangle, Package, Tag, Radio } from "lucide-react";
import { format } from "date-fns";

const OpsSkuAnalysis = () => {
  const { data, isLoading } = useOpsSkuAnalysis();

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SKU & Issue Analysis</h1>
          <p className="text-sm text-muted-foreground">Loading diagnostic data…</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">SKU & Issue Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Deeper diagnostics — top problem SKUs, backorder concentration, brand and channel breakdown
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Problem SKUs */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Top Problem SKUs
              <Badge variant="secondary" className="ml-auto">
                {data.skuIssues.length} SKUs with open issues
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.skuIssues.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">No open issues found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium text-muted-foreground">SKU</th>
                      <th className="text-left py-2 font-medium text-muted-foreground">Brand</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Issues</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Critical</th>
                      <th className="text-left py-2 font-medium text-muted-foreground">Problem Types</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Latest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.skuIssues.slice(0, 15).map((row) => (
                      <tr key={row.sku} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 font-mono text-xs">{row.sku}</td>
                        <td className="py-2">{row.brand_name}</td>
                        <td className="py-2 text-right font-semibold">{row.total_issues}</td>
                        <td className="py-2 text-right">
                          {row.critical_count > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {row.critical_count}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1 flex-wrap">
                            {row.problem_types.map((pt) => (
                              <Badge key={pt} variant="outline" className="text-[10px]">
                                {pt.replace(/_/g, " ")}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 text-right text-xs text-muted-foreground">
                          {row.latest_issue
                            ? format(new Date(row.latest_issue), "dd MMM HH:mm")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Backorder SKUs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Top Backorder SKUs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.backorderSkus.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">No backorders found</p>
            ) : (
              <div className="space-y-2">
                {data.backorderSkus.slice(0, 10).map((row) => (
                  <div
                    key={row.sku}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="font-mono text-xs">{row.sku}</p>
                      <p className="text-xs text-muted-foreground">{row.brand_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {row.order_count} order{row.order_count !== 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.avg_age_days}d avg age · {row.total_qty} units
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Brand Concentration */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Issue Concentration by Brand
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.brandConcentration.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">No brand data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={data.brandConcentration.slice(0, 10)}
                  layout="vertical"
                  margin={{ left: 80 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="brand_name"
                    tick={{ fontSize: 11 }}
                    width={75}
                  />
                  <Tooltip />
                  <Bar dataKey="issue_count" name="Issues" fill="hsl(var(--chart-1))" radius={[0, 2, 2, 0]}>
                    {data.brandConcentration.slice(0, 10).map((entry, index) => (
                      <Cell
                        key={index}
                        fill={
                          entry.critical_count > 0
                            ? "hsl(var(--destructive))"
                            : "hsl(var(--chart-1))"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Channel Breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4" />
              Active Orders by Channel
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.channelConcentration.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">No channel data</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {data.channelConcentration.map((ch) => (
                  <div
                    key={ch.channel}
                    className="text-center p-4 rounded-lg bg-secondary"
                  >
                    <p className="text-2xl font-bold">{ch.issue_count}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {ch.channel}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OpsSkuAnalysis;
