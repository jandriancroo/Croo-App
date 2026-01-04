import { Gamepad2, Grid3X3, Trophy, Target, Castle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SMACK_TALK_IMAGES } from "./SmackTalkPicker";

interface SmackTalkOverlay {
  text: string;
  senderName: string;
}

interface GameScoreMessageProps {
  gameType: string;
  score: number;
  playerName: string;
  smackTalks?: SmackTalkOverlay[];
}

export function GameScoreMessage({ gameType, score, playerName, smackTalks = [] }: GameScoreMessageProps) {
  const isSnake = gameType === 'snake';
  const isMinesweeper = gameType === 'minesweeper';
  const isBasketball = gameType === 'basketball';
  const isPizza = gameType === 'pizza';
  const isDungeon = gameType === 'karen-dungeon';
  
  const getGameConfig = () => {
    if (isSnake) return { icon: Gamepad2, color: 'bg-green-500/20', iconColor: 'text-green-500', name: 'Snake', emoji: '🐍' };
    if (isMinesweeper) return { icon: Grid3X3, color: 'bg-blue-500/20', iconColor: 'text-blue-500', name: 'Minesweeper', emoji: '💣' };
    if (isPizza) return { icon: Gamepad2, color: 'bg-red-500/20', iconColor: 'text-red-500', name: 'Super Karen Destroy 3', emoji: '👨‍🍳' };
    if (isDungeon) return { icon: Castle, color: 'bg-purple-500/20', iconColor: 'text-purple-500', name: 'Karen Dungeon 3D', emoji: '🏰' };
    return { icon: Target, color: 'bg-orange-500/20', iconColor: 'text-orange-500', name: 'Hoops', emoji: '🏀' };
  };

  const config = getGameConfig();
  const Icon = config.icon;

  // Get the most recent smack talk to display
  const latestSmackTalk = smackTalks.length > 0 ? smackTalks[smackTalks.length - 1] : null;
  const smackTalkImage = latestSmackTalk ? SMACK_TALK_IMAGES[latestSmackTalk.text] : null;
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20 max-w-[280px]">
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

      {/* Smack Talk Overlay */}
      {smackTalkImage && (
        <div 
          className="absolute -top-6 -right-6 w-20 h-20 animate-scale-in z-10"
          style={{
            filter: 'drop-shadow(2px 2px 4px rgba(0,0,0,0.3))',
            transform: 'rotate(12deg)',
          }}
        >
          <img 
            src={smackTalkImage} 
            alt={latestSmackTalk?.text}
            className="w-full h-full object-contain"
          />
          {smackTalks.length > 1 && (
            <span className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {smackTalks.length}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
