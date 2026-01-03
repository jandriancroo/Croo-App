import { Layout } from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Gamepad2, Grid3X3, Target, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

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

  const { data: snakeScores, isLoading: snakeLoading } = useQuery({
    queryKey: ['high-scores', 'snake'],
    queryFn: async () => {
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
        .eq('game_type', 'snake')
        .order('score', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as HighScore[];
    },
  });

  const { data: minesweeperScores, isLoading: minesweeperLoading } = useQuery({
    queryKey: ['high-scores', 'minesweeper'],
    queryFn: async () => {
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
        .eq('game_type', 'minesweeper')
        .order('score', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as HighScore[];
    },
  });

  const { data: basketballScores, isLoading: basketballLoading } = useQuery({
    queryKey: ['high-scores', 'basketball'],
    queryFn: async () => {
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
        .eq('game_type', 'basketball')
        .order('score', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as HighScore[];
    },
  });

  const { data: pizzaScores, isLoading: pizzaLoading } = useQuery({
    queryKey: ['high-scores', 'pizza'],
    queryFn: async () => {
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
        .eq('game_type', 'pizza')
        .order('score', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as HighScore[];
    },
  });

  const renderLeaderboard = (scores: HighScore[] | undefined, loading: boolean, scoreLabel: string) => {
    if (loading) {
      return (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      );
    }

    if (!scores || scores.length === 0) {
      return (
        <p className="text-muted-foreground text-center py-4">
          No scores yet. Be the first!
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {scores.map((score, index) => {
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
              className="flex items-center gap-3 p-2 rounded-lg bg-muted/30"
            >
              <span className={`w-6 text-center font-bold ${index < 3 ? medalColors[index] : 'text-muted-foreground'}`}>
                {index + 1}
              </span>
              <Avatar className="h-8 w-8">
                <AvatarImage src={score.profiles?.profile_photo_url || ''} />
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate font-medium">
                {score.profiles?.full_name || 'Unknown'}
              </span>
              <span className="text-sm font-semibold text-primary">
                {score.score.toLocaleString()} {scoreLabel}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const games = [
    {
      id: 'snake',
      title: 'Snake',
      description: 'Tap to turn! Eat food and grow longer.',
      icon: Gamepad2,
      path: '/games/snake',
      color: 'from-green-500/20 to-emerald-500/20',
      iconColor: 'text-green-500',
      emoji: '🐍',
    },
    {
      id: 'minesweeper',
      title: 'Minesweeper',
      description: 'Clear the board without hitting mines.',
      icon: Grid3X3,
      path: '/games/minesweeper',
      color: 'from-blue-500/20 to-cyan-500/20',
      iconColor: 'text-blue-500',
      emoji: '💣',
    },
    {
      id: 'basketball',
      title: 'Hoops',
      description: 'Shoot baskets and build streaks!',
      icon: Target,
      path: '/games/basketball',
      color: 'from-orange-500/20 to-amber-500/20',
      iconColor: 'text-orange-500',
      emoji: '🏀',
    },
    {
      id: 'pizza',
      title: 'Pizza Paddle',
      description: 'Jump and hit pizza toppings!',
      icon: Gamepad2,
      path: '/games/pizza',
      color: 'from-red-500/20 to-yellow-500/20',
      iconColor: 'text-red-500',
      emoji: '🍕',
    },
  ];

  return (
    <Layout>
      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Gamepad2 className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold">Games</h1>
        </div>

        {/* Leaderboard */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              <CardTitle className="text-lg">Leaderboard</CardTitle>
            </div>
            <CardDescription>Top scores from the team</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="snake">
              <TabsList className="w-full mb-4">
                <TabsTrigger value="snake" className="flex-1 text-xs">🐍</TabsTrigger>
                <TabsTrigger value="minesweeper" className="flex-1 text-xs">💣</TabsTrigger>
                <TabsTrigger value="basketball" className="flex-1 text-xs">🏀</TabsTrigger>
                <TabsTrigger value="pizza" className="flex-1 text-xs">🍕</TabsTrigger>
              </TabsList>
              <TabsContent value="snake">
                {renderLeaderboard(snakeScores, snakeLoading, 'pts')}
              </TabsContent>
              <TabsContent value="minesweeper">
                {renderLeaderboard(minesweeperScores, minesweeperLoading, 'pts')}
              </TabsContent>
              <TabsContent value="basketball">
                {renderLeaderboard(basketballScores, basketballLoading, 'pts')}
              </TabsContent>
              <TabsContent value="pizza">
                {renderLeaderboard(pizzaScores, pizzaLoading, 'pts')}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Game Selection */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Choose a Game</h2>
          <div className="grid gap-3">
            {games.map((game) => {
              const Icon = game.icon;
              return (
                <Card
                  key={game.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(game.path)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-xl bg-gradient-to-br ${game.color}`}>
                        <span className="text-2xl">{game.emoji}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg">{game.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {game.description}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Games;
