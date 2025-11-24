import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { DollarSign, TrendingUp, Calendar, Clock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type SalesData = {
  hourly: Array<{ hour: string; sales: number }>;
  daily: number;
  weekly: number;
};

export default function Sales() {
  const { toast } = useToast();
  const [period, setPeriod] = useState("today");

  const { data: salesData, isLoading, refetch } = useQuery({
    queryKey: ["qubeyond-sales", period],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
        body: { period },
      });

      if (error) {
        console.error("Error fetching sales data:", error);
        toast({
          title: "Error",
          description: "Failed to fetch sales data from QuBeyond",
          variant: "destructive",
        });
        throw error;
      }

      return data as SalesData;
    },
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sales Dashboard</h1>
            <p className="text-muted-foreground">QuBeyond POS Integration</p>
          </div>
          <Button onClick={() => refetch()} disabled={isLoading}>
            Refresh Data
          </Button>
        </div>
        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Today's Sales</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {salesData ? formatCurrency(salesData.daily) : "--"}
              </div>
              <p className="text-xs text-muted-foreground">Current day total</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Weekly Sales</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {salesData ? formatCurrency(salesData.weekly) : "--"}
              </div>
              <p className="text-xs text-muted-foreground">This week's total</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Average per Hour</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {salesData
                  ? formatCurrency(
                      salesData.hourly.reduce((sum, h) => sum + h.sales, 0) /
                        salesData.hourly.length
                    )
                  : "--"}
              </div>
              <p className="text-xs text-muted-foreground">Based on today</p>
            </CardContent>
          </Card>
        </div>

        {/* Hourly Sales Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Hourly Sales Breakdown</CardTitle>
            <CardDescription>Sales performance by hour</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                Loading sales data...
              </div>
            ) : salesData?.hourly ? (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={salesData.hourly}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="hour" 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--foreground))' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--foreground))' }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(value as number)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                    }}
                  />
                  <Bar 
                    dataKey="sales" 
                    fill="hsl(var(--primary))" 
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                No sales data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
