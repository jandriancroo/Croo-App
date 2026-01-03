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
import { useGameSounds } from "@/hooks/useGameSounds";

const GAME_DURATION = 45; // More time
const GRAVITY = 0.4; // Slower gravity for more control

interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  scored: boolean;
  missed: boolean;
  rotation: number;
}

const BasketballGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  
  // Background music - sports theme
  const sounds = useGameSounds();

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
  const [aimLine, setAimLine] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);

  // Calculate dimensions - make it bigger
  useEffect(() => {
    const updateDimensions = () => {
      const maxWidth = Math.min(window.innerWidth - 24, 450);
      const maxHeight = window.innerHeight - 180;
      setDimensions({ width: maxWidth, height: Math.min(maxHeight, 650) });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Hoop position - lower and wider for easier scoring
  const hoopY = dimensions.height * 0.18;
  const hoopWidth = 80; // Wider hoop
  const rimY = hoopY + 25;
  const ballSize = 28;

  // Start game
  const startGame = useCallback(() => {
    setScore(0);
    setStreak(0);
    setTimeLeft(GAME_DURATION);
    setBalls([]);
    setBallIdCounter(0);
    setHoopX(50);
    setGameState('playing');
    sounds.startMusic('action'); // Start sports music
  }, [sounds]);

  // Handle aim preview
  const handlePointerMove = useCallback((clientX: number, clientY: number) => {
    if (gameState !== 'playing' || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (y < dimensions.height * 0.45) {
      setAimLine(null);
      return;
    }

    const targetX = (hoopX / 100) * dimensions.width;
    const targetY = rimY;
    
    setAimLine({ startX: x, startY: y, endX: targetX, endY: targetY });
  }, [gameState, hoopX, dimensions, rimY]);

  // Handle shoot - improved physics
  const handleShoot = useCallback((clientX: number, clientY: number) => {
    if (gameState !== 'playing' || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Only shoot from bottom half
    if (y < dimensions.height * 0.45) return;

    // Calculate trajectory to aim towards hoop - much more accurate
    const targetX = (hoopX / 100) * dimensions.width;
    const targetY = rimY - 20; // Aim slightly above rim
    
    const dx = targetX - x;
    const dy = targetY - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Calculate required velocity for arc
    const timeToTarget = distance / 200; // Roughly how long to get there
    const vx = dx / (timeToTarget * 12);
    const vy = (dy / (timeToTarget * 12)) - (GRAVITY * timeToTarget * 6); // Compensate for gravity
    
    // Add small randomness but mostly accurate
    const randomX = (Math.random() - 0.5) * 1.5;
    const randomY = (Math.random() - 0.5) * 0.5;

    const newBall: Ball = {
      id: ballIdCounter,
      x,
      y,
      vx: vx + randomX,
      vy: Math.min(vy + randomY, -8), // Ensure upward velocity
      scored: false,
      missed: false,
      rotation: 0,
    };

    setBalls(prev => [...prev, newBall]);
    setBallIdCounter(prev => prev + 1);
    setAimLine(null);
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

          let { x, y, vx, vy, rotation } = ball;
          
          // Apply physics
          vy += GRAVITY;
          x += vx;
          y += vy;
          rotation += vx * 0.1;

          // Check for scoring (ball passes through hoop from above) - more forgiving
          const wasAboveRim = ball.y + ballSize/2 < rimY;
          const isNowAtRim = y + ballSize/2 >= rimY && y + ballSize/2 < rimY + 40;
          const isInHoopX = x > hoopLeft + 5 && x < hoopRight - 5;

          if (wasAboveRim && isNowAtRim && isInHoopX && vy > 0) {
            // Scored!
            setStreak(prev => prev + 1);
            const multiplier = Math.min(5, 1 + Math.floor(streak / 2));
            const points = 2 * multiplier;
            setScore(prev => prev + points);
            setShowSwish(true);
            setTimeout(() => setShowSwish(false), 600);
            
            // Move hoop after score - less extreme movement
            const newX = 25 + Math.random() * 50;
            setHoopX(newX);
            
            return { ...ball, x, y, vx, vy, rotation, scored: true };
          }

          // Check for miss (out of bounds)
          if (y > dimensions.height + 50 || x < -50 || x > dimensions.width + 50) {
            setStreak(0);
            return { ...ball, x, y, vx, vy, rotation, missed: true };
          }

          // Bounce off walls
          if (x < ballSize/2) {
            x = ballSize/2;
            vx = -vx * 0.5;
          }
          if (x > dimensions.width - ballSize/2) {
            x = dimensions.width - ballSize/2;
            vx = -vx * 0.5;
          }

          // Bounce off rim - more forgiving
          const rimRadius = 8;
          const distToLeftRim = Math.sqrt((x - hoopLeft) ** 2 + (y - rimY) ** 2);
          const distToRightRim = Math.sqrt((x - hoopRight) ** 2 + (y - rimY) ** 2);
          
          if (distToLeftRim < ballSize/2 + rimRadius) {
            const angle = Math.atan2(y - rimY, x - hoopLeft);
            vx = Math.cos(angle) * Math.abs(vx + vy) * 0.4;
            vy = Math.sin(angle) * Math.abs(vy) * 0.4;
          }
          if (distToRightRim < ballSize/2 + rimRadius) {
            const angle = Math.atan2(y - rimY, x - hoopRight);
            vx = Math.cos(angle) * Math.abs(vx + vy) * 0.4;
            vy = Math.sin(angle) * Math.abs(vy) * 0.4;
          }

          return { ...ball, x, y, vx, vy, rotation };
        }).filter(ball => !(ball.missed && ball.y > dimensions.height + 100));
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
      <div className="flex flex-col h-[calc(100vh-4rem)] px-3 py-2">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold flex-1">Hoops</h1>
          <div className="flex items-center gap-4">
            {gameState === 'playing' && (
              <>
                <div className="text-center">
                  <p className="text-3xl font-bold text-primary">{score}</p>
                </div>
                <div className="text-center px-3 py-1 bg-muted rounded-lg">
                  <p className={`text-xl font-mono font-bold ${timeLeft <= 10 ? 'text-destructive animate-pulse' : ''}`}>
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
            <span className="inline-block px-3 py-1 bg-orange-500/20 text-orange-400 rounded-full text-sm font-bold animate-pulse">
              🔥 {streak} streak! {streak >= 2 ? `(${Math.min(5, 1 + Math.floor(streak / 2))}x multiplier)` : ''}
            </span>
          </div>
        )}

        {/* Game Area */}
        <div className="flex-1 flex items-center justify-center">
          <div
            ref={canvasRef}
            className="relative rounded-xl overflow-hidden cursor-crosshair select-none shadow-2xl"
            style={{ 
              width: dimensions.width, 
              height: dimensions.height,
              background: 'linear-gradient(180deg, #1e3a5f 0%, #0f2847 50%, #0a1929 100%)',
            }}
            onClick={(e) => handleShoot(e.clientX, e.clientY)}
            onMouseMove={(e) => handlePointerMove(e.clientX, e.clientY)}
            onMouseLeave={() => setAimLine(null)}
            onTouchStart={(e) => {
              e.preventDefault();
              const touch = e.touches[0];
              handleShoot(touch.clientX, touch.clientY);
            }}
          >
            {/* Court lines decoration */}
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-32 h-16 border-2 border-white/20 rounded-t-full" />
            
            {/* Aim line */}
            {aimLine && (
              <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
                <line
                  x1={aimLine.startX}
                  y1={aimLine.startY}
                  x2={aimLine.endX}
                  y2={aimLine.endY}
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth="2"
                  strokeDasharray="8,4"
                />
                <circle cx={aimLine.endX} cy={aimLine.endY} r="6" fill="rgba(255,255,255,0.3)" />
              </svg>
            )}

            {/* Backboard */}
            <div
              className="absolute rounded-sm"
              style={{
                left: hoopCenterX - 50,
                top: hoopY - 40,
                width: 100,
                height: 65,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(230,230,230,0.95) 100%)',
                border: '4px solid #666',
                transition: 'left 0.4s ease-out',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            >
              {/* Inner square */}
              <div 
                className="absolute border-3 border-red-500"
                style={{
                  left: 20,
                  top: 12,
                  width: 56,
                  height: 38,
                  borderWidth: '3px',
                }}
              />
            </div>

            {/* Hoop/Rim */}
            <div
              className="absolute"
              style={{
                left: hoopCenterX - hoopWidth / 2,
                top: rimY - 4,
                width: hoopWidth,
                height: 8,
                transition: 'left 0.4s ease-out',
              }}
            >
              {/* Rim tube */}
              <div 
                className="absolute top-0 left-0 right-0 h-2 rounded-full"
                style={{ 
                  background: 'linear-gradient(180deg, #ff6b35 0%, #c73e00 100%)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                }}
              />
              {/* Left rim connector */}
              <div className="absolute left-0 top-0 w-4 h-4 rounded-full bg-orange-600 border-2 border-orange-800" />
              {/* Right rim connector */}
              <div className="absolute right-0 top-0 w-4 h-4 rounded-full bg-orange-600 border-2 border-orange-800" />
              {/* Net */}
              <svg
                className="absolute"
                style={{ left: 8, top: 6, width: hoopWidth - 16, height: 50 }}
                viewBox="0 0 64 50"
              >
                <defs>
                  <linearGradient id="netGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="white" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="white" stopOpacity="0.3" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,0 L4,50 M16,0 L14,50 M32,0 L32,50 M48,0 L50,50 M64,0 L60,50"
                  stroke="url(#netGradient)"
                  strokeWidth="2"
                  fill="none"
                />
                <path
                  d="M2,12 Q32,20 62,12 M1,28 Q32,38 63,28 M2,42 Q32,50 62,42"
                  stroke="url(#netGradient)"
                  strokeWidth="1.5"
                  fill="none"
                />
              </svg>
            </div>

            {/* Swish effect */}
            {showSwish && (
              <div
                className="absolute text-2xl font-black text-yellow-400 animate-bounce z-20"
                style={{
                  left: hoopCenterX - 50,
                  top: rimY + 50,
                  textShadow: '0 0 20px rgba(250, 204, 21, 0.8)',
                }}
              >
                SWISH! +{2 * Math.min(5, 1 + Math.floor(streak / 2))}
              </div>
            )}

            {/* Balls */}
            {balls.map(ball => (
              <div
                key={ball.id}
                className={`absolute rounded-full ${ball.scored ? 'opacity-40 scale-75' : ''}`}
                style={{
                  left: ball.x - ballSize/2,
                  top: ball.y - ballSize/2,
                  width: ballSize,
                  height: ballSize,
                  transform: `rotate(${ball.rotation}rad) ${ball.scored ? 'scale(0.7)' : ''}`,
                  transition: ball.scored ? 'all 0.3s' : 'none',
                  background: 'radial-gradient(circle at 30% 30%, #ff8c42 0%, #e65c00 50%, #cc4400 100%)',
                  boxShadow: ball.scored 
                    ? '0 0 25px rgba(250, 204, 21, 0.9)' 
                    : '3px 3px 8px rgba(0,0,0,0.4), inset -2px -2px 4px rgba(0,0,0,0.2)',
                }}
              >
                {/* Ball seams */}
                <div 
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `
                      linear-gradient(90deg, transparent 46%, rgba(0,0,0,0.3) 48%, rgba(0,0,0,0.3) 52%, transparent 54%),
                      linear-gradient(0deg, transparent 46%, rgba(0,0,0,0.3) 48%, rgba(0,0,0,0.3) 52%, transparent 54%)
                    `,
                  }}
                />
              </div>
            ))}

            {/* Court floor */}
            <div 
              className="absolute bottom-0 left-0 right-0 h-12"
              style={{ 
                background: 'linear-gradient(180deg, #b8860b 0%, #8b6914 50%, #6b4f12 100%)',
                boxShadow: 'inset 0 4px 8px rgba(0,0,0,0.3)',
              }}
            >
              {/* Court line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-white/30" />
            </div>

            {/* Tap zone indicator */}
            {gameState === 'playing' && (
              <div 
                className="absolute left-0 right-0 border-t-2 border-dashed border-white/10"
                style={{ top: dimensions.height * 0.45 }}
              />
            )}

            {/* Idle overlay */}
            {gameState === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
                <div className="text-7xl mb-4 animate-bounce">🏀</div>
                <h2 className="text-2xl font-bold mb-2">Hoops</h2>
                <Button onClick={startGame} size="lg" className="gap-2 mb-4">
                  <Play className="h-5 w-5" />
                  Start Game
                </Button>
                <p className="text-sm text-muted-foreground text-center px-6">
                  Tap below the line to shoot at the hoop!<br/>
                  Score streaks for bonus points! 🔥
                </p>
              </div>
            )}

            {/* Game over overlay */}
            {gameState === 'gameover' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
                <p className="text-2xl font-bold mb-2">⏱️ Time's Up!</p>
                <p className="text-5xl font-bold text-primary mb-1">{score}</p>
                <p className="text-muted-foreground mb-4">points</p>
                <div className="flex gap-3">
                  <Button onClick={startGame} size="lg" className="gap-2">
                    <RotateCcw className="h-5 w-5" />
                    Play Again
                  </Button>
                  {score > 0 && (
                    <Button 
                      onClick={() => setShareDialogOpen(true)} 
                      size="lg" 
                      variant="outline"
                      className="gap-2"
                    >
                      <Share2 className="h-5 w-5" />
                      Share
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        {gameState === 'playing' && (
          <p className="text-center text-xs text-muted-foreground py-1">
            Tap in the lower half to shoot • Aim for streaks!
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