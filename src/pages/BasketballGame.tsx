import { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, RotateCcw, Trophy, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ShareScoreDialog } from "@/components/games/ShareScoreDialog";

const GAME_DURATION = 30; // seconds
const GRAVITY = 0.5;
const INITIAL_VELOCITY = 15;

interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  scored: boolean;
  missed: boolean;
}

const BasketballGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [highScore, setHighScore] = useState(0);
  const [balls, setBalls] = useState<Ball[]>([]);
  const [ballIdCounter, setBallIdCounter] = useState(0);
  const [hoopX, setHoopX] = useState(50);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 350, height: 500 });
  const [showSwish, setShowSwish] = useState(false);

  // Calculate dimensions
  useEffect(() => {
    const updateDimensions = () => {
      const maxWidth = Math.min(window.innerWidth - 32, 400);
      const maxHeight = window.innerHeight - 220;
      setDimensions({ width: maxWidth, height: Math.min(maxHeight, 550) });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Hoop position (percentage based)
  const hoopY = dimensions.height * 0.15;
  const hoopWidth = 60;
  const rimY = hoopY + 20;

  // Start game
  const startGame = useCallback(() => {
    setScore(0);
    setStreak(0);
    setTimeLeft(GAME_DURATION);
    setBalls([]);
    setBallIdCounter(0);
    setHoopX(50);
    setGameState('playing');
  }, []);

  // Handle shoot
  const handleShoot = useCallback((clientX: number, clientY: number) => {
    if (gameState !== 'playing' || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Only shoot from bottom half
    if (y < dimensions.height * 0.5) return;

    // Calculate trajectory to aim towards hoop
    const targetX = (hoopX / 100) * dimensions.width;
    const targetY = rimY;
    
    const dx = targetX - x;
    const dy = targetY - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Add some randomness and power based on distance
    const power = Math.min(1.2, Math.max(0.7, distance / 300));
    const angle = Math.atan2(dy, dx);
    
    const vx = Math.cos(angle) * INITIAL_VELOCITY * power + (Math.random() - 0.5) * 2;
    const vy = Math.sin(angle) * INITIAL_VELOCITY * power;

    const newBall: Ball = {
      id: ballIdCounter,
      x,
      y,
      vx,
      vy,
      scored: false,
      missed: false,
    };

    setBalls(prev => [...prev, newBall]);
    setBallIdCounter(prev => prev + 1);
  }, [gameState, hoopX, dimensions, ballIdCounter, rimY]);

  // Physics update
  useEffect(() => {
    if (gameState !== 'playing') return;

    const update = () => {
      setBalls(prevBalls => {
        const hoopCenterX = (hoopX / 100) * dimensions.width;
        const hoopLeft = hoopCenterX - hoopWidth / 2;
        const hoopRight = hoopCenterX + hoopWidth / 2;

        return prevBalls.map(ball => {
          if (ball.scored || ball.missed) return ball;

          let { x, y, vx, vy } = ball;
          
          // Apply physics
          vy += GRAVITY;
          x += vx;
          y += vy;

          // Check for scoring (ball passes through hoop from above)
          const wasAboveRim = ball.y < rimY;
          const isNowBelowRim = y >= rimY && y < rimY + 30;
          const isInHoopX = x > hoopLeft + 10 && x < hoopRight - 10;

          if (wasAboveRim && isNowBelowRim && isInHoopX && vy > 0) {
            // Scored!
            setStreak(prev => prev + 1);
            const multiplier = Math.min(5, 1 + Math.floor(streak / 3));
            const points = 2 * multiplier;
            setScore(prev => prev + points);
            setShowSwish(true);
            setTimeout(() => setShowSwish(false), 500);
            
            // Move hoop after score
            setHoopX(20 + Math.random() * 60);
            
            return { ...ball, x, y, vx, vy, scored: true };
          }

          // Check for miss (out of bounds)
          if (y > dimensions.height + 50 || x < -50 || x > dimensions.width + 50) {
            setStreak(0);
            return { ...ball, x, y, vx, vy, missed: true };
          }

          // Bounce off walls
          if (x < 15) {
            x = 15;
            vx = -vx * 0.6;
          }
          if (x > dimensions.width - 15) {
            x = dimensions.width - 15;
            vx = -vx * 0.6;
          }

          // Bounce off rim
          const distToLeftRim = Math.sqrt((x - hoopLeft) ** 2 + (y - rimY) ** 2);
          const distToRightRim = Math.sqrt((x - hoopRight) ** 2 + (y - rimY) ** 2);
          
          if (distToLeftRim < 20 || distToRightRim < 20) {
            if (distToLeftRim < 20) {
              vx = -Math.abs(vx) * 0.5 - 2;
            } else {
              vx = Math.abs(vx) * 0.5 + 2;
            }
            vy = -vy * 0.5;
          }

          return { ...ball, x, y, vx, vy };
        }).filter(ball => !ball.missed || ball.y < dimensions.height + 100);
      });

      animationRef.current = requestAnimationFrame(update);
    };

    animationRef.current = requestAnimationFrame(update);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [gameState, hoopX, dimensions, streak, rimY]);

  // Timer
  useEffect(() => {
    if (gameState !== 'playing') return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setGameState('gameover');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState]);

  // Save score
  useEffect(() => {
    if (gameState === 'gameover' && score > 0 && user?.id) {
      const saveScore = async () => {
        try {
          await supabase.from('game_high_scores').insert({
            user_id: user.id,
            game_type: 'basketball',
            score,
          });
          queryClient.invalidateQueries({ queryKey: ['high-scores', 'basketball'] });
          
          if (score > highScore) {
            setHighScore(score);
            toast.success(`New personal best: ${score}!`);
          }
        } catch (error) {
          console.error('Failed to save score:', error);
        }
      };
      saveScore();
    }
  }, [gameState, score, user?.id, highScore, queryClient]);

  // Fetch high score
  useEffect(() => {
    const fetchHighScore = async () => {
      if (!user?.id) return;
      
      const { data } = await supabase
        .from('game_high_scores')
        .select('score')
        .eq('user_id', user.id)
        .eq('game_type', 'basketball')
        .order('score', { ascending: false })
        .limit(1)
        .single();
      
      if (data) setHighScore(data.score);
    };
    fetchHighScore();
  }, [user?.id]);

  const hoopCenterX = (hoopX / 100) * dimensions.width;

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] px-4 py-2">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold flex-1">Hoops</h1>
          <div className="flex items-center gap-4">
            {gameState === 'playing' && (
              <>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{score}</p>
                </div>
                <div className="text-center">
                  <p className={`text-xl font-mono ${timeLeft <= 5 ? 'text-destructive' : ''}`}>
                    {timeLeft}s
                  </p>
                </div>
              </>
            )}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <span>{highScore}</span>
            </div>
          </div>
        </div>

        {/* Streak indicator */}
        {gameState === 'playing' && streak > 0 && (
          <div className="text-center mb-1">
            <span className="text-sm font-bold text-orange-500">
              🔥 {streak} streak! {streak >= 3 ? `(${Math.min(5, 1 + Math.floor(streak / 3))}x)` : ''}
            </span>
          </div>
        )}

        {/* Game Area */}
        <div className="flex-1 flex items-center justify-center">
          <div
            ref={canvasRef}
            className="relative bg-gradient-to-b from-sky-900 to-sky-700 rounded-lg overflow-hidden cursor-pointer select-none"
            style={{ width: dimensions.width, height: dimensions.height }}
            onClick={(e) => handleShoot(e.clientX, e.clientY)}
            onTouchStart={(e) => {
              e.preventDefault();
              const touch = e.touches[0];
              handleShoot(touch.clientX, touch.clientY);
            }}
          >
            {/* Backboard */}
            <div
              className="absolute bg-white/90 border-4 border-gray-400"
              style={{
                left: hoopCenterX - 40,
                top: hoopY - 30,
                width: 80,
                height: 50,
                transition: 'left 0.3s ease-out',
              }}
            >
              {/* Inner square */}
              <div 
                className="absolute border-2 border-gray-500"
                style={{
                  left: 15,
                  top: 10,
                  width: 46,
                  height: 28,
                }}
              />
            </div>

            {/* Hoop/Rim */}
            <div
              className="absolute"
              style={{
                left: hoopCenterX - hoopWidth / 2,
                top: rimY - 3,
                width: hoopWidth,
                height: 6,
                transition: 'left 0.3s ease-out',
              }}
            >
              {/* Left rim */}
              <div className="absolute left-0 top-0 w-3 h-3 rounded-full bg-orange-600 border-2 border-orange-700" />
              {/* Right rim */}
              <div className="absolute right-0 top-0 w-3 h-3 rounded-full bg-orange-600 border-2 border-orange-700" />
              {/* Net */}
              <svg
                className="absolute opacity-70"
                style={{ left: 6, top: 6, width: hoopWidth - 12, height: 40 }}
                viewBox="0 0 48 40"
              >
                <path
                  d="M0,0 L6,40 M12,0 L10,40 M24,0 L24,40 M36,0 L38,40 M48,0 L42,40"
                  stroke="white"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path
                  d="M3,10 Q24,15 45,10 M2,25 Q24,32 46,25"
                  stroke="white"
                  strokeWidth="1"
                  fill="none"
                />
              </svg>
            </div>

            {/* Swish effect */}
            {showSwish && (
              <div
                className="absolute text-3xl font-bold text-yellow-400 animate-bounce"
                style={{
                  left: hoopCenterX - 40,
                  top: rimY + 40,
                }}
              >
                SWISH! 🏀
              </div>
            )}

            {/* Balls */}
            {balls.map(ball => (
              <div
                key={ball.id}
                className={`absolute rounded-full ${ball.scored ? 'opacity-50' : ''}`}
                style={{
                  left: ball.x - 15,
                  top: ball.y - 15,
                  width: 30,
                  height: 30,
                  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%)',
                  boxShadow: ball.scored 
                    ? '0 0 20px rgba(234, 179, 8, 0.8)' 
                    : '2px 2px 4px rgba(0,0,0,0.3)',
                }}
              >
                {/* Ball lines */}
                <div 
                  className="absolute inset-0 rounded-full border border-black/20"
                  style={{
                    background: 'linear-gradient(90deg, transparent 48%, rgba(0,0,0,0.2) 48%, rgba(0,0,0,0.2) 52%, transparent 52%)',
                  }}
                />
              </div>
            ))}

            {/* Floor */}
            <div 
              className="absolute bottom-0 left-0 right-0 h-4 bg-amber-800"
              style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' }}
            />

            {/* Idle overlay */}
            {gameState === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
                <div className="text-6xl mb-4">🏀</div>
                <Button onClick={startGame} size="lg" className="gap-2 mb-3">
                  <Play className="h-5 w-5" />
                  Start Game
                </Button>
                <p className="text-sm text-muted-foreground text-center px-4">
                  Tap to shoot! Score as many baskets as you can in {GAME_DURATION} seconds
                </p>
              </div>
            )}

            {/* Game over overlay */}
            {gameState === 'gameover' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
                <p className="text-xl font-bold mb-2">Time's Up!</p>
                <p className="text-4xl font-bold text-primary mb-4">{score} pts</p>
                <div className="flex gap-2">
                  <Button onClick={startGame} size="lg" className="gap-2">
                    <RotateCcw className="h-5 w-5" />
                    Play Again
                  </Button>
                  {score > 0 && (
                    <Button 
                      onClick={() => setShareDialogOpen(true)} 
                      size="lg" 
                      variant="outline"
                    >
                      <Share2 className="h-5 w-5" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        {gameState === 'playing' && (
          <p className="text-center text-sm text-muted-foreground py-2">
            Tap anywhere below to shoot
          </p>
        )}
      </div>

      <ShareScoreDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        gameType="basketball"
        score={score}
      />
    </Layout>
  );
};

export default BasketballGame;
