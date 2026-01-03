import { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, RotateCcw, Trophy, Share2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
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

// Portrait maze layout (11 wide x 19 tall) - 1 = wall, 0 = path
const MAZE_TEMPLATE = [
  [1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,1,0,0,0,0,1],
  [1,0,1,1,0,0,0,1,1,0,1],
  [1,0,0,0,0,1,0,0,0,0,1],
  [1,0,1,0,1,1,1,0,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,1],
  [1,1,0,1,0,1,0,1,0,1,1],
  [1,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,0,1,1,1,0,1,0,1],
  [0,0,0,0,1,0,1,0,0,0,0],
  [1,0,1,0,1,1,1,0,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,1],
  [1,1,0,1,0,1,0,1,0,1,1],
  [1,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,0,1,1,1,0,1,0,1],
  [1,0,0,0,0,1,0,0,0,0,1],
  [1,0,1,1,0,0,0,1,1,0,1],
  [1,0,0,0,0,1,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1],
];

const TOPPINGS = ['🍅', '🧀', '🫒', '🌶️', '🍄', '🧅', '🥓', '🍕'];
const GAME_SPEED = 180;

const MarcManGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const sounds = useGameSounds();
  const gameLoopRef = useRef<number>();
  const lastMoveTime = useRef(0);

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [marc, setMarc] = useState<Position>({ x: 5, y: 9 });
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
  const [cellSize, setCellSize] = useState(22);
  const containerRef = useRef<HTMLDivElement>(null);

  const mazeWidth = MAZE_TEMPLATE[0].length;
  const mazeHeight = MAZE_TEMPLATE.length;

  // Initialize toppings
  const initToppings = useCallback(() => {
    const newToppings: Topping[] = [];
    for (let y = 0; y < mazeHeight; y++) {
      for (let x = 0; x < mazeWidth; x++) {
        if (MAZE_TEMPLATE[y][x] === 0) {
          // Don't place on spawn points (center row)
          if (y === 9 && x >= 3 && x <= 7) continue;
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
  // Initialize ghosts
  const initGhosts = useCallback((): Ghost[] => {
    return [
      { x: 4, y: 9, direction: 'LEFT', type: 'ghost', color: '#FF0000' },
      { x: 6, y: 9, direction: 'RIGHT', type: 'ghost', color: '#00FFFF' },
      { x: 5, y: 8, direction: 'UP', type: 'firefighter', color: '#FF6600' },
      { x: 5, y: 10, direction: 'DOWN', type: 'firefighter', color: '#FFFF00' },
    ];
  }, []);

  // Start game
  const startGame = useCallback(() => {
    setMarc({ x: 5, y: 9 });
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
    // Handle tunnel (row 9 is the tunnel row)
    if (y === 9 && (x < 0 || x >= mazeWidth)) return true;
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

  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!touchStart.current) return;
    
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    
    const minSwipe = 20;
    if (Math.abs(dx) < minSwipe && Math.abs(dy) < minSwipe) {
      touchStart.current = null;
      return;
    }
    
    if (Math.abs(dx) > Math.abs(dy)) {
      handleDirectionChange(dx > 0 ? 'RIGHT' : 'LEFT');
    } else {
      handleDirectionChange(dy > 0 ? 'DOWN' : 'UP');
    }
    touchStart.current = null;
  }, [handleDirectionChange]);

  // Attach touch handlers to game area to prevent page scroll
  const gameAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gameAreaRef.current;
    if (!el || gameState !== 'playing') return;
    
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [gameState, handleTouchStart, handleTouchMove, handleTouchEnd]);

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

        // Handle tunnel wrap (row 9)
        if (newY === 9) {
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

          // Handle tunnel (row 9)
          if (newY === 9) {
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

  // Calculate cell size to fit screen - maximize game area
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const availableWidth = container.clientWidth - 8;
      // Leave room for pizza indicator (70px) and controls (140px)
      const availableHeight = container.clientHeight - 80;
      
      const cellByWidth = Math.floor(availableWidth / mazeWidth);
      const cellByHeight = Math.floor(availableHeight / mazeHeight);
      const newCellSize = Math.min(cellByWidth, cellByHeight);
      
      setCellSize(Math.max(newCellSize, 18)); // min 18px for visibility
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [mazeWidth, mazeHeight]);

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] px-1 overflow-hidden">
        {/* Header - minimal */}
        <div className="flex items-center gap-2 mb-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-bold">MarcMAN</h1>
          <div className="flex-1" />
          <span className="text-base font-bold text-primary">{score}</span>
          <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Trophy className="h-3 w-3 text-yellow-500" />
            <span>{highScore}</span>
          </div>
        </div>

        {/* Game Area - fills remaining space */}
        <div 
          ref={containerRef}
          className="flex-1 flex flex-col items-center justify-center min-h-0 w-full"
        >
          <div
            ref={gameAreaRef}
            className="relative rounded-lg overflow-hidden border-4 border-blue-900 touch-none"
            style={{
              width: mazeWidth * cellSize,
              height: mazeHeight * cellSize,
              background: '#0a0a1a',
            }}
          >
            {/* Maze walls */}
            {MAZE_TEMPLATE.map((row, y) =>
              row.map((cell, x) => (
                cell === 1 && (
                  <div
                    key={`${x}-${y}`}
                    className="absolute bg-blue-800 border border-blue-600"
                    style={{
                      left: x * cellSize,
                      top: y * cellSize,
                      width: cellSize,
                      height: cellSize,
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
                  left: t.x * cellSize,
                  top: t.y * cellSize,
                  width: cellSize,
                  height: cellSize,
                  fontSize: cellSize * 0.6,
                }}
              >
                {t.type}
              </div>
            ))}

            {/* Marc - old cowboy guy */}
            <div
              className="absolute transition-all duration-100"
              style={{
                left: marc.x * cellSize + cellSize / 2,
                top: marc.y * cellSize + cellSize / 2,
                transform: `translate(-50%, -50%) rotate(${getMarcRotation()}deg)`,
              }}
            >
              {/* Cowboy body */}
              <div 
                className="relative"
                style={{ width: cellSize * 0.9, height: cellSize * 0.9 }}
              >
                {/* Cowboy hat */}
                <div 
                  className="absolute"
                  style={{
                    top: -4,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: cellSize * 0.8,
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
                    width: cellSize * 0.5,
                    height: 8,
                    background: '#A0522D',
                    borderRadius: '50% 50% 0 0',
                  }}
                />
                {/* Face - Pac-Man style */}
                <svg width={cellSize * 0.9} height={cellSize * 0.9} viewBox="0 0 100 100">
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
                  left: ghost.x * cellSize,
                  top: ghost.y * cellSize,
                  width: cellSize,
                  height: cellSize,
                }}
              >
                {ghost.type === 'ghost' ? (
                  // Classic ghost shape
                  <svg viewBox="0 0 100 100" width={cellSize} height={cellSize}>
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
                    <span style={{ fontSize: cellSize * 0.8 }}>👨‍🚒</span>
                  </div>
                )}
              </div>
            ))}

            {/* Overlays */}
            {gameState === 'idle' && (
              <div 
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 z-50"
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <div className="text-5xl mb-3">🤠</div>
                <h2 className="text-2xl font-bold text-yellow-400 mb-4">MarcMAN</h2>
                <Button 
                  size="lg"
                  onClick={() => startGame()} 
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startGame();
                  }}
                  className="gap-2 mb-3 text-lg px-8 py-6"
                >
                  <Play className="h-5 w-5" />
                  Start Game
                </Button>
                <p className="text-sm text-white/60 text-center px-4">
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

          {/* Pizza with topping dots */}
          {gameState === 'playing' && (
            <div className="mt-2 flex items-center gap-3">
              {/* Round pizza with toppings */}
              <div 
                className="relative rounded-full shadow-lg"
                style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(145deg, #d4a556 0%, #c4903e 50%, #a87532 100%)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.2)',
                }}
              >
                {/* Cheese/sauce inner circle */}
                <div 
                  className="absolute rounded-full"
                  style={{
                    top: 4,
                    left: 4,
                    right: 4,
                    bottom: 4,
                    background: 'linear-gradient(145deg, #f5d77a 0%, #e8c54a 50%, #d4a832 100%)',
                  }}
                />
                {/* Sauce spots */}
                <div 
                  className="absolute rounded-full"
                  style={{
                    top: 6,
                    left: 6,
                    right: 6,
                    bottom: 6,
                    background: 'radial-gradient(circle at 30% 30%, rgba(200,60,30,0.3) 0%, transparent 50%), radial-gradient(circle at 70% 60%, rgba(200,60,30,0.25) 0%, transparent 40%)',
                  }}
                />
                {/* Topping dots - positioned in a nice pattern */}
                {[
                  { x: 28, y: 12 },  // top center
                  { x: 42, y: 18 },  // top right
                  { x: 46, y: 32 },  // right
                  { x: 40, y: 44 },  // bottom right
                  { x: 28, y: 46 },  // bottom center
                  { x: 14, y: 42 },  // bottom left
                  { x: 10, y: 28 },  // left
                  { x: 16, y: 16 },  // top left
                  { x: 28, y: 28 },  // center
                  { x: 36, y: 24 },  // inner right
                  { x: 22, y: 36 },  // inner bottom left
                  { x: 34, y: 36 },  // inner bottom right
                ].map((pos, i) => (
                  <div
                    key={i}
                    className="absolute rounded-full transition-all duration-300"
                    style={{
                      left: pos.x - 4,
                      top: pos.y - 4,
                      width: 8,
                      height: 8,
                      background: i < pizzaProgress 
                        ? 'radial-gradient(circle at 30% 30%, #c0392b 0%, #922b21 100%)'
                        : 'transparent',
                      boxShadow: i < pizzaProgress 
                        ? '0 1px 2px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.2)' 
                        : 'none',
                      opacity: i < pizzaProgress ? 1 : 0,
                      transform: i < pizzaProgress ? 'scale(1)' : 'scale(0)',
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{pizzaProgress}/12 toppings</span>
                <span className="text-sm font-bold">🍕 ×{pizzaCount}</span>
              </div>
            </div>
          )}
        </div>

        {/* On-screen D-pad controls */}
        {gameState === 'playing' && (
          <div className="shrink-0 flex justify-center py-2">
            <div className="relative w-32 h-32">
              {/* Up */}
              <button
                className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-10 bg-muted/80 hover:bg-muted active:bg-primary/30 rounded-lg flex items-center justify-center touch-none"
                onTouchStart={(e) => { e.preventDefault(); handleDirectionChange('UP'); }}
                onClick={() => handleDirectionChange('UP')}
              >
                <ChevronUp className="h-6 w-6" />
              </button>
              {/* Down */}
              <button
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-10 bg-muted/80 hover:bg-muted active:bg-primary/30 rounded-lg flex items-center justify-center touch-none"
                onTouchStart={(e) => { e.preventDefault(); handleDirectionChange('DOWN'); }}
                onClick={() => handleDirectionChange('DOWN')}
              >
                <ChevronDown className="h-6 w-6" />
              </button>
              {/* Left */}
              <button
                className="absolute left-0 top-1/2 -translate-y-1/2 w-10 h-10 bg-muted/80 hover:bg-muted active:bg-primary/30 rounded-lg flex items-center justify-center touch-none"
                onTouchStart={(e) => { e.preventDefault(); handleDirectionChange('LEFT'); }}
                onClick={() => handleDirectionChange('LEFT')}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              {/* Right */}
              <button
                className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 bg-muted/80 hover:bg-muted active:bg-primary/30 rounded-lg flex items-center justify-center touch-none"
                onTouchStart={(e) => { e.preventDefault(); handleDirectionChange('RIGHT'); }}
                onClick={() => handleDirectionChange('RIGHT')}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
              {/* Center circle */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-muted/50 rounded-full" />
            </div>
          </div>
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
