import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Play, RotateCcw, Trophy, Flag, Bomb, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ShareScoreDialog } from "@/components/games/ShareScoreDialog";

type CellState = {
  isMine: boolean;
  isRevealed: boolean;
  isFlagged: boolean;
  adjacentMines: number;
};

type Difficulty = 'easy' | 'medium' | 'hard';

const DIFFICULTIES: Record<Difficulty, { rows: number; cols: number; mines: number }> = {
  easy: { rows: 8, cols: 8, mines: 10 },
  medium: { rows: 12, cols: 10, mines: 25 },
  hard: { rows: 16, cols: 12, mines: 45 },
};

const MinesweeperGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'won' | 'lost'>('idle');
  const [board, setBoard] = useState<CellState[][]>([]);
  const [flagCount, setFlagCount] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [finalScore, setFinalScore] = useState(0);

  const config = DIFFICULTIES[difficulty];

  // Initialize board
  const initializeBoard = useCallback((firstClickRow: number, firstClickCol: number) => {
    const newBoard: CellState[][] = Array(config.rows)
      .fill(null)
      .map(() =>
        Array(config.cols).fill(null).map(() => ({
          isMine: false,
          isRevealed: false,
          isFlagged: false,
          adjacentMines: 0,
        }))
      );

    // Place mines (avoiding first click area)
    let minesPlaced = 0;
    while (minesPlaced < config.mines) {
      const row = Math.floor(Math.random() * config.rows);
      const col = Math.floor(Math.random() * config.cols);
      
      // Don't place mine on or adjacent to first click
      const isNearFirstClick = Math.abs(row - firstClickRow) <= 1 && Math.abs(col - firstClickCol) <= 1;
      
      if (!newBoard[row][col].isMine && !isNearFirstClick) {
        newBoard[row][col].isMine = true;
        minesPlaced++;
      }
    }

    // Calculate adjacent mines
    for (let row = 0; row < config.rows; row++) {
      for (let col = 0; col < config.cols; col++) {
        if (!newBoard[row][col].isMine) {
          let count = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = row + dr;
              const nc = col + dc;
              if (nr >= 0 && nr < config.rows && nc >= 0 && nc < config.cols && newBoard[nr][nc].isMine) {
                count++;
              }
            }
          }
          newBoard[row][col].adjacentMines = count;
        }
      }
    }

    return newBoard;
  }, [config]);

  // Start new game
  const startGame = useCallback(() => {
    setBoard(
      Array(config.rows)
        .fill(null)
        .map(() =>
          Array(config.cols).fill(null).map(() => ({
            isMine: false,
            isRevealed: false,
            isFlagged: false,
            adjacentMines: 0,
          }))
        )
    );
    setGameState('playing');
    setFlagCount(0);
    setStartTime(null);
    setElapsedTime(0);
  }, [config]);

  // Reveal cell
  const revealCell = useCallback((row: number, col: number, currentBoard: CellState[][]): CellState[][] => {
    if (
      row < 0 || row >= config.rows ||
      col < 0 || col >= config.cols ||
      currentBoard[row][col].isRevealed ||
      currentBoard[row][col].isFlagged
    ) {
      return currentBoard;
    }

    const newBoard = currentBoard.map(r => r.map(c => ({ ...c })));
    newBoard[row][col].isRevealed = true;

    // If empty cell, reveal adjacent cells
    if (newBoard[row][col].adjacentMines === 0 && !newBoard[row][col].isMine) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr !== 0 || dc !== 0) {
            const result = revealCell(row + dr, col + dc, newBoard);
            for (let r = 0; r < config.rows; r++) {
              for (let c = 0; c < config.cols; c++) {
                newBoard[r][c] = result[r][c];
              }
            }
          }
        }
      }
    }

    return newBoard;
  }, [config]);

  // Handle cell click
  const handleCellClick = useCallback((row: number, col: number) => {
    if (gameState !== 'playing') return;
    if (board[row][col].isFlagged || board[row][col].isRevealed) return;

    let currentBoard = board;

    // First click - initialize board
    if (!startTime) {
      currentBoard = initializeBoard(row, col);
      setStartTime(Date.now());
    }

    // Check if mine
    if (currentBoard[row][col].isMine) {
      // Reveal all mines
      const newBoard = currentBoard.map(r => r.map(c => ({
        ...c,
        isRevealed: c.isMine ? true : c.isRevealed,
      })));
      setBoard(newBoard);
      setGameState('lost');
      return;
    }

    // Reveal cell
    const newBoard = revealCell(row, col, currentBoard);
    setBoard(newBoard);

    // Check win condition
    const unrevealedNonMines = newBoard.flat().filter(c => !c.isRevealed && !c.isMine).length;
    if (unrevealedNonMines === 0) {
      setGameState('won');
    }
  }, [board, gameState, startTime, initializeBoard, revealCell]);

  // Handle flag (long press)
  const handleFlag = useCallback((row: number, col: number) => {
    if (gameState !== 'playing') return;
    if (board[row][col].isRevealed) return;

    setBoard(prev => {
      const newBoard = prev.map(r => r.map(c => ({ ...c })));
      newBoard[row][col].isFlagged = !newBoard[row][col].isFlagged;
      return newBoard;
    });

    setFlagCount(prev => board[row][col].isFlagged ? prev - 1 : prev + 1);
  }, [board, gameState]);

  // Long press handlers
  const handleTouchStart = (row: number, col: number) => {
    const timer = setTimeout(() => {
      handleFlag(row, col);
    }, 500);
    setLongPressTimer(timer);
  };

  const handleTouchEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  // Save score on win
  const saveScore = useCallback(async () => {
    if (!user?.id || !startTime) return;
    
    // Score = base points + time bonus
    const timeBonus = Math.max(0, 1000 - elapsedTime);
    const difficultyMultiplier = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3;
    const score = (config.mines * 10 + timeBonus) * difficultyMultiplier;
    
    // Store the final score for sharing
    setFinalScore(score);

    try {
      await supabase.from('game_high_scores').insert({
        user_id: user.id,
        game_type: 'minesweeper',
        score,
      });
      queryClient.invalidateQueries({ queryKey: ['high-scores', 'minesweeper'] });
      
      if (score > highScore) {
        setHighScore(score);
        toast.success(`New personal best: ${score}!`);
      }
    } catch (error) {
      console.error('Failed to save score:', error);
    }
  }, [user?.id, startTime, elapsedTime, difficulty, config.mines, highScore, queryClient]);

  // Timer
  useEffect(() => {
    if (gameState !== 'playing' || !startTime) return;
    
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [gameState, startTime]);

  // Handle win
  useEffect(() => {
    if (gameState === 'won') {
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
        .eq('game_type', 'minesweeper')
        .order('score', { ascending: false })
        .limit(1)
        .single();
      
      if (data) setHighScore(data.score);
    };
    fetchHighScore();
  }, [user?.id]);

  // Get cell color based on adjacent mines
  const getNumberColor = (num: number) => {
    const colors = [
      '',
      'text-blue-500',
      'text-green-500',
      'text-red-500',
      'text-purple-500',
      'text-amber-600',
      'text-cyan-500',
      'text-black dark:text-white',
      'text-gray-500',
    ];
    return colors[num] || '';
  };

  const cellSize = difficulty === 'hard' ? 24 : difficulty === 'medium' ? 28 : 32;

  return (
    <Layout>
      <div className="container max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold flex-1">Minesweeper</h1>
          <div className="flex items-center gap-2 text-sm">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span className="font-medium">{highScore}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bomb className="h-4 w-4 text-destructive" />
            <span className="font-mono">{config.mines - flagCount}</span>
          </div>
          <div className="flex gap-1">
            {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
              <Button
                key={d}
                variant={difficulty === d ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setDifficulty(d);
                  setGameState('idle');
                }}
                className="capitalize text-xs px-2"
              >
                {d}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono">{elapsedTime}s</span>
          </div>
        </div>

        {/* Game Board */}
        <Card className="overflow-hidden">
          <CardContent className="p-2 flex justify-center">
            {gameState === 'idle' ? (
              <div className="py-12 text-center">
                <Button onClick={startGame} size="lg" className="gap-2">
                  <Play className="h-5 w-5" />
                  Start Game
                </Button>
                <p className="text-sm text-muted-foreground mt-3">
                  Tap to reveal, long-press to flag
                </p>
              </div>
            ) : (
              <div className="relative">
                <div
                  className="grid gap-0.5"
                  style={{
                    gridTemplateColumns: `repeat(${config.cols}, ${cellSize}px)`,
                  }}
                >
                  {board.map((row, rowIdx) =>
                    row.map((cell, colIdx) => (
                      <button
                        key={`${rowIdx}-${colIdx}`}
                        className={cn(
                          'flex items-center justify-center text-xs font-bold transition-colors select-none',
                          cell.isRevealed
                            ? cell.isMine
                              ? 'bg-destructive text-destructive-foreground'
                              : 'bg-muted/50'
                            : 'bg-primary/20 hover:bg-primary/30 active:bg-primary/40'
                        )}
                        style={{ width: cellSize, height: cellSize }}
                        onClick={() => {
                          if (!longPressTimer) {
                            handleCellClick(rowIdx, colIdx);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          handleFlag(rowIdx, colIdx);
                        }}
                        onTouchStart={() => handleTouchStart(rowIdx, colIdx)}
                        onTouchEnd={handleTouchEnd}
                        onTouchCancel={handleTouchEnd}
                        disabled={gameState !== 'playing'}
                      >
                        {cell.isRevealed ? (
                          cell.isMine ? (
                            <Bomb className="h-3 w-3" />
                          ) : cell.adjacentMines > 0 ? (
                            <span className={getNumberColor(cell.adjacentMines)}>
                              {cell.adjacentMines}
                            </span>
                          ) : null
                        ) : cell.isFlagged ? (
                          <Flag className="h-3 w-3 text-destructive" />
                        ) : null}
                      </button>
                    ))
                  )}
                </div>

                {/* Game Over Overlay */}
                {(gameState === 'won' || gameState === 'lost') && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
                    <p className={cn(
                      'text-xl font-bold mb-2',
                      gameState === 'won' ? 'text-green-500' : 'text-destructive'
                    )}>
                      {gameState === 'won' ? 'You Won!' : 'Game Over!'}
                    </p>
                    <p className="text-lg mb-4">Time: {elapsedTime}s</p>
                    <div className="flex gap-2">
                      <Button onClick={startGame} size="lg" className="gap-2">
                        <RotateCcw className="h-5 w-5" />
                        Play Again
                      </Button>
                      {gameState === 'won' && finalScore > 0 && (
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
          </CardContent>
        </Card>

        {/* Instructions */}
        {gameState === 'playing' && (
          <p className="text-center text-sm text-muted-foreground">
            Tap to reveal • Long-press or right-click to flag
          </p>
        )}
      </div>

      <ShareScoreDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        gameType="minesweeper"
        score={finalScore}
      />
    </Layout>
  );
};

export default MinesweeperGame;
