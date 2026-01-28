import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Gamepad2, Grid3X3, Target, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FEATURE_FLAGS } from "@/config/featureFlags";

interface HighScore {
  id: string;
  user_id: string;
  game_type: string;
  score: number;
  created_at: string;
  profiles: {
    full_name: string | null;
    profile_photo_url: string | null;
  };
}

const Games = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  // Redirect if arcade is disabled
  useEffect(() => {
    if (!FEATURE_FLAGS.ARCADE_ENABLED) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  const fetchScores = async (gameType: string) => {
    const { data, error } = await supabase
      .from('game_high_scores')
      .select(`
        id,
        user_id,
        game_type,
        score,
        created_at,
        profiles(full_name, profile_photo_url)
      `)
      .eq('game_type', gameType)
      .order('score', { ascending: false })
      .limit(15);

    if (error) throw error;
    return data as HighScore[];
  };

  const { data: snakeScores, isLoading: snakeLoading } = useQuery({
    queryKey: ['high-scores', 'snake'],
    queryFn: () => fetchScores('snake'),
  });

  const { data: marcmanScores, isLoading: marcmanLoading } = useQuery({
    queryKey: ['high-scores', 'marcman'],
    queryFn: () => fetchScores('marcman'),
  });

  const { data: minesweeperScores, isLoading: minesweeperLoading } = useQuery({
    queryKey: ['high-scores', 'minesweeper'],
    queryFn: () => fetchScores('minesweeper'),
  });

  const { data: basketballScores, isLoading: basketballLoading } = useQuery({
    queryKey: ['high-scores', 'basketball'],
    queryFn: () => fetchScores('basketball'),
  });

  const { data: pizzaScores, isLoading: pizzaLoading } = useQuery({
    queryKey: ['high-scores', 'pizza'],
    queryFn: () => fetchScores('pizza'),
  });

  const renderLeaderboard = (scores: HighScore[] | undefined, loading: boolean) => {
    if (loading) {
      return (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      );
    }

    if (!scores || scores.length === 0) {
      return (
        <p className="text-muted-foreground text-center py-3 text-sm">
          No scores yet. Be the first!
        </p>
      );
    }

    const displayScores = expanded ? scores.slice(0, 15) : scores.slice(0, 5);
    const hasMore = scores.length > 5;

    return (
      <div className="space-y-1.5">
        {displayScores.map((score, index) => {
          const initials = score.profiles?.full_name
            ?.split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || '?';
          
          const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];
          
          return (
            <div
              key={score.id}
              className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/30"
            >
              <span className={`w-5 text-center font-bold text-sm ${index < 3 ? medalColors[index] : 'text-muted-foreground'}`}>
                {index + 1}
              </span>
              <Avatar className="h-6 w-6">
                <AvatarImage src={score.profiles?.profile_photo_url || ''} />
                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-sm font-medium">
                {score.profiles?.full_name || 'Unknown'}
              </span>
              <span className="text-xs font-semibold text-primary">
                {score.score.toLocaleString()}
              </span>
            </div>
          );
        })}
        
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                Show more ({Math.min(scores.length, 15) - 5} more)
              </>
            )}
          </Button>
        )}
      </div>
    );
  };

  const games = [
    {
      id: 'pizza',
      title: 'Super Karen Destroy 3',
      description: 'Defend your shop!',
      icon: Gamepad2,
      path: '/games/pizza',
      color: 'from-red-500/20 to-yellow-500/20',
      iconColor: 'text-red-500',
      emoji: '🍕',
    },
    {
      id: 'marcman',
      title: 'MarcMAN',
      description: 'Collect toppings!',
      icon: Gamepad2,
      path: '/games/marcman',
      color: 'from-yellow-500/20 to-amber-500/20',
      iconColor: 'text-yellow-500',
      emoji: '🤠',
    },
    {
      id: 'snake',
      title: 'Snake',
      description: 'Tap to turn!',
      icon: Gamepad2,
      path: '/games/snake',
      color: 'from-green-500/20 to-emerald-500/20',
      iconColor: 'text-green-500',
      emoji: '🐍',
    },
    {
      id: 'minesweeper',
      title: 'Minesweeper',
      description: 'Clear the board!',
      icon: Grid3X3,
      path: '/games/minesweeper',
      color: 'from-blue-500/20 to-cyan-500/20',
      iconColor: 'text-blue-500',
      emoji: '💣',
    },
    {
      id: 'basketball',
      title: 'Hoops',
      description: 'Shoot baskets!',
      icon: Target,
      path: '/games/basketball',
      color: 'from-orange-500/20 to-amber-500/20',
      iconColor: 'text-orange-500',
      emoji: '🏀',
    },
  ];

  return (
    <Layout>
      <div className="container max-w-md mx-auto px-3 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <Gamepad2 className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">Games</h1>
        </div>

        {/* Game Selection - Compact grid */}
        <div className="grid grid-cols-2 gap-2">
          {games.map((game) => (
            <Card
              key={game.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate(game.path)}
            >
              <CardContent className="p-3">
                <div className="flex flex-col items-center gap-1 text-center">
                  <div className={`p-2 rounded-xl bg-gradient-to-br ${game.color}`}>
                    <span className="text-2xl">{game.emoji}</span>
                  </div>
                  <h3 className="font-semibold text-sm leading-tight">{game.title}</h3>
                  <p className="text-[10px] text-muted-foreground">
                    {game.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Leaderboard */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <CardTitle className="text-base">Leaderboard</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <Tabs defaultValue="pizza" onValueChange={() => setExpanded(false)}>
              <TabsList className="w-full mb-2 h-8">
                <TabsTrigger value="pizza" className="flex-1 text-xs px-1">🍕</TabsTrigger>
                <TabsTrigger value="marcman" className="flex-1 text-xs px-1">🤠</TabsTrigger>
                <TabsTrigger value="snake" className="flex-1 text-xs px-1">🐍</TabsTrigger>
                <TabsTrigger value="minesweeper" className="flex-1 text-xs px-1">💣</TabsTrigger>
                <TabsTrigger value="basketball" className="flex-1 text-xs px-1">🏀</TabsTrigger>
              </TabsList>
              <TabsContent value="pizza" className="mt-0">
                {renderLeaderboard(pizzaScores, pizzaLoading)}
              </TabsContent>
              <TabsContent value="marcman" className="mt-0">
                {renderLeaderboard(marcmanScores, marcmanLoading)}
              </TabsContent>
              <TabsContent value="snake" className="mt-0">
                {renderLeaderboard(snakeScores, snakeLoading)}
              </TabsContent>
              <TabsContent value="minesweeper" className="mt-0">
                {renderLeaderboard(minesweeperScores, minesweeperLoading)}
              </TabsContent>
              <TabsContent value="basketball" className="mt-0">
                {renderLeaderboard(basketballScores, basketballLoading)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Games;
