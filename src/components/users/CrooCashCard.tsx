import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Banknote, TrendingDown, TrendingUp, Calendar } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CrooCashCardProps {
  userId: string;
  balance: number;
}

interface Transaction {
  id: string;
  amount: number;
  transaction_type: string;
  shift_date: string;
  is_weekend: boolean;
  created_at: string;
  notes: string | null;
}

export function CrooCashCard({ userId, balance }: CrooCashCardProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransactions();
  }, [userId]);

  const fetchTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from("croo_cash_transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error("Error fetching Croo Cash transactions:", error);
    } finally {
      setLoading(false);
    }
  };

  const getBalanceColor = () => {
    if (balance > 5) return "text-green-600 dark:text-green-400";
    if (balance < 0) return "text-red-600 dark:text-red-400";
    return "text-yellow-600 dark:text-yellow-400";
  };

  const getTransactionIcon = (type: string) => {
    return type === "take_shift" ? (
      <TrendingUp className="h-4 w-4 text-green-500" />
    ) : (
      <TrendingDown className="h-4 w-4 text-red-500" />
    );
  };

  return (
    <Card className="relative overflow-hidden">
      {/* Comic-style background decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <text x="50" y="50" fontSize="60" textAnchor="middle" dominantBaseline="middle" fill="currentColor" transform="rotate(-15 50 50)">
            💰
          </text>
        </svg>
      </div>
      
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-primary animate-pulse" />
          Croo Cash
        </CardTitle>
        <CardDescription>Your shift marketplace currency</CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Balance Display */}
        <div className="flex items-center justify-center py-6 relative">
          <div className="text-center">
            <div className={`text-6xl font-black ${getBalanceColor()} comic-style`} style={{
              textShadow: '3px 3px 0px rgba(0,0,0,0.1)',
              fontFamily: 'Comic Sans MS, cursive'
            }}>
              {balance}
            </div>
            <div className="text-sm text-muted-foreground mt-2 uppercase tracking-wider font-bold">
              Current Balance
            </div>
          </div>
          
          {/* Fun badges based on balance */}
          {balance > 10 && (
            <div className="absolute -top-2 -right-2">
              <Badge className="bg-yellow-500 text-white animate-bounce shadow-lg" style={{
                transform: 'rotate(15deg)',
                fontFamily: 'Comic Sans MS, cursive'
              }}>
                🌟 Star!
              </Badge>
            </div>
          )}
          {balance < -5 && (
            <div className="absolute -top-2 -right-2">
              <Badge variant="destructive" className="animate-pulse shadow-lg" style={{
                transform: 'rotate(-15deg)',
                fontFamily: 'Comic Sans MS, cursive'
              }}>
                😅 Oops!
              </Badge>
            </div>
          )}
        </div>

        {/* Transaction History */}
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Recent Activity
          </h4>
          
          <ScrollArea className="h-[200px]">
            {loading ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                Loading transactions...
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                No transactions yet
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {getTransactionIcon(transaction.transaction_type)}
                      <div>
                        <div className="text-sm font-medium">
                          {transaction.transaction_type === "take_shift" ? "Claimed Shift" : "Offered Shift"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(transaction.shift_date).toLocaleDateString()}
                          {transaction.is_weekend && " 🎉 Weekend"}
                        </div>
                      </div>
                    </div>
                    <div className={`text-lg font-bold ${transaction.amount > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} style={{
                      fontFamily: 'Comic Sans MS, cursive'
                    }}>
                      {transaction.amount > 0 ? '+' : ''}{transaction.amount}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Info Box */}
        <div className="bg-primary/10 p-3 rounded-lg text-xs space-y-1">
          <p className="font-semibold">💡 How it works:</p>
          <p>• Offer up a shift: <strong>-1 Croo Cash</strong></p>
          <p>• Take a shift: <strong>+1 Croo Cash</strong></p>
          <p>• Friday/Saturday: <strong>2x points!</strong></p>
        </div>
      </CardContent>
    </Card>
  );
}
