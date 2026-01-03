import { Gamepad2, Grid3X3, Trophy, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface GameScoreMessageProps {
  gameType: string;
  score: number;
  playerName: string;
}

export function GameScoreMessage({ gameType, score, playerName }: GameScoreMessageProps) {
  const isSnake = gameType === 'snake';
  const isMinesweeper = gameType === 'minesweeper';
  const isBasketball = gameType === 'basketball';
  
  const getGameConfig = () => {
    if (isSnake) return { icon: Gamepad2, color: 'bg-green-500/20', iconColor: 'text-green-500', name: 'Snake', emoji: '🐍' };
    if (isMinesweeper) return { icon: Grid3X3, color: 'bg-blue-500/20', iconColor: 'text-blue-500', name: 'Minesweeper', emoji: '💣' };
    return { icon: Target, color: 'bg-orange-500/20', iconColor: 'text-orange-500', name: 'Hoops', emoji: '🏀' };
  };

  const config = getGameConfig();
  const Icon = config.icon;
  
  return (
    <Card className="overflow-hidden bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20 max-w-[280px]">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${config.color}`}>
            <Icon className={`h-6 w-6 ${config.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <span className="font-semibold text-sm">
                {config.name} {config.emoji}
              </span>
            </div>
            <p className="text-lg font-bold text-primary">
              {score.toLocaleString()} pts
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {playerName} just scored!
        </p>
      </CardContent>
    </Card>
  );
}
