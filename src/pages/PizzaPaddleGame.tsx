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
  frame: number;
  isHurt: boolean;
}

interface Topping {
  x: number;
  y: number;
  type: 'pepperoni' | 'mushroom' | 'olive' | 'pepper' | 'cheese';
  width: number;
  height: number;
  isHit: boolean;
  velocityY: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const GRAVITY = 0.55;
const JUMP_FORCE = -15;
const GAME_SPEED_START = 3.5;
const TOPPING_SPAWN_RATE = 70;

const TOPPING_CONFIG = {
  pepperoni: { emoji: '🍕', points: 10, color: '#e74c3c' },
  mushroom: { emoji: '🍄', points: 15, color: '#a0522d' },
  olive: { emoji: '🫒', points: 20, color: '#2d5016' },
  pepper: { emoji: '🌶️', points: 25, color: '#dc143c' },
  cheese: { emoji: '🧀', points: 30, color: '#ffd700' },
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
  const [combo, setCombo] = useState(0);

  const playerRef = useRef<Player>({
    x: 50,
    y: 0,
    velocityY: 0,
    isJumping: false,
    width: 60,
    height: 80,
    frame: 0,
    isHurt: false,
  });

  const toppingsRef = useRef<Topping[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const gameSpeedRef = useRef(GAME_SPEED_START);
  const frameCountRef = useRef(0);
  const groundYRef = useRef(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const comboRef = useRef(0);
  const lastHitTimeRef = useRef(0);

  const getCanvasDimensions = useCallback(() => {
    const width = Math.min(window.innerWidth - 24, 500);
    const height = Math.min(window.innerHeight - 180, 550);
    return { width, height };
  }, []);

  const initGame = useCallback(() => {
    const { height } = getCanvasDimensions();
    groundYRef.current = height - 50;
    
    playerRef.current = {
      x: 80,
      y: groundYRef.current - 80,
      velocityY: 0,
      isJumping: false,
      width: 60,
      height: 80,
      frame: 0,
      isHurt: false,
    };
    
    toppingsRef.current = [];
    particlesRef.current = [];
    gameSpeedRef.current = GAME_SPEED_START;
    frameCountRef.current = 0;
    scoreRef.current = 0;
    livesRef.current = 3;
    comboRef.current = 0;
    lastHitTimeRef.current = 0;
    setScore(0);
    setLives(3);
    setCombo(0);
    setGameState('playing');
  }, [getCanvasDimensions]);

  const handleJump = useCallback(() => {
    if (gameState !== 'playing') return;
    
    const player = playerRef.current;
    if (!player.isJumping) {
      player.velocityY = JUMP_FORCE;
      player.isJumping = true;
    }
  }, [gameState]);

  const spawnParticles = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 1) * 6,
        life: 30,
        color,
      });
    }
  };

  const checkCollision = (rect1: { x: number; y: number; width: number; height: number }, rect2: { x: number; y: number; width: number; height: number }) => {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  };

  // Draw the cool chef character
  const drawPlayer = (ctx: CanvasRenderingContext2D, player: Player, frame: number) => {
    ctx.save();
    
    const bobOffset = Math.sin(frame * 0.15) * 2;
    const legSwing = Math.sin(frame * 0.3) * 8;
    
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(player.x + 30, groundYRef.current, 25, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    const yOffset = player.y + bobOffset;
    
    // Hurt flash effect
    if (player.isHurt) {
      ctx.globalAlpha = 0.7 + Math.sin(frame * 0.5) * 0.3;
    }

    // Legs (animated)
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(player.x + 15, yOffset + 55, 12, 22 + legSwing * 0.5);
    ctx.fillRect(player.x + 33, yOffset + 55, 12, 22 - legSwing * 0.5);
    
    // Shoes
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(player.x + 12, yOffset + 72 + legSwing * 0.5, 18, 8);
    ctx.fillRect(player.x + 30, yOffset + 72 - legSwing * 0.5, 18, 8);

    // Body (chef coat)
    ctx.fillStyle = '#ecf0f1';
    ctx.beginPath();
    ctx.roundRect(player.x + 10, yOffset + 25, 40, 35, 5);
    ctx.fill();
    
    // Chef coat buttons
    ctx.fillStyle = '#bdc3c7';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(player.x + 30, yOffset + 32 + i * 10, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Neck
    ctx.fillStyle = '#e0ac69';
    ctx.fillRect(player.x + 23, yOffset + 18, 14, 10);

    // Head
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.arc(player.x + 30, yOffset + 10, 16, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = '#2c1810';
    ctx.beginPath();
    ctx.arc(player.x + 30, yOffset + 5, 14, Math.PI, 0);
    ctx.fill();

    // Chef hat
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(player.x + 14, yOffset - 25, 32, 22, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 22, yOffset - 25, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 30, yOffset - 28, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 38, yOffset - 25, 10, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.arc(player.x + 24, yOffset + 8, 3, 0, Math.PI * 2);
    ctx.arc(player.x + 36, yOffset + 8, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Eye shine
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(player.x + 25, yOffset + 7, 1, 0, Math.PI * 2);
    ctx.arc(player.x + 37, yOffset + 7, 1, 0, Math.PI * 2);
    ctx.fill();

    // Smile
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x + 30, yOffset + 12, 6, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // Mustache
    ctx.fillStyle = '#2c1810';
    ctx.beginPath();
    ctx.moveTo(player.x + 24, yOffset + 14);
    ctx.quadraticCurveTo(player.x + 20, yOffset + 18, player.x + 18, yOffset + 15);
    ctx.quadraticCurveTo(player.x + 20, yOffset + 14, player.x + 24, yOffset + 14);
    ctx.moveTo(player.x + 36, yOffset + 14);
    ctx.quadraticCurveTo(player.x + 40, yOffset + 18, player.x + 42, yOffset + 15);
    ctx.quadraticCurveTo(player.x + 40, yOffset + 14, player.x + 36, yOffset + 14);
    ctx.fill();

    // Arm and paddle
    const paddleSwing = Math.sin(frame * 0.2) * 0.15;
    ctx.save();
    ctx.translate(player.x + 50, yOffset + 35);
    ctx.rotate(-0.5 + paddleSwing);
    
    // Arm
    ctx.fillStyle = '#ecf0f1';
    ctx.fillRect(0, -6, 20, 12);
    
    // Hand
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.arc(20, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Paddle handle
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(26, -4, 18, 8);
    
    // Paddle
    ctx.fillStyle = '#d4a373';
    ctx.beginPath();
    ctx.arc(50, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a0522d';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Paddle pizza pattern
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(45, -5, 4, 0, Math.PI * 2);
    ctx.arc(52, 5, 3, 0, Math.PI * 2);
    ctx.arc(55, -3, 3, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
    ctx.restore();
  };

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
      const particles = particlesRef.current;
      const groundY = groundYRef.current;
      const currentTime = Date.now();

      // Clear canvas with gradient sky
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#87ceeb');
      gradient.addColorStop(0.6, '#e0f6ff');
      gradient.addColorStop(1, '#b8e994');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Background buildings
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(50 - (frameCountRef.current * 0.5) % 600, height - 150, 60, 100);
      ctx.fillRect(200 - (frameCountRef.current * 0.5) % 600, height - 180, 80, 130);
      ctx.fillRect(400 - (frameCountRef.current * 0.5) % 600, height - 130, 50, 80);

      // Clouds
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      const cloudX = (100 - (frameCountRef.current * 0.3)) % (width + 200);
      ctx.beginPath();
      ctx.arc(cloudX, 60, 30, 0, Math.PI * 2);
      ctx.arc(cloudX + 35, 55, 35, 0, Math.PI * 2);
      ctx.arc(cloudX + 70, 60, 25, 0, Math.PI * 2);
      ctx.fill();

      // Ground
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(0, height - 50, width, 50);
      
      // Ground texture
      ctx.fillStyle = '#27ae60';
      for (let i = 0; i < width; i += 20) {
        ctx.fillRect(i - (frameCountRef.current * gameSpeedRef.current) % 20, height - 50, 2, 50);
      }

      // Apply gravity
      player.velocityY += GRAVITY;
      player.y += player.velocityY;

      // Ground collision
      if (player.y + player.height >= groundY) {
        player.y = groundY - player.height;
        player.velocityY = 0;
        player.isJumping = false;
      }

      // Update and draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2;
        p.life--;
        
        ctx.globalAlpha = p.life / 30;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        
        if (p.life <= 0) particles.splice(i, 1);
      }

      // Combo decay
      if (currentTime - lastHitTimeRef.current > 2000 && comboRef.current > 0) {
        comboRef.current = 0;
        setCombo(0);
      }

      // Draw player
      player.frame = frameCountRef.current;
      if (player.isHurt && frameCountRef.current % 30 === 0) {
        player.isHurt = false;
      }
      drawPlayer(ctx, player, frameCountRef.current);

      // Spawn toppings
      frameCountRef.current++;
      if (frameCountRef.current % TOPPING_SPAWN_RATE === 0) {
        const types: ('pepperoni' | 'mushroom' | 'olive' | 'pepper' | 'cheese')[] = 
          ['pepperoni', 'mushroom', 'olive', 'pepper', 'cheese'];
        const type = types[Math.floor(Math.random() * types.length)];
        
        toppings.push({
          x: width + 20,
          y: height - 120 - Math.random() * 180,
          type,
          width: 40,
          height: 40,
          isHit: false,
          velocityY: (Math.random() - 0.5) * 2,
        });
      }

      // Update and draw toppings
      for (let i = toppings.length - 1; i >= 0; i--) {
        const topping = toppings[i];
        topping.x -= gameSpeedRef.current;
        topping.y += topping.velocityY;
        topping.velocityY += 0.02;

        // Check paddle hit
        const paddleRect = {
          x: player.x + 55,
          y: player.y + 15,
          width: 50,
          height: 45,
        };

        if (!topping.isHit && checkCollision(paddleRect, topping)) {
          topping.isHit = true;
          const config = TOPPING_CONFIG[topping.type];
          
          comboRef.current++;
          setCombo(comboRef.current);
          lastHitTimeRef.current = currentTime;
          
          const multiplier = Math.min(comboRef.current, 5);
          const points = config.points * multiplier;
          scoreRef.current += points;
          setScore(scoreRef.current);
          
          spawnParticles(topping.x, topping.y, config.color, 8);
          
          if (scoreRef.current % 100 === 0) {
            gameSpeedRef.current += 0.2;
          }
        }

        // Check body collision
        const bodyRect = {
          x: player.x + 15,
          y: player.y + 15,
          width: 35,
          height: 60,
        };

        if (!topping.isHit && checkCollision(bodyRect, topping)) {
          topping.isHit = true;
          livesRef.current--;
          setLives(livesRef.current);
          player.isHurt = true;
          comboRef.current = 0;
          setCombo(0);
          
          spawnParticles(topping.x, topping.y, '#ff0000', 12);
          
          if (livesRef.current <= 0) {
            setGameState('gameover');
            return;
          }
        }

        // Draw topping
        if (!topping.isHit) {
          // Glow effect
          ctx.shadowColor = TOPPING_CONFIG[topping.type].color;
          ctx.shadowBlur = 10;
          ctx.font = '35px serif';
          ctx.fillText(TOPPING_CONFIG[topping.type].emoji, topping.x, topping.y + 35);
          ctx.shadowBlur = 0;
        }

        if (topping.x + topping.width < 0 || topping.isHit) {
          toppings.splice(i, 1);
        }
      }

      // Draw combo indicator
      if (comboRef.current > 1) {
        ctx.save();
        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = '#e74c3c';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        const comboText = `${comboRef.current}x COMBO!`;
        ctx.strokeText(comboText, width / 2 - 60, 80);
        ctx.fillText(comboText, width / 2 - 60, 80);
        ctx.restore();
      }

      // Draw UI
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, width, 45);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(`Score: ${scoreRef.current}`, 15, 30);

      // Draw lives as hearts
      ctx.font = '24px serif';
      for (let i = 0; i < livesRef.current; i++) {
        ctx.fillText('❤️', width - 35 - i * 32, 32);
      }
      
      // Draw empty heart slots
      ctx.globalAlpha = 0.3;
      for (let i = livesRef.current; i < 3; i++) {
        ctx.fillText('🖤', width - 35 - i * 32, 32);
      }
      ctx.globalAlpha = 1;

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoopRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameState, getCanvasDimensions]);

  const saveScore = useCallback(async () => {
    if (!user?.id || scoreRef.current === 0) return;

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

  useEffect(() => {
    if (gameState === 'gameover') {
      saveScore();
    }
  }, [gameState, saveScore]);

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

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleJump();
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handleJump]);

  const { width, height } = getCanvasDimensions();

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold flex-1">Pizza Paddle</h1>
          <div className="flex items-center gap-2">
            {gameState === 'playing' && (
              <div className="flex items-center gap-1">
                {[...Array(3)].map((_, i) => (
                  <Heart 
                    key={i} 
                    className={`h-5 w-5 ${i < lives ? 'text-red-500 fill-red-500' : 'text-muted-foreground/30'}`} 
                  />
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <span>{highScore}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          {gameState === 'idle' ? (
            <div className="text-center">
              <div className="text-7xl mb-4">👨‍🍳🍕</div>
              <h2 className="text-2xl font-bold mb-2">Pizza Paddle</h2>
              <p className="text-muted-foreground mb-2 max-w-xs mx-auto">
                Jump and hit flying toppings with your pizza paddle!
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                ❤️ 3 Lives • Build combos for bonus points!
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
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleJump();
                }}
                className="rounded-xl shadow-2xl touch-none"
                style={{ width, height }}
              />

              {gameState === 'gameover' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm rounded-xl">
                  <div className="text-5xl mb-2">💥</div>
                  <p className="text-2xl font-bold text-destructive mb-1">Game Over!</p>
                  <p className="text-muted-foreground mb-2">You ran out of lives!</p>
                  <p className="text-5xl font-bold text-primary mb-1">{score}</p>
                  <p className="text-muted-foreground mb-4">points</p>
                  <div className="flex gap-3">
                    <Button onClick={initGame} size="lg" className="gap-2">
                      <RotateCcw className="h-5 w-5" />
                      Try Again
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
          )}
        </div>

        {gameState === 'playing' && (
          <p className="text-center text-xs text-muted-foreground py-1">
            Tap to jump • Hit toppings with paddle, avoid body hits!
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