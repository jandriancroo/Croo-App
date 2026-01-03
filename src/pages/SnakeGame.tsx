import { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Play, RotateCcw, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
type Position = { x: number; y: number };

const GRID_SIZE = 20;
const CELL_SIZE = 16;
const INITIAL_SPEED = 150;
const SPEED_INCREMENT = 5;
const MIN_SPEED = 50;

const SnakeGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const gameAreaRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [snake, setSnake] = useState<Position[]>([{ x: 10, y: 10 }]);
  const [food, setFood] = useState<Position>({ x: 15, y: 15 });
  const [direction, setDirection] = useState<Direction>('RIGHT');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [speed, setSpeed] = useState(INITIAL_SPEED);

  const directionRef = useRef(direction);
  directionRef.current = direction;

  // Generate random food position
  const generateFood = useCallback((currentSnake: Position[]): Position => {
    let newFood: Position;
    do {
      newFood = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
    } while (currentSnake.some(segment => segment.x === newFood.x && segment.y === newFood.y));
    return newFood;
  }, []);

  // Initialize game
  const startGame = useCallback(() => {
    const initialSnake = [{ x: 10, y: 10 }];
    setSnake(initialSnake);
    setFood(generateFood(initialSnake));
    setDirection('RIGHT');
    directionRef.current = 'RIGHT';
    setScore(0);
    setSpeed(INITIAL_SPEED);
    setGameState('playing');
  }, [generateFood]);

  // Handle tap to turn (clockwise rotation)
  const handleTap = useCallback(() => {
    if (gameState !== 'playing') return;
    
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
        if (newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE) {
          setGameState('gameover');
          return prevSnake;
        }

        // Check self collision
        if (prevSnake.some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
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
  }, [gameState, food, speed, generateFood]);

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

  return (
    <Layout>
      <div className="container max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold flex-1">Snake</h1>
          <div className="flex items-center gap-2 text-sm">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span className="font-medium">{highScore}</span>
          </div>
        </div>

        {/* Score */}
        <div className="text-center">
          <p className="text-3xl font-bold">{score}</p>
          <p className="text-sm text-muted-foreground">Score</p>
        </div>

        {/* Game Area */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div
              ref={gameAreaRef}
              className="relative bg-muted/30 cursor-pointer select-none"
              style={{
                width: GRID_SIZE * CELL_SIZE,
                height: GRID_SIZE * CELL_SIZE,
                margin: '0 auto',
              }}
              onClick={handleTap}
              onTouchStart={(e) => {
                e.preventDefault();
                handleTap();
              }}
            >
              {/* Grid background */}
              <div 
                className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage: `
                    linear-gradient(to right, currentColor 1px, transparent 1px),
                    linear-gradient(to bottom, currentColor 1px, transparent 1px)
                  `,
                  backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`,
                }}
              />

              {/* Snake */}
              {snake.map((segment, index) => (
                <div
                  key={index}
                  className={`absolute rounded-sm transition-all duration-75 ${
                    index === 0 ? 'bg-primary' : 'bg-primary/70'
                  }`}
                  style={{
                    left: segment.x * CELL_SIZE,
                    top: segment.y * CELL_SIZE,
                    width: CELL_SIZE - 1,
                    height: CELL_SIZE - 1,
                  }}
                />
              ))}

              {/* Food */}
              <div
                className="absolute rounded-full bg-destructive animate-pulse"
                style={{
                  left: food.x * CELL_SIZE + 2,
                  top: food.y * CELL_SIZE + 2,
                  width: CELL_SIZE - 4,
                  height: CELL_SIZE - 4,
                }}
              />

              {/* Overlays */}
              {gameState === 'idle' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
                  <Button onClick={startGame} size="lg" className="gap-2">
                    <Play className="h-5 w-5" />
                    Start Game
                  </Button>
                  <p className="text-sm text-muted-foreground mt-3">
                    Tap anywhere to turn clockwise
                  </p>
                </div>
              )}

              {gameState === 'gameover' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
                  <p className="text-xl font-bold text-destructive mb-2">Game Over!</p>
                  <p className="text-2xl font-bold mb-4">{score} points</p>
                  <Button onClick={startGame} size="lg" className="gap-2">
                    <RotateCcw className="h-5 w-5" />
                    Play Again
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        {gameState === 'playing' && (
          <p className="text-center text-sm text-muted-foreground">
            Tap anywhere or press Space to turn right
          </p>
        )}
      </div>
    </Layout>
  );
};

export default SnakeGame;
