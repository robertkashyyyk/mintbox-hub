import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";

interface ExceptionsData {
  rotten_increased: boolean;
  serious_increased: boolean;
  picking_not_cleared: boolean;
  backorders_rising_trend: boolean;
}

const EXCEPTIONS = [
  { key: 'rotten_increased', label: 'Rotten Increased', description: '30+ day backorders grew vs yesterday' },
  { key: 'serious_increased', label: 'Serious Increased', description: '14-29 day backorders grew vs yesterday' },
  { key: 'picking_not_cleared', label: 'Picking Not Cleared', description: 'Awaiting picking not reduced by PM' },
  { key: 'backorders_rising_trend', label: 'Backorders Rising', description: 'Total backorders flat or rising 3+ days' },
] as const;

export const OpsExceptionsCard = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops-exceptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ops_exceptions_today')
        .select('*')
        .maybeSingle();
      
      if (error) throw error;
      return data as ExceptionsData | null;
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Exceptions & Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Exceptions & Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No exception data available
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasAnyIssue = EXCEPTIONS.some((ex) => (data as any)[ex.key] === true);

  return (
    <Card className={hasAnyIssue ? 'border-destructive/50' : 'border-green-500/50'}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className={`h-5 w-5 ${hasAnyIssue ? 'text-destructive' : 'text-green-600'}`} />
          Exceptions & Alerts
        </CardTitle>
        <p className="text-sm text-muted-foreground">Focus engine — drives conversations</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {EXCEPTIONS.map((exception) => {
          const hasIssue = (data as any)[exception.key] === true;
          
          return (
            <div 
              key={exception.key}
              className={`flex items-center justify-between p-3 rounded-lg ${
                hasIssue ? 'bg-destructive/10' : 'bg-green-500/10'
              }`}
            >
              <div>
                <div className="font-medium">{exception.label}</div>
                <div className="text-sm text-muted-foreground">{exception.description}</div>
              </div>
              {hasIssue ? (
                <div className="flex items-center gap-2 text-destructive font-medium">
                  <XCircle className="h-5 w-5" />
                  Needs Attention
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600 font-medium">
                  <CheckCircle2 className="h-5 w-5" />
                  OK
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
