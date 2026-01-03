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

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
type Position = { x: number; y: number };

interface Ghost {
  x: number;
  y: number;
  direction: Direction;
  type: 'ghost' | 'firefighter';
  color: string;
}

interface Topping {
  x: number;
  y: number;
  type: string;
  collected: boolean;
}

// Simple maze layout (1 = wall, 0 = path)
const MAZE_TEMPLATE = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
  [1,0,1,1,0,1,0,0,0,1,0,1,1,0,1],
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
  [1,0,1,0,1,1,0,1,0,1,1,0,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,0,1,0,1,1,1,0,1,0,1,1,1],
  [0,0,0,0,1,0,0,0,0,0,1,0,0,0,0],
  [1,1,1,0,1,0,1,1,1,0,1,0,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,0,1,1,0,1,0,1,1,0,1,0,1],
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
  [1,0,1,1,0,1,0,0,0,1,0,1,1,0,1],
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const TOPPINGS = ['🍅', '🧀', '🫒', '🌶️', '🍄', '🧅', '🥓', '🍕'];
const CELL_SIZE = 22;
const GAME_SPEED = 180;

const MarcManGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const sounds = useGameSounds();
  const gameLoopRef = useRef<number>();
  const lastMoveTime = useRef(0);

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [marc, setMarc] = useState<Position>({ x: 7, y: 7 });
  const [direction, setDirection] = useState<Direction>('RIGHT');
  const [nextDirection, setNextDirection] = useState<Direction>('RIGHT');
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [toppings, setToppings] = useState<Topping[]>([]);
  const [pizzaProgress, setPizzaProgress] = useState(0);
  const [pizzaCount, setPizzaCount] = useState(0);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(true);

  const mazeWidth = MAZE_TEMPLATE[0].length;
  const mazeHeight = MAZE_TEMPLATE.length;

  // Initialize toppings
  const initToppings = useCallback(() => {
    const newToppings: Topping[] = [];
    for (let y = 0; y < mazeHeight; y++) {
      for (let x = 0; x < mazeWidth; x++) {
        if (MAZE_TEMPLATE[y][x] === 0) {
          // Don't place on spawn points
          if ((y === 7 && x >= 5 && x <= 9) || (y === 7 && x === 7)) continue;
          newToppings.push({
            x,
            y,
            type: TOPPINGS[Math.floor(Math.random() * TOPPINGS.length)],
            collected: false,
          });
        }
      }
    }
    return newToppings;
  }, []);

  // Initialize ghosts
  const initGhosts = useCallback((): Ghost[] => {
    return [
      { x: 6, y: 7, direction: 'LEFT', type: 'ghost', color: '#FF0000' },
      { x: 8, y: 7, direction: 'RIGHT', type: 'ghost', color: '#00FFFF' },
      { x: 7, y: 6, direction: 'UP', type: 'firefighter', color: '#FF6600' },
      { x: 7, y: 8, direction: 'DOWN', type: 'firefighter', color: '#FFFF00' },
    ];
  }, []);

  // Start game
  const startGame = useCallback(() => {
    setMarc({ x: 7, y: 7 });
    setDirection('RIGHT');
    setNextDirection('RIGHT');
    setGhosts(initGhosts());
    setToppings(initToppings());
    setPizzaProgress(0);
    setPizzaCount(0);
    setScore(0);
    setGameState('playing');
    sounds.startMusic('retro');
  }, [initGhosts, initToppings, sounds]);

  // Check if position is valid
  const isValidMove = useCallback((x: number, y: number): boolean => {
    // Handle tunnel
    if (y === 7 && (x < 0 || x >= mazeWidth)) return true;
    if (x < 0 || x >= mazeWidth || y < 0 || y >= mazeHeight) return false;
    return MAZE_TEMPLATE[y][x] === 0;
  }, []);

  // Handle direction input
  const handleDirectionChange = useCallback((newDir: Direction) => {
    if (gameState !== 'playing') return;
    setNextDirection(newDir);
  }, [gameState]);

  // Touch controls
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchStart.current) return;
    
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    
    if (Math.abs(dx) > Math.abs(dy)) {
      handleDirectionChange(dx > 0 ? 'RIGHT' : 'LEFT');
    } else {
      handleDirectionChange(dy > 0 ? 'DOWN' : 'UP');
    }
    touchStart.current = null;
  }, [handleDirectionChange]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
          handleDirectionChange('UP');
          break;
        case 'ArrowDown':
        case 's':
          handleDirectionChange('DOWN');
          break;
        case 'ArrowLeft':
        case 'a':
          handleDirectionChange('LEFT');
          break;
        case 'ArrowRight':
        case 'd':
          handleDirectionChange('RIGHT');
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDirectionChange]);

  // Main game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const gameLoop = () => {
      const now = Date.now();
      if (now - lastMoveTime.current < GAME_SPEED) {
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return;
      }
      lastMoveTime.current = now;

      setMouthOpen(prev => !prev);

      // Move Marc
      setMarc(prev => {
        let newX = prev.x;
        let newY = prev.y;

        // Try next direction first
        const dirDeltas: Record<Direction, Position> = {
          'UP': { x: 0, y: -1 },
          'DOWN': { x: 0, y: 1 },
          'LEFT': { x: -1, y: 0 },
          'RIGHT': { x: 1, y: 0 },
        };

        const nextDelta = dirDeltas[nextDirection];
        if (isValidMove(prev.x + nextDelta.x, prev.y + nextDelta.y)) {
          setDirection(nextDirection);
          newX = prev.x + nextDelta.x;
          newY = prev.y + nextDelta.y;
        } else {
          // Try current direction
          const delta = dirDeltas[direction];
          if (isValidMove(prev.x + delta.x, prev.y + delta.y)) {
            newX = prev.x + delta.x;
            newY = prev.y + delta.y;
          }
        }

        // Handle tunnel wrap
        if (newY === 7) {
          if (newX < 0) newX = mazeWidth - 1;
          if (newX >= mazeWidth) newX = 0;
        }

        return { x: newX, y: newY };
      });

      // Move ghosts
      setGhosts(prevGhosts => {
        return prevGhosts.map(ghost => {
          const directions: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
          const dirDeltas: Record<Direction, Position> = {
            'UP': { x: 0, y: -1 },
            'DOWN': { x: 0, y: 1 },
            'LEFT': { x: -1, y: 0 },
            'RIGHT': { x: 1, y: 0 },
          };

          // Get valid directions
          const validDirs = directions.filter(d => {
            const delta = dirDeltas[d];
            return isValidMove(ghost.x + delta.x, ghost.y + delta.y);
          });

          // Prefer not to reverse
          const opposite: Record<Direction, Direction> = {
            'UP': 'DOWN', 'DOWN': 'UP', 'LEFT': 'RIGHT', 'RIGHT': 'LEFT'
          };
          const nonReverse = validDirs.filter(d => d !== opposite[ghost.direction]);
          const choices = nonReverse.length > 0 ? nonReverse : validDirs;

          // Random direction with slight bias toward Marc
          let newDir = choices[Math.floor(Math.random() * choices.length)] || ghost.direction;

          const delta = dirDeltas[newDir];
          let newX = ghost.x + delta.x;
          let newY = ghost.y + delta.y;

          // Handle tunnel
          if (newY === 7) {
            if (newX < 0) newX = mazeWidth - 1;
            if (newX >= mazeWidth) newX = 0;
          }

          return { ...ghost, x: newX, y: newY, direction: newDir };
        });
      });

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoopRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, [gameState, direction, nextDirection, isValidMove]);

  // Check collisions
  useEffect(() => {
    if (gameState !== 'playing') return;

    // Check ghost collision
    for (const ghost of ghosts) {
      if (ghost.x === marc.x && ghost.y === marc.y) {
        setGameState('gameover');
        sounds.stopMusic();
        return;
      }
    }

    // Check topping collection
    setToppings(prev => {
      let collected = false;
      const updated = prev.map(t => {
        if (!t.collected && t.x === marc.x && t.y === marc.y) {
          collected = true;
          return { ...t, collected: true };
        }
        return t;
      });

      if (collected) {
        setScore(s => s + 10);
        setPizzaProgress(p => {
          const newProgress = p + 1;
          // Complete pizza at 12 toppings
          if (newProgress >= 12) {
            setPizzaCount(c => c + 1);
            return 0;
          }
          return newProgress;
        });
      }

      // Check if all toppings collected - reset level
      const remaining = updated.filter(t => !t.collected);
      if (remaining.length === 0) {
        return initToppings();
      }

      return updated;
    });
  }, [gameState, marc, ghosts, sounds, initToppings]);

  // Save high score
  useEffect(() => {
    if (gameState === 'gameover' && score > 0 && user?.id) {
      const saveScore = async () => {
        try {
          await supabase.from('game_high_scores').insert({
            user_id: user.id,
            game_type: 'marcman',
            score,
          });
          queryClient.invalidateQueries({ queryKey: ['high-scores', 'marcman'] });
          
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
        .eq('game_type', 'marcman')
        .order('score', { ascending: false })
        .limit(1)
        .single();
      
      if (data) setHighScore(data.score);
    };
    fetchHighScore();
  }, [user?.id]);

  // Get Marc rotation based on direction
  const getMarcRotation = () => {
    switch (direction) {
      case 'UP': return -90;
      case 'DOWN': return 90;
      case 'LEFT': return 180;
      case 'RIGHT': return 0;
    }
  };

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] px-2 py-2">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold flex-1">MarcMAN</h1>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-xl font-bold text-primary">{score}</p>
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <span>{highScore}</span>
            </div>
          </div>
        </div>

        {/* Pizza counter */}
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="flex items-center gap-1 bg-muted/50 rounded-full px-3 py-1">
            <span className="text-lg">🍕</span>
            <span className="font-bold text-sm">×{pizzaCount}</span>
          </div>
          {/* Pizza progress bar */}
          <div className="flex-1 max-w-[150px] h-3 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all"
              style={{ width: `${(pizzaProgress / 12) * 100}%` }}
            />
          </div>
        </div>

        {/* Game Area */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <div
            className="relative rounded-lg overflow-hidden border-4 border-blue-900"
            style={{
              width: mazeWidth * CELL_SIZE,
              height: mazeHeight * CELL_SIZE,
              background: '#000',
            }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* Maze walls */}
            {MAZE_TEMPLATE.map((row, y) =>
              row.map((cell, x) => (
                cell === 1 && (
                  <div
                    key={`${x}-${y}`}
                    className="absolute bg-blue-800 border border-blue-600"
                    style={{
                      left: x * CELL_SIZE,
                      top: y * CELL_SIZE,
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                    }}
                  />
                )
              ))
            )}

            {/* Toppings */}
            {toppings.map((t, i) => !t.collected && (
              <div
                key={i}
                className="absolute flex items-center justify-center"
                style={{
                  left: t.x * CELL_SIZE,
                  top: t.y * CELL_SIZE,
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                  fontSize: CELL_SIZE * 0.6,
                }}
              >
                {t.type}
              </div>
            ))}

            {/* Marc - old cowboy guy */}
            <div
              className="absolute transition-all duration-100"
              style={{
                left: marc.x * CELL_SIZE + CELL_SIZE / 2,
                top: marc.y * CELL_SIZE + CELL_SIZE / 2,
                transform: `translate(-50%, -50%) rotate(${getMarcRotation()}deg)`,
              }}
            >
              {/* Cowboy body */}
              <div 
                className="relative"
                style={{ width: CELL_SIZE * 0.9, height: CELL_SIZE * 0.9 }}
              >
                {/* Cowboy hat */}
                <div 
                  className="absolute"
                  style={{
                    top: -4,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: CELL_SIZE * 0.8,
                    height: 6,
                    background: '#8B4513',
                    borderRadius: '50% 50% 0 0',
                  }}
                />
                <div 
                  className="absolute"
                  style={{
                    top: -8,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: CELL_SIZE * 0.5,
                    height: 8,
                    background: '#A0522D',
                    borderRadius: '50% 50% 0 0',
                  }}
                />
                {/* Face - Pac-Man style */}
                <svg width={CELL_SIZE * 0.9} height={CELL_SIZE * 0.9} viewBox="0 0 100 100">
                  <defs>
                    <linearGradient id="faceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFDAB9" />
                      <stop offset="100%" stopColor="#DEB887" />
                    </linearGradient>
                  </defs>
                  {mouthOpen ? (
                    <path
                      d="M50 50 L100 25 A50 50 0 1 0 100 75 Z"
                      fill="url(#faceGrad)"
                    />
                  ) : (
                    <circle cx="50" cy="50" r="45" fill="url(#faceGrad)" />
                  )}
                  {/* Eye */}
                  <circle cx="55" cy="30" r="6" fill="#333" />
                  {/* Wrinkles for old guy */}
                  <path d="M30 35 Q40 32 45 35" stroke="#B8860B" strokeWidth="1.5" fill="none" />
                  <path d="M25 45 Q35 42 40 45" stroke="#B8860B" strokeWidth="1" fill="none" />
                </svg>
              </div>
            </div>

            {/* Ghosts and Firefighters */}
            {ghosts.map((ghost, i) => (
              <div
                key={i}
                className="absolute transition-all duration-100"
                style={{
                  left: ghost.x * CELL_SIZE,
                  top: ghost.y * CELL_SIZE,
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                }}
              >
                {ghost.type === 'ghost' ? (
                  // Classic ghost shape
                  <svg viewBox="0 0 100 100" width={CELL_SIZE} height={CELL_SIZE}>
                    <path
                      d="M15 95 L15 45 A35 35 0 0 1 85 45 L85 95 L70 80 L55 95 L40 80 L25 95 L15 95 Z"
                      fill={ghost.color}
                    />
                    <circle cx="35" cy="45" r="8" fill="white" />
                    <circle cx="65" cy="45" r="8" fill="white" />
                    <circle cx="38" cy="45" r="4" fill="#333" />
                    <circle cx="68" cy="45" r="4" fill="#333" />
                  </svg>
                ) : (
                  // Firefighter
                  <div className="flex flex-col items-center justify-center h-full">
                    <span style={{ fontSize: CELL_SIZE * 0.8 }}>👨‍🚒</span>
                  </div>
                )}
              </div>
            ))}

            {/* Overlays */}
            {gameState === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90">
                <div className="text-4xl mb-2">🤠</div>
                <h2 className="text-xl font-bold text-yellow-400 mb-2">MarcMAN</h2>
                <Button onClick={startGame} className="gap-2 mb-2">
                  <Play className="h-4 w-4" />
                  Start Game
                </Button>
                <p className="text-xs text-white/60 text-center px-4">
                  Swipe to move • Collect toppings • Avoid ghosts & firefighters
                </p>
              </div>
            )}

            {gameState === 'gameover' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90">
                <p className="text-lg font-bold text-red-400 mb-1">Game Over!</p>
                <p className="text-2xl font-bold text-white mb-1">{score} pts</p>
                <p className="text-sm text-yellow-400 mb-2">🍕 ×{pizzaCount} pizzas made</p>
                <div className="flex gap-2">
                  <Button onClick={startGame} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Retry
                  </Button>
                  {score > 0 && (
                    <Button 
                      onClick={() => setShareDialogOpen(true)} 
                      variant="outline"
                      className="gap-2"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Pizza being built - visual */}
          {gameState === 'playing' && (
            <div className="mt-2 flex items-center gap-2">
              <div 
                className="relative w-12 h-12 rounded-full border-4 border-yellow-600 overflow-hidden"
                style={{ background: '#f4d03f' }}
              >
                {/* Cheese base */}
                <div className="absolute inset-1 rounded-full bg-yellow-300" />
                {/* Progress fill - sauce/toppings */}
                <div 
                  className="absolute inset-0 rounded-full bg-gradient-to-t from-red-500 to-orange-400 transition-all"
                  style={{ 
                    clipPath: `polygon(0 ${100 - (pizzaProgress / 12) * 100}%, 100% ${100 - (pizzaProgress / 12) * 100}%, 100% 100%, 0 100%)` 
                  }}
                />
                {/* Crust */}
                <div className="absolute inset-0 rounded-full border-4 border-yellow-700/50" />
              </div>
              <span className="text-xs text-muted-foreground">{pizzaProgress}/12</span>
            </div>
          )}
        </div>

        {/* Controls hint */}
        {gameState === 'playing' && (
          <p className="text-center text-xs text-muted-foreground py-1">
            Swipe or Arrow Keys to move
          </p>
        )}
      </div>

      <ShareScoreDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        gameType="marcman"
        score={score}
      />
    </Layout>
  );
};

export default MarcManGame;
