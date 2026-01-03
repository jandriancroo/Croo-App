import { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, RotateCcw, Trophy, Share2, Heart } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ShareScoreDialog } from "@/components/games/ShareScoreDialog";

interface Player {
  x: number;
  y: number;
  velocityY: number;
  isJumping: boolean;
  width: number;
  height: number;
}

interface Topping {
  x: number;
  y: number;
  type: 'pepperoni' | 'mushroom' | 'olive' | 'pepper';
  width: number;
  height: number;
  isHit: boolean;
}

interface Platform {
  x: number;
  y: number;
  width: number;
}

const GRAVITY = 0.6;
const JUMP_FORCE = -14;
const GAME_SPEED_START = 4;
const TOPPING_SPAWN_RATE = 90;
const PLATFORM_HEIGHT = 20;

const TOPPING_EMOJIS = {
  pepperoni: '🍕',
  mushroom: '🍄',
  olive: '🫒',
  pepper: '🌶️',
};

const TOPPING_POINTS = {
  pepperoni: 10,
  mushroom: 15,
  olive: 20,
  pepper: 25,
};

const PizzaPaddleGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number>();

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const playerRef = useRef<Player>({
    x: 50,
    y: 0,
    velocityY: 0,
    isJumping: false,
    width: 50,
    height: 60,
  });

  const toppingsRef = useRef<Topping[]>([]);
  const platformsRef = useRef<Platform[]>([]);
  const gameSpeedRef = useRef(GAME_SPEED_START);
  const frameCountRef = useRef(0);
  const groundYRef = useRef(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);

  // Get canvas dimensions
  const getCanvasDimensions = useCallback(() => {
    const width = Math.min(window.innerWidth - 32, 500);
    const height = Math.min(window.innerHeight - 200, 500);
    return { width, height };
  }, []);

  // Initialize game
  const initGame = useCallback(() => {
    const { height } = getCanvasDimensions();
    groundYRef.current = height - 60;
    
    playerRef.current = {
      x: 80,
      y: groundYRef.current - 60,
      velocityY: 0,
      isJumping: false,
      width: 50,
      height: 60,
    };
    
    toppingsRef.current = [];
    platformsRef.current = [
      { x: 200, y: groundYRef.current - 80, width: 100 },
      { x: 400, y: groundYRef.current - 140, width: 80 },
    ];
    
    gameSpeedRef.current = GAME_SPEED_START;
    frameCountRef.current = 0;
    scoreRef.current = 0;
    livesRef.current = 3;
    setScore(0);
    setLives(3);
    setGameState('playing');
  }, [getCanvasDimensions]);

  // Handle jump
  const handleJump = useCallback(() => {
    if (gameState !== 'playing') return;
    
    const player = playerRef.current;
    if (!player.isJumping) {
      player.velocityY = JUMP_FORCE;
      player.isJumping = true;
    }
  }, [gameState]);

  // Check collision
  const checkCollision = (rect1: { x: number; y: number; width: number; height: number }, rect2: { x: number; y: number; width: number; height: number }) => {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  };

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = getCanvasDimensions();
    canvas.width = width;
    canvas.height = height;

    const gameLoop = () => {
      const player = playerRef.current;
      const toppings = toppingsRef.current;
      const platforms = platformsRef.current;
      const groundY = groundYRef.current;

      // Clear canvas
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);

      // Draw ground
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(0, height - 40, width, 40);
      
      // Draw grass
      ctx.fillStyle = '#228B22';
      ctx.fillRect(0, height - 45, width, 10);

      // Draw clouds
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.arc(100 - (frameCountRef.current * 0.2) % (width + 100), 60, 25, 0, Math.PI * 2);
      ctx.arc(130 - (frameCountRef.current * 0.2) % (width + 100), 55, 30, 0, Math.PI * 2);
      ctx.arc(160 - (frameCountRef.current * 0.2) % (width + 100), 60, 25, 0, Math.PI * 2);
      ctx.fill();

      // Update platforms
      platforms.forEach((platform, i) => {
        platform.x -= gameSpeedRef.current;
        if (platform.x + platform.width < 0) {
          platform.x = width + Math.random() * 200;
          platform.y = groundY - 60 - Math.random() * 100;
          platform.width = 60 + Math.random() * 60;
        }

        // Draw platform (pizza boxes)
        ctx.fillStyle = '#D2691E';
        ctx.fillRect(platform.x, platform.y, platform.width, PLATFORM_HEIGHT);
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = 2;
        ctx.strokeRect(platform.x, platform.y, platform.width, PLATFORM_HEIGHT);
      });

      // Apply gravity
      player.velocityY += GRAVITY;
      player.y += player.velocityY;

      // Check platform collision
      let onPlatform = false;
      platforms.forEach(platform => {
        if (
          player.velocityY >= 0 &&
          player.x + player.width > platform.x &&
          player.x < platform.x + platform.width &&
          player.y + player.height >= platform.y &&
          player.y + player.height <= platform.y + PLATFORM_HEIGHT + 10
        ) {
          player.y = platform.y - player.height;
          player.velocityY = 0;
          player.isJumping = false;
          onPlatform = true;
        }
      });

      // Ground collision
      if (player.y + player.height >= groundY) {
        player.y = groundY - player.height;
        player.velocityY = 0;
        player.isJumping = false;
      }

      // Draw player (pizza chef with paddle)
      // Body
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(player.x + 10, player.y + 20, 30, 35);
      
      // Head
      ctx.fillStyle = '#FFDAB9';
      ctx.beginPath();
      ctx.arc(player.x + 25, player.y + 12, 12, 0, Math.PI * 2);
      ctx.fill();
      
      // Chef hat
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(player.x + 15, player.y - 10, 20, 15);
      ctx.beginPath();
      ctx.arc(player.x + 25, player.y - 10, 12, Math.PI, 0);
      ctx.fill();
      
      // Pizza paddle
      ctx.fillStyle = '#8B4513';
      ctx.save();
      ctx.translate(player.x + 45, player.y + 30);
      ctx.rotate(-0.3 + Math.sin(frameCountRef.current * 0.2) * 0.2);
      ctx.fillRect(0, -5, 25, 10);
      ctx.beginPath();
      ctx.arc(25, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Spawn toppings
      frameCountRef.current++;
      if (frameCountRef.current % TOPPING_SPAWN_RATE === 0) {
        const types: ('pepperoni' | 'mushroom' | 'olive' | 'pepper')[] = ['pepperoni', 'mushroom', 'olive', 'pepper'];
        const type = types[Math.floor(Math.random() * types.length)];
        
        // Spawn at random height
        const spawnY = height - 100 - Math.random() * 150;
        
        toppings.push({
          x: width + 20,
          y: spawnY,
          type,
          width: 35,
          height: 35,
          isHit: false,
        });
      }

      // Update and draw toppings
      for (let i = toppings.length - 1; i >= 0; i--) {
        const topping = toppings[i];
        topping.x -= gameSpeedRef.current;

        // Check paddle hit (player hitting topping from above or side)
        const paddleRect = {
          x: player.x + 45,
          y: player.y + 20,
          width: 40,
          height: 30,
        };

        if (!topping.isHit && checkCollision(paddleRect, topping)) {
          topping.isHit = true;
          scoreRef.current += TOPPING_POINTS[topping.type];
          setScore(scoreRef.current);
          
          // Speed up game
          if (scoreRef.current % 50 === 0) {
            gameSpeedRef.current += 0.3;
          }
        }

        // Check body collision (lose life)
        const bodyRect = {
          x: player.x + 10,
          y: player.y + 10,
          width: 30,
          height: 45,
        };

        if (!topping.isHit && checkCollision(bodyRect, topping)) {
          topping.isHit = true;
          livesRef.current--;
          setLives(livesRef.current);
          
          if (livesRef.current <= 0) {
            setGameState('gameover');
            return;
          }
        }

        // Draw topping
        if (!topping.isHit) {
          ctx.font = '30px serif';
          ctx.fillText(TOPPING_EMOJIS[topping.type], topping.x, topping.y + 30);
        } else {
          // Hit effect
          ctx.font = '20px serif';
          ctx.globalAlpha = 0.5;
          ctx.fillText('💥', topping.x, topping.y + 20);
          ctx.globalAlpha = 1;
        }

        // Remove off-screen toppings
        if (topping.x + topping.width < 0) {
          toppings.splice(i, 1);
        }
      }

      // Draw score
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(`Score: ${scoreRef.current}`, 10, 30);

      // Draw lives
      ctx.font = '20px serif';
      for (let i = 0; i < livesRef.current; i++) {
        ctx.fillText('❤️', width - 30 - i * 25, 28);
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoopRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameState, getCanvasDimensions]);

  // Save score
  const saveScore = useCallback(async () => {
    if (!user?.id) return;

    try {
      await supabase.from('game_high_scores').insert({
        user_id: user.id,
        game_type: 'pizza',
        score: scoreRef.current,
      });
      queryClient.invalidateQueries({ queryKey: ['high-scores', 'pizza'] });

      if (scoreRef.current > highScore) {
        setHighScore(scoreRef.current);
        toast.success(`New personal best: ${scoreRef.current}!`);
      }
    } catch (error) {
      console.error('Failed to save score:', error);
    }
  }, [user?.id, highScore, queryClient]);

  // Handle game over
  useEffect(() => {
    if (gameState === 'gameover') {
      saveScore();
    }
  }, [gameState, saveScore]);

  // Fetch personal high score
  useEffect(() => {
    const fetchHighScore = async () => {
      if (!user?.id) return;

      const { data } = await supabase
        .from('game_high_scores')
        .select('score')
        .eq('user_id', user.id)
        .eq('game_type', 'pizza')
        .order('score', { ascending: false })
        .limit(1)
        .single();

      if (data) setHighScore(data.score);
    };
    fetchHighScore();
  }, [user?.id]);

  // Touch/click handler
  useEffect(() => {
    const handleInput = () => handleJump();
    
    window.addEventListener('touchstart', handleInput);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') handleInput();
    });

    return () => {
      window.removeEventListener('touchstart', handleInput);
    };
  }, [handleJump]);

  const { width, height } = getCanvasDimensions();

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] px-4 py-2">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold flex-1">Pizza Paddle</h1>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span>{highScore}</span>
          </div>
        </div>

        {/* Game Area */}
        <div className="flex-1 flex items-center justify-center">
          {gameState === 'idle' ? (
            <div className="text-center">
              <div className="text-6xl mb-4">🍕👨‍🍳</div>
              <h2 className="text-xl font-bold mb-2">Pizza Paddle</h2>
              <p className="text-muted-foreground mb-4">
                Tap to jump! Hit toppings with your paddle!
              </p>
              <Button onClick={initGame} size="lg" className="gap-2">
                <Play className="h-5 w-5" />
                Start Game
              </Button>
            </div>
          ) : (
            <div className="relative">
              <canvas
                ref={canvasRef}
                width={width}
                height={height}
                onClick={handleJump}
                className="rounded-lg border border-border touch-none"
                style={{ width, height }}
              />

              {gameState === 'gameover' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm rounded-lg">
                  <p className="text-xl font-bold text-destructive mb-2">
                    💥 Game Over!
                  </p>
                  <p className="text-3xl font-bold mb-1">{score}</p>
                  <p className="text-muted-foreground mb-4">points</p>
                  <div className="flex gap-2">
                    <Button onClick={initGame} size="lg" className="gap-2">
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
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {gameState === 'playing' && (
          <p className="text-center text-sm text-muted-foreground mt-2">
            Tap anywhere or press Space to jump
          </p>
        )}
      </div>

      <ShareScoreDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        gameType="pizza"
        score={score}
      />
    </Layout>
  );
};

export default PizzaPaddleGame;
