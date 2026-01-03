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

const INITIAL_SPEED = 120;
const SPEED_INCREMENT = 3;
const MIN_SPEED = 60;

const SnakeGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, cellSize: 20, gridWidth: 15, gridHeight: 20 });
  
  // Background music - retro arcade theme
  const sounds = useGameSounds();

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [snake, setSnake] = useState<Position[]>([{ x: 7, y: 10 }, { x: 6, y: 10 }, { x: 5, y: 10 }]);
  const [food, setFood] = useState<Position>({ x: 12, y: 10 });
  const [direction, setDirection] = useState<Direction>('RIGHT');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [speed, setSpeed] = useState(INITIAL_SPEED);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const lastTurnTime = useRef(0);

  const directionRef = useRef(direction);
  directionRef.current = direction;

  // Calculate grid dimensions based on screen size
  useEffect(() => {
    const updateDimensions = () => {
      const maxWidth = Math.min(window.innerWidth - 32, 400);
      const maxHeight = window.innerHeight - 200;
      const cellSize = 18;
      const gridWidth = Math.floor(maxWidth / cellSize);
      const gridHeight = Math.floor(maxHeight / cellSize);
      
      setDimensions({
        width: gridWidth * cellSize,
        height: gridHeight * cellSize,
        cellSize,
        gridWidth,
        gridHeight
      });
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Generate random food position
  const generateFood = useCallback((currentSnake: Position[]): Position => {
    let newFood: Position;
    do {
      newFood = {
        x: Math.floor(Math.random() * dimensions.gridWidth),
        y: Math.floor(Math.random() * dimensions.gridHeight),
      };
    } while (currentSnake.some(segment => segment.x === newFood.x && segment.y === newFood.y));
    return newFood;
  }, [dimensions.gridWidth, dimensions.gridHeight]);

  // Initialize game
  const startGame = useCallback(() => {
    const startX = Math.floor(dimensions.gridWidth / 2);
    const startY = Math.floor(dimensions.gridHeight / 2);
    const initialSnake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];
    setSnake(initialSnake);
    setFood(generateFood(initialSnake));
    setDirection('RIGHT');
    directionRef.current = 'RIGHT';
    setScore(0);
    setSpeed(INITIAL_SPEED);
    setGameState('playing');
    sounds.startMusic('retro'); // Start retro arcade music
  }, [generateFood, dimensions.gridWidth, dimensions.gridHeight, sounds]);

  // Handle tap to turn (clockwise rotation) - debounced to prevent double turns
  const handleTap = useCallback(() => {
    if (gameState !== 'playing') return;
    
    // Debounce to prevent double turns from both click and touch events
    const now = Date.now();
    if (now - lastTurnTime.current < 100) return;
    lastTurnTime.current = now;
    
    const rotationMap: Record<Direction, Direction> = {
      'UP': 'RIGHT',
      'RIGHT': 'DOWN',
      'DOWN': 'LEFT',
      'LEFT': 'UP',
    };
    
    setDirection(prev => {
      const newDir = rotationMap[prev];
      directionRef.current = newDir;
      return newDir;
    });
  }, [gameState]);

  // Save high score
  const saveHighScore = useCallback(async (finalScore: number) => {
    if (!user?.id || finalScore === 0) return;
    
    try {
      await supabase.from('game_high_scores').insert({
        user_id: user.id,
        game_type: 'snake',
        score: finalScore,
      });
      queryClient.invalidateQueries({ queryKey: ['high-scores', 'snake'] });
      
      if (finalScore > highScore) {
        setHighScore(finalScore);
        toast.success(`New personal best: ${finalScore}!`);
      }
    } catch (error) {
      console.error('Failed to save score:', error);
    }
  }, [user?.id, highScore, queryClient]);

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const moveSnake = () => {
      setSnake(prevSnake => {
        const head = prevSnake[0];
        const currentDirection = directionRef.current;
        
        const directionDeltas: Record<Direction, Position> = {
          'UP': { x: 0, y: -1 },
          'DOWN': { x: 0, y: 1 },
          'LEFT': { x: -1, y: 0 },
          'RIGHT': { x: 1, y: 0 },
        };

        const delta = directionDeltas[currentDirection];
        const newHead = {
          x: head.x + delta.x,
          y: head.y + delta.y,
        };

        // Check wall collision
        if (newHead.x < 0 || newHead.x >= dimensions.gridWidth || newHead.y < 0 || newHead.y >= dimensions.gridHeight) {
          setGameState('gameover');
          return prevSnake;
        }

        // Check self collision (skip the tail since it will move)
        const bodyToCheck = prevSnake.slice(0, -1);
        if (bodyToCheck.some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
          setGameState('gameover');
          return prevSnake;
        }

        const newSnake = [newHead, ...prevSnake];

        // Check food collision
        if (newHead.x === food.x && newHead.y === food.y) {
          setScore(prev => prev + 10);
          setFood(generateFood(newSnake));
          setSpeed(prev => Math.max(MIN_SPEED, prev - SPEED_INCREMENT));
          return newSnake; // Don't remove tail (snake grows)
        }

        newSnake.pop(); // Remove tail
        return newSnake;
      });
    };

    const interval = setInterval(moveSnake, speed);
    return () => clearInterval(interval);
  }, [gameState, food, speed, generateFood, dimensions.gridWidth, dimensions.gridHeight]);

  // Handle game over
  useEffect(() => {
    if (gameState === 'gameover') {
      saveHighScore(score);
    }
  }, [gameState, score, saveHighScore]);

  // Fetch personal high score
  useEffect(() => {
    const fetchHighScore = async () => {
      if (!user?.id) return;
      
      const { data } = await supabase
        .from('game_high_scores')
        .select('score')
        .eq('user_id', user.id)
        .eq('game_type', 'snake')
        .order('score', { ascending: false })
        .limit(1)
        .single();
      
      if (data) setHighScore(data.score);
    };
    fetchHighScore();
  }, [user?.id]);

  // Keyboard controls for desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'playing') return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleTap();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, handleTap]);

  const { cellSize } = dimensions;

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] px-4 py-2">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold flex-1">Snake</h1>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{score}</p>
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <span>{highScore}</span>
            </div>
          </div>
        </div>

        {/* Game Area */}
        <div className="flex-1 flex items-center justify-center">
          <div
            ref={gameAreaRef}
            className="relative bg-muted/20 border border-border rounded-lg cursor-pointer select-none overflow-hidden"
            style={{
              width: dimensions.width,
              height: dimensions.height,
            }}
            onClick={handleTap}
            onTouchStart={(e) => {
              e.preventDefault();
              handleTap();
            }}
          >
            {/* Grid background */}
            <div 
              className="absolute inset-0 opacity-5"
              style={{
                backgroundImage: `
                  linear-gradient(to right, currentColor 1px, transparent 1px),
                  linear-gradient(to bottom, currentColor 1px, transparent 1px)
                `,
                backgroundSize: `${cellSize}px ${cellSize}px`,
              }}
            />

            {/* Snake */}
            {snake.map((segment, index) => (
              <div
                key={index}
                className={`absolute rounded-sm ${
                  index === 0 ? 'bg-green-500' : 'bg-green-400'
                }`}
                style={{
                  left: segment.x * cellSize + 1,
                  top: segment.y * cellSize + 1,
                  width: cellSize - 2,
                  height: cellSize - 2,
                  boxShadow: index === 0 ? '0 0 8px rgba(34, 197, 94, 0.5)' : undefined,
                }}
              />
            ))}

            {/* Food */}
            <div
              className="absolute rounded-full bg-red-500 animate-pulse"
              style={{
                left: food.x * cellSize + 3,
                top: food.y * cellSize + 3,
                width: cellSize - 6,
                height: cellSize - 6,
                boxShadow: '0 0 10px rgba(239, 68, 68, 0.6)',
              }}
            />

            {/* Overlays */}
            {gameState === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
                <div className="text-6xl mb-4">🐍</div>
                <Button onClick={startGame} size="lg" className="gap-2 mb-3">
                  <Play className="h-5 w-5" />
                  Start Game
                </Button>
                <p className="text-sm text-muted-foreground">
                  Tap anywhere to turn clockwise
                </p>
              </div>
            )}

            {gameState === 'gameover' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
                <p className="text-xl font-bold text-destructive mb-2">Game Over!</p>
                <p className="text-3xl font-bold mb-4">{score} pts</p>
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
                      className="gap-2"
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
            Tap anywhere to turn • Space on desktop
          </p>
        )}
      </div>

      <ShareScoreDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        gameType="snake"
        score={score}
      />
    </Layout>
  );
};

export default SnakeGame;
