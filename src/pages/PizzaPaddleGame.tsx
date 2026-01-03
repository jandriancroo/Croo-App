import { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, RotateCcw, Trophy, Share2, Heart, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ShareScoreDialog } from "@/components/games/ShareScoreDialog";
import { useGameSounds } from "@/hooks/useGameSounds";

// Import Karen head images
import karenHead1 from "@/assets/karen-head-1.jpeg";
import karenHead2 from "@/assets/karen-head-2.jpeg";
import karenHead3 from "@/assets/karen-head-3.jpeg";

interface Player {
  x: number;
  y: number;
  velocityY: number;
  velocityX: number;
  isJumping: boolean;
  jumpCount: number;
  width: number;
  height: number;
  frame: number;
  isHurt: boolean;
  paddleSwing: number;
  isSwinging: boolean;
  facingRight: boolean;
}

interface Karen {
  x: number;
  y: number;
  type: 'basic' | 'manager' | 'supervisor' | 'regional' | 'boss';
  width: number;
  height: number;
  isHit: boolean;
  velocityY: number;
  isBoss: boolean;
  phrase: string;
  headImage: number;
  usePhoto: boolean; // true = meme photo, false = cartoon
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  text?: string;
}

interface Topping {
  x: number;
  y: number;
  type: 'pepperoni' | 'mushroom' | 'olive' | 'pepper' | 'cheese';
  width: number;
  height: number;
  collected: boolean;
  velocityY: number;
}

interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'brick' | 'pipe';
}

type LevelTheme = 'city' | 'desert' | 'mountains' | 'space' | 'hell' | 'heaven' | 'hemet';

interface Level {
  theme: LevelTheme;
  name: string;
  scoreThreshold: number;
}

const LEVELS: Level[] = [
  { theme: 'city', name: 'Downtown Pizza', scoreThreshold: 0 },
  { theme: 'desert', name: 'Desert Heat', scoreThreshold: 150 },
  { theme: 'mountains', name: 'Mountain High', scoreThreshold: 300 },
  { theme: 'hemet', name: 'HEMET', scoreThreshold: 500 },
  { theme: 'space', name: 'Space Station', scoreThreshold: 750 },
  { theme: 'hell', name: 'Karen\'s Lair', scoreThreshold: 1000 },
  { theme: 'heaven', name: 'Pizza Paradise', scoreThreshold: 1500 },
];

const GRAVITY = 0.6;
const JUMP_FORCE = -14;
const GAME_SPEED_START = 3;
const KAREN_SPAWN_RATE_START = 150; // Start with fewer Karens
const BOSS_SPAWN_RATE = 700;
const TOPPING_SPAWN_RATE = 140;
const PLATFORM_SPAWN_RATE = 180;
const PIPE_SPAWN_RATE = 280;
const PLAYER_SPEED = 4;

const TOPPING_CONFIG = {
  pepperoni: { emoji: '🍕', points: 5, color: '#e74c3c' },
  mushroom: { emoji: '🍄', points: 8, color: '#8b7355' },
  olive: { emoji: '🫒', points: 6, color: '#556b2f' },
  pepper: { emoji: '🌶️', points: 10, color: '#ff4500' },
  cheese: { emoji: '🧀', points: 15, color: '#ffd700' },
};

// Regular Karen phrases - more variety
const KAREN_PHRASES = [
  '"I want to speak to the manager"',
  '"This is unacceptable!"',
  '"I know the owner!"',
  '"I\'ll have your job!"',
  '"Do you know who I am?"',
  '"I\'ve been a customer for 20 years!"',
  '"The customer is always right!"',
  '"I\'ll call corporate!"',
  '"Where\'s your supervisor?"',
  '"This is discrimination!"',
  '"I want a refund NOW!"',
  '"I\'ll leave a 1-star review!"',
  '"Get me someone who knows what they\'re doing!"',
  '"I\'m never coming back here!"',
  '"You just lost a customer!"',
];

// Super Karen (boss) phrases - the MEANEST ones
const BOSS_KAREN_PHRASES = [
  '"I WILL DESTROY YOUR CAREER!"',
  '"MY HUSBAND IS A LAWYER!"',
  '"I\'LL SUE THIS ENTIRE ESTABLISHMENT!"',
  '"YOU\'RE ALL GETTING FIRED TODAY!"',
  '"I KNOW THE CEO PERSONALLY!"',
  '"THIS PLACE WILL BE SHUT DOWN!"',
  '"I\'M CALLING THE HEALTH DEPARTMENT!"',
  '"YOUR MANAGER WILL HEAR ABOUT THIS!"',
  '"I\'VE RUINED BUSINESSES BEFORE!"',
  '"YOU\'LL REGRET THE DAY YOU WERE BORN!"',
];

const KAREN_CONFIG = {
  basic: { points: 10, hairColor: '#c9a227' },
  manager: { points: 15, hairColor: '#8b4513' },
  supervisor: { points: 20, hairColor: '#2c1810' },
  regional: { points: 25, hairColor: '#4a0e0e' },
  boss: { points: 100, hairColor: '#1a1a1a' },
};

// Sound effect utilities using Web Audio API
const audioContextRef = { current: null as AudioContext | null };

const getAudioContext = () => {
  if (!audioContextRef.current) {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContextRef.current;
};

const playSound = (type: 'hit' | 'hurt' | 'collect' | 'jump' | 'bossHit' | 'gameOver' | 'land' | 'levelUp') => {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    switch (type) {
      case 'hit':
        oscillator.frequency.setValueAtTime(400, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.1);
        break;
      case 'bossHit':
        oscillator.frequency.setValueAtTime(150, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.3);
        break;
      case 'hurt':
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(200, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.2);
        break;
      case 'collect':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.1);
        break;
      case 'jump':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(300, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.1);
        break;
      case 'land':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(150, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.05);
        gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.05);
        break;
      case 'gameOver':
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(400, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.5);
        break;
      case 'levelUp':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(400, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
        oscillator.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.3);
        oscillator.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.45);
        gainNode.gain.setValueAtTime(0.25, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.5);
        break;
    }
  } catch (e) {
    // Audio not supported
  }
};

const PizzaPaddleGame = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number>();
  const karenImagesRef = useRef<HTMLImageElement[]>([]);
  
  // Background music using WebAudio
  const sounds = useGameSounds();

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [combo, setCombo] = useState(0);
  const [currentLevel, setCurrentLevel] = useState<Level>(LEVELS[0]);
  const [movingLeft, setMovingLeft] = useState(false);
  const [movingRight, setMovingRight] = useState(false);
  const [screenShake, setScreenShake] = useState(0);
  const screenShakeRef = useRef(0);

  const playerRef = useRef<Player>({
    x: 80,
    y: 0,
    velocityY: 0,
    velocityX: 0,
    isJumping: false,
    jumpCount: 0,
    width: 40,
    height: 50,
    frame: 0,
    isHurt: false,
    paddleSwing: 0,
    isSwinging: false,
    facingRight: true,
  });

  const karensRef = useRef<Karen[]>([]);
  const toppingsRef = useRef<Topping[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const platformsRef = useRef<Platform[]>([]);
  const gameSpeedRef = useRef(GAME_SPEED_START);
  const frameCountRef = useRef(0);
  const groundYRef = useRef(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const comboRef = useRef(0);
  const lastHitTimeRef = useRef(0);
  const wasJumpingRef = useRef(false);
  const currentLevelRef = useRef<Level>(LEVELS[0]);
  const karenSpawnRateRef = useRef(KAREN_SPAWN_RATE_START);
  const touchStartXRef = useRef(0);
  const movingLeftRef = useRef(false);
  const movingRightRef = useRef(false);

  // Load Karen head images
  useEffect(() => {
    const images = [karenHead1, karenHead2, karenHead3].map(src => {
      const img = new Image();
      img.src = src;
      return img;
    });
    karenImagesRef.current = images;
  }, []);

  const getCanvasDimensions = useCallback(() => {
    const width = Math.min(window.innerWidth - 24, 500);
    const height = Math.min(window.innerHeight - 180, 550);
    return { width, height };
  }, []);

  const initGame = useCallback(() => {
    const { width, height } = getCanvasDimensions();
    groundYRef.current = height - 50;
    
    playerRef.current = {
      x: 80,
      y: groundYRef.current - 50,
      velocityY: 0,
      velocityX: 0,
      isJumping: false,
      jumpCount: 0,
      width: 40,
      height: 50,
      frame: 0,
      isHurt: false,
      paddleSwing: 0,
      isSwinging: false,
      facingRight: true,
    };
    
    // Initialize with some starting platforms
    platformsRef.current = [
      { x: 180, y: height - 130, width: 80, height: 24, type: 'brick' },
      { x: 320, y: height - 180, width: 60, height: 24, type: 'brick' },
    ];
    
    karensRef.current = [];
    toppingsRef.current = [];
    particlesRef.current = [];
    gameSpeedRef.current = GAME_SPEED_START;
    frameCountRef.current = 0;
    scoreRef.current = 0;
    livesRef.current = 3;
    comboRef.current = 0;
    lastHitTimeRef.current = 0;
    currentLevelRef.current = LEVELS[0];
    karenSpawnRateRef.current = KAREN_SPAWN_RATE_START;
    setScore(0);
    setLives(3);
    setCombo(0);
    setCurrentLevel(LEVELS[0]);
    setGameState('playing');
    sounds.startMusic('retro'); // Start background music
  }, [getCanvasDimensions, sounds]);

  const handleJump = useCallback(() => {
    if (gameState !== 'playing') return;
    
    const player = playerRef.current;
    // Allow double jump (up to 2 jumps)
    if (player.jumpCount < 2) {
      // For double jump, give slightly less velocity
      const jumpForce = player.jumpCount === 0 ? JUMP_FORCE : JUMP_FORCE * 0.85;
      player.velocityY = jumpForce;
      player.isJumping = true;
      player.jumpCount++;
      wasJumpingRef.current = true;
      playSound('jump');
      
      // Only trigger paddle swing if not already swinging
      if (!player.isSwinging) {
        player.isSwinging = true;
        player.paddleSwing = 0;
      }
    }
  }, [gameState]);

  const handleMoveLeft = useCallback((start: boolean) => {
    movingLeftRef.current = start;
    setMovingLeft(start);
    if (start) {
      playerRef.current.facingRight = false;
    }
  }, []);

  const handleMoveRight = useCallback((start: boolean) => {
    movingRightRef.current = start;
    setMovingRight(start);
    if (start) {
      playerRef.current.facingRight = true;
    }
  }, []);

  const spawnParticles = (x: number, y: number, color: string, count: number, text?: string, isExplosion?: boolean) => {
    for (let i = 0; i < count; i++) {
      const angle = isExplosion ? (i / count) * Math.PI * 2 : Math.random() * Math.PI * 2;
      const speed = isExplosion ? 4 + Math.random() * 6 : (Math.random() - 0.5) * 8;
      particlesRef.current.push({
        x,
        y,
        vx: isExplosion ? Math.cos(angle) * speed : (Math.random() - 0.5) * 8,
        vy: isExplosion ? Math.sin(angle) * speed : (Math.random() - 1) * 6,
        life: isExplosion ? 40 : 30,
        color,
        text: i === 0 ? text : undefined,
      });
    }
  };

  const triggerScreenShake = (intensity: number) => {
    screenShakeRef.current = intensity;
    setScreenShake(intensity);
  };

  const checkCollision = (rect1: { x: number; y: number; width: number; height: number }, rect2: { x: number; y: number; width: number; height: number }) => {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  };

  // Get level colors based on theme
  const getLevelColors = (theme: LevelTheme) => {
    switch (theme) {
      case 'city':
        return {
          sky: ['#5c94fc', '#87ceeb', '#5c94fc'],
          ground: '#555555',
          groundPattern: '#666666',
          groundDark: '#444444',
          grass: '#00a800',
          hills: '#2a8000',
          clouds: '#ffffff',
          pipe: ['#1a1a1a', '#3a3a3a'],
          brick: ['#c84c0c', '#e87020', '#8c3808'],
        };
      case 'desert':
        return {
          sky: ['#ff9966', '#ffcc99', '#ff9966'],
          ground: '#d4a574',
          groundPattern: '#c49464',
          groundDark: '#b48454',
          grass: '#8b7355',
          hills: '#d4a574',
          clouds: '#ffe4c4',
          pipe: ['#654321', '#8b5a2b'],
          brick: ['#cd853f', '#deb887', '#a0522d'],
        };
      case 'mountains':
        return {
          sky: ['#87ceeb', '#b0e0e6', '#e0f0ff'],
          ground: '#696969',
          groundPattern: '#808080',
          groundDark: '#505050',
          grass: '#228b22',
          hills: '#556b2f',
          clouds: '#ffffff',
          pipe: ['#2f4f4f', '#3f5f5f'],
          brick: ['#808080', '#a0a0a0', '#606060'],
        };
      case 'space':
        return {
          sky: ['#0a0a2e', '#1a1a4e', '#0a0a2e'],
          ground: '#2a2a4a',
          groundPattern: '#3a3a5a',
          groundDark: '#1a1a3a',
          grass: '#4a0080',
          hills: '#1a0040',
          clouds: '#4a4a8a',
          pipe: ['#4a0080', '#6a00a0'],
          brick: ['#3a3a6a', '#4a4a8a', '#2a2a5a'],
        };
      case 'hell':
        return {
          sky: ['#1a0000', '#4a0000', '#8b0000'],
          ground: '#2a0a0a',
          groundPattern: '#3a1a1a',
          groundDark: '#1a0505',
          grass: '#ff4500',
          hills: '#8b0000',
          clouds: '#4a2020',
          pipe: ['#4a0000', '#6a0000'],
          brick: ['#8b0000', '#a01010', '#600000'],
        };
      case 'heaven':
        return {
          sky: ['#e6f3ff', '#ffffff', '#fffacd'],
          ground: '#f0e68c',
          groundPattern: '#fffacd',
          groundDark: '#daa520',
          grass: '#ffd700',
          hills: '#fffacd',
          clouds: '#ffffff',
          pipe: ['#ffd700', '#ffec8b'],
          brick: ['#ffd700', '#ffec8b', '#daa520'],
        };
      case 'hemet':
        return {
          sky: ['#c9a86c', '#d4b896', '#e8d4b8'],
          ground: '#8b7355',
          groundPattern: '#9b8365',
          groundDark: '#6b5345',
          grass: '#a89070',
          hills: '#c9a86c',
          clouds: '#d4c4a8',
          pipe: ['#4a3c2a', '#5a4c3a'],
          brick: ['#8b7355', '#9b8365', '#6b5345'],
        };
    }
  };

  // Draw brick platform (Mario style)
  const drawBrickPlatform = (ctx: CanvasRenderingContext2D, platform: Platform, colors: ReturnType<typeof getLevelColors>) => {
    const brickWidth = 20;
    const brickHeight = 12;
    const rows = Math.floor(platform.height / brickHeight);
    const cols = Math.ceil(platform.width / brickWidth);
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const offsetX = row % 2 === 0 ? 0 : brickWidth / 2;
        const brickX = platform.x + col * brickWidth - offsetX;
        const brickY = platform.y + row * brickHeight;
        
        // Brick face
        ctx.fillStyle = colors.brick[0];
        ctx.fillRect(brickX, brickY, brickWidth - 1, brickHeight - 1);
        
        // Highlights
        ctx.fillStyle = colors.brick[1];
        ctx.fillRect(brickX, brickY, brickWidth - 2, 2);
        ctx.fillRect(brickX, brickY, 2, brickHeight - 2);
        
        // Shadows
        ctx.fillStyle = colors.brick[2];
        ctx.fillRect(brickX + brickWidth - 2, brickY, 1, brickHeight - 1);
        ctx.fillRect(brickX, brickY + brickHeight - 2, brickWidth - 1, 1);
      }
    }
  };

  // Draw PVC pipe
  const drawPipe = (ctx: CanvasRenderingContext2D, platform: Platform, groundY: number, colors: ReturnType<typeof getLevelColors>) => {
    const pipeHeight = groundY - platform.y;
    
    // Main pipe body
    const gradient = ctx.createLinearGradient(platform.x, 0, platform.x + platform.width, 0);
    gradient.addColorStop(0, colors.pipe[0]);
    gradient.addColorStop(0.2, colors.pipe[1]);
    gradient.addColorStop(0.5, colors.pipe[0]);
    gradient.addColorStop(0.8, colors.pipe[0]);
    gradient.addColorStop(1, colors.pipe[0]);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(platform.x + 5, platform.y + 20, platform.width - 10, pipeHeight - 20);
    
    // Pipe top rim (wider)
    const topGradient = ctx.createLinearGradient(platform.x, 0, platform.x + platform.width, 0);
    topGradient.addColorStop(0, colors.pipe[0]);
    topGradient.addColorStop(0.2, colors.pipe[1]);
    topGradient.addColorStop(0.5, colors.pipe[0]);
    topGradient.addColorStop(0.8, colors.pipe[0]);
    topGradient.addColorStop(1, colors.pipe[0]);
    
    ctx.fillStyle = topGradient;
    ctx.fillRect(platform.x, platform.y, platform.width, 22);
    
    // Shine effect
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(platform.x + 8, platform.y + 22, 4, pipeHeight - 25);
    
    // Pipe rim highlight
    ctx.strokeStyle = colors.pipe[1];
    ctx.lineWidth = 2;
    ctx.strokeRect(platform.x + 1, platform.y + 1, platform.width - 2, 20);
  };

  // Draw chat bubble with Karen phrase
  const drawChatBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, phrase: string, isBoss: boolean) => {
    ctx.save();
    
    // Measure text for bubble size
    const fontSize = isBoss ? 11 : 9;
    ctx.font = `bold ${fontSize}px Arial`;
    
    // Word wrap the phrase
    const maxWidth = isBoss ? 140 : 110;
    const words = phrase.split(' ');
    let lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine + word + ' ';
      if (ctx.measureText(testLine).width > maxWidth) {
        if (currentLine) lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    
    // Calculate bubble dimensions
    const lineHeight = fontSize + 4;
    const padding = 8;
    const bubbleHeight = lines.length * lineHeight + padding * 2;
    const maxLineWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bubbleWidth = maxLineWidth + padding * 2;
    
    const bubbleX = x - bubbleWidth / 2;
    const bubbleY = y - bubbleHeight - 15;
    
    // Draw bubble shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.roundRect(bubbleX + 3, bubbleY + 3, bubbleWidth, bubbleHeight, 8);
    ctx.fill();
    
    // Draw bubble background
    ctx.fillStyle = isBoss ? '#ff2222' : '#ffffff';
    ctx.strokeStyle = isBoss ? '#aa0000' : '#333333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 8);
    ctx.fill();
    ctx.stroke();
    
    // Draw bubble pointer (triangle pointing down)
    ctx.fillStyle = isBoss ? '#ff2222' : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x - 8, bubbleY + bubbleHeight);
    ctx.lineTo(x, bubbleY + bubbleHeight + 10);
    ctx.lineTo(x + 8, bubbleY + bubbleHeight);
    ctx.closePath();
    ctx.fill();
    
    // Draw pointer border
    ctx.strokeStyle = isBoss ? '#aa0000' : '#333333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, bubbleY + bubbleHeight);
    ctx.lineTo(x, bubbleY + bubbleHeight + 10);
    ctx.lineTo(x + 8, bubbleY + bubbleHeight);
    ctx.stroke();
    
    // Draw text
    ctx.fillStyle = isBoss ? '#ffffff' : '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    lines.forEach((line, i) => {
      const textY = bubbleY + padding + lineHeight / 2 + i * lineHeight;
      ctx.fillText(line, x, textY);
    });
    
    ctx.restore();
  };

  // Draw Karen - either photo or cartoon style
  const drawKaren = (ctx: CanvasRenderingContext2D, karen: Karen, frame: number) => {
    const { x, y, type, isBoss, headImage, usePhoto } = karen;
    const scale = isBoss ? 1.6 : 1.2;
    const headSize = isBoss ? 55 : 40; // MUCH BIGGER HEADS
    const bobOffset = Math.sin(frame * 0.1 + x) * 3;
    const config = KAREN_CONFIG[type];

    ctx.save();
    
    // Draw chat bubble with phrase
    const bubbleX = x + 22 * scale;
    const bubbleY = y - 20 * scale;
    drawChatBubble(ctx, bubbleX, bubbleY, karen.phrase, isBoss);

    // Body (smaller relative to head for comedic effect)
    ctx.fillStyle = isBoss ? '#2c0000' : '#e91e63';
    ctx.beginPath();
    ctx.ellipse(x + 22 * scale, y + 40 * scale + bobOffset, 10 * scale, 14 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms crossed
    ctx.strokeStyle = '#fdbba4';
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    ctx.moveTo(x + 10 * scale, y + 36 * scale + bobOffset);
    ctx.lineTo(x + 34 * scale, y + 40 * scale + bobOffset);
    ctx.stroke();

    if (usePhoto) {
      // Real Karen head image (meme photo) - MUCH BIGGER with proper face cropping
      const img = karenImagesRef.current[headImage];
      if (img && img.complete) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + 22 * scale, y + 5 * scale + bobOffset, headSize, 0, Math.PI * 2);
        ctx.clip();
        
        // Draw image larger and centered - crop to show face better
        const imgSize = headSize * 2.8;
        // Offset to center on face (assuming faces are in upper portion of photo)
        const yOffset = headSize * 0.3; // Move up slightly to focus on face
        ctx.drawImage(
          img,
          x + 22 * scale - imgSize / 2,
          y + 5 * scale + bobOffset - imgSize / 2 - yOffset,
          imgSize,
          imgSize
        );
        ctx.restore();
        
        // Border around head
        ctx.strokeStyle = isBoss ? '#ff0000' : '#e91e63';
        ctx.lineWidth = isBoss ? 4 : 3;
        ctx.beginPath();
        ctx.arc(x + 22 * scale, y + 5 * scale + bobOffset, headSize, 0, Math.PI * 2);
        ctx.stroke();
        
        // Glowing effect for boss
        if (isBoss) {
          ctx.shadowColor = '#ff0000';
          ctx.shadowBlur = 20;
          ctx.strokeStyle = '#ff000088';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(x + 22 * scale, y + 5 * scale + bobOffset, headSize + 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
    } else {
      // Cartoon Karen head - BIGGER to match photo heads
      const headX = x + 22 * scale;
      const headY = y + 5 * scale + bobOffset;
      
      // Head shape (oval) - bigger
      ctx.fillStyle = '#fdbba4';
      ctx.beginPath();
      ctx.ellipse(headX, headY, headSize * 0.85, headSize, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Karen hairdo - the signature "speak to manager" style
      ctx.fillStyle = config.hairColor;
      ctx.beginPath();
      // Main hair volume on top
      ctx.ellipse(headX, headY - headSize * 0.7, headSize * 0.9, headSize * 0.6, 0, Math.PI, 0);
      ctx.fill();
      // Side swoops
      ctx.beginPath();
      ctx.ellipse(headX - headSize * 0.6, headY - headSize * 0.3, headSize * 0.4, headSize * 0.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(headX + headSize * 0.6, headY - headSize * 0.3, headSize * 0.4, headSize * 0.5, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // Spiky back
      for (let i = 0; i < 5; i++) {
        const spikeAngle = -Math.PI * 0.8 + (i * 0.4);
        ctx.beginPath();
        ctx.moveTo(headX, headY - headSize * 0.5);
        ctx.lineTo(
          headX + Math.cos(spikeAngle) * headSize * 1.1,
          headY - headSize * 0.5 + Math.sin(spikeAngle) * headSize * 0.8
        );
        ctx.lineTo(headX, headY - headSize * 0.2);
        ctx.fill();
      }
      
      // Angry eyebrows
      ctx.strokeStyle = config.hairColor;
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(headX - headSize * 0.5, headY - headSize * 0.2);
      ctx.lineTo(headX - headSize * 0.15, headY);
      ctx.moveTo(headX + headSize * 0.5, headY - headSize * 0.2);
      ctx.lineTo(headX + headSize * 0.15, headY);
      ctx.stroke();
      
      // Eyes (angry) - bigger
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(headX - headSize * 0.3, headY + headSize * 0.05, headSize * 0.22, headSize * 0.18, 0, 0, Math.PI * 2);
      ctx.ellipse(headX + headSize * 0.3, headY + headSize * 0.05, headSize * 0.22, headSize * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(headX - headSize * 0.3, headY + headSize * 0.08, headSize * 0.1, 0, Math.PI * 2);
      ctx.arc(headX + headSize * 0.3, headY + headSize * 0.08, headSize * 0.1, 0, Math.PI * 2);
      ctx.fill();
      
      // Angry frowning mouth
      ctx.strokeStyle = '#8b0000';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.arc(headX, headY + headSize * 0.55, headSize * 0.3, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      
      // Earrings (gaudy)
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(headX - headSize * 0.85, headY + headSize * 0.2, 4 * scale, 0, Math.PI * 2);
      ctx.arc(headX + headSize * 0.85, headY + headSize * 0.2, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
      
      // Outline
      ctx.strokeStyle = isBoss ? '#ff0000' : '#cc1466';
      ctx.lineWidth = isBoss ? 4 : 3;
      ctx.beginPath();
      ctx.ellipse(headX, headY, headSize * 0.85, headSize, 0, 0, Math.PI * 2);
      ctx.stroke();
      
      // Glowing effect for cartoon boss
      if (isBoss) {
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 20;
        ctx.strokeStyle = '#ff000088';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(headX, headY, headSize * 0.85 + 3, headSize + 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    ctx.restore();
  };

  // Draw Mario-style Pizza Chef (side view) with paddle held DOWN by default
  const drawPlayer = (ctx: CanvasRenderingContext2D, player: Player, frame: number) => {
    ctx.save();
    
    const bobOffset = Math.sin(frame * 0.2) * (player.isJumping ? 0 : 1.5);
    const runCycle = player.isJumping ? 0 : Math.sin(frame * 0.35) * 8;
    
    // Update paddle swing
    if (player.isSwinging) {
      player.paddleSwing += 0.35;
      if (player.paddleSwing >= Math.PI) {
        player.isSwinging = false;
        player.paddleSwing = 0;
      }
    }
    
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(player.x + 20, groundYRef.current, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    const yOffset = player.y + bobOffset;
    const dir = player.facingRight ? 1 : -1;
    
    if (player.isHurt) {
      ctx.globalAlpha = 0.6 + Math.sin(frame * 0.6) * 0.4;
    }

    ctx.save();
    if (!player.facingRight) {
      ctx.translate(player.x + player.width, 0);
      ctx.scale(-1, 1);
      ctx.translate(-player.x, 0);
    }

    // === MARIO-STYLE PIZZA GUY (SIDE VIEW) - NO HAT, WITH BEARD ===
    
    // Back leg
    ctx.fillStyle = '#1e3a5f';
    ctx.save();
    ctx.translate(player.x + 12, yOffset + 35);
    ctx.rotate((player.isJumping ? 0.3 : runCycle * 0.03));
    ctx.fillRect(-4, 0, 9, 16);
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.ellipse(2, 16, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Back arm (behind body)
    ctx.fillStyle = '#e74c3c';
    ctx.save();
    ctx.translate(player.x + 16, yOffset + 18);
    ctx.rotate(-0.2 + Math.sin(frame * 0.2) * 0.1);
    ctx.fillRect(-3, 0, 7, 14);
    ctx.fillStyle = '#f4d0a8';
    ctx.beginPath();
    ctx.arc(0, 15, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Body (torso) - Red shirt
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.ellipse(player.x + 20, yOffset + 22, 11, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Blue overalls bib
    ctx.fillStyle = '#1e3a5f';
    ctx.beginPath();
    ctx.moveTo(player.x + 12, yOffset + 18);
    ctx.lineTo(player.x + 28, yOffset + 18);
    ctx.lineTo(player.x + 26, yOffset + 32);
    ctx.lineTo(player.x + 14, yOffset + 32);
    ctx.closePath();
    ctx.fill();
    
    // Overall straps
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x + 15, yOffset + 18);
    ctx.lineTo(player.x + 17, yOffset + 12);
    ctx.moveTo(player.x + 25, yOffset + 18);
    ctx.lineTo(player.x + 23, yOffset + 12);
    ctx.stroke();
    
    // Yellow buttons on overalls
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(player.x + 17, yOffset + 18, 2, 0, Math.PI * 2);
    ctx.arc(player.x + 23, yOffset + 18, 2, 0, Math.PI * 2);
    ctx.fill();

    // Front leg
    ctx.fillStyle = '#1e3a5f';
    ctx.save();
    ctx.translate(player.x + 22, yOffset + 35);
    ctx.rotate((player.isJumping ? -0.3 : -runCycle * 0.03));
    ctx.fillRect(-4, 0, 9, 16);
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.ellipse(4, 16, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Neck
    ctx.fillStyle = '#f4d0a8';
    ctx.fillRect(player.x + 17, yOffset + 6, 8, 6);

    // Head (side profile - rounder like Mario)
    ctx.fillStyle = '#f4d0a8';
    ctx.beginPath();
    ctx.ellipse(player.x + 24, yOffset - 2, 12, 14, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Big Mario nose (bigger and rounder)
    ctx.fillStyle = '#e8c090';
    ctx.beginPath();
    ctx.ellipse(player.x + 36, yOffset + 1, 7, 5, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Hair on top (brown like Mario) - no hat, just hair
    ctx.fillStyle = '#4a2c0a';
    // Main hair on top
    ctx.beginPath();
    ctx.ellipse(player.x + 23, yOffset - 14, 12, 6, 0.1, 0, Math.PI * 2);
    ctx.fill();
    // Hair swoop on front
    ctx.beginPath();
    ctx.arc(player.x + 30, yOffset - 12, 5, 0, Math.PI * 2);
    ctx.fill();
    // More volume
    ctx.beginPath();
    ctx.arc(player.x + 18, yOffset - 12, 6, 0, Math.PI * 2);
    ctx.fill();
    
    // Sideburn
    ctx.fillRect(player.x + 12, yOffset - 2, 5, 12);

    // Ear
    ctx.fillStyle = '#f4d0a8';
    ctx.beginPath();
    ctx.ellipse(player.x + 12, yOffset, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye (bigger, more expressive)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(player.x + 29, yOffset - 4, 5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.arc(player.x + 30, yOffset - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(player.x + 31, yOffset - 4, 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyebrow
    ctx.strokeStyle = '#4a2c0a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x + 24, yOffset - 9);
    ctx.quadraticCurveTo(player.x + 29, yOffset - 12, player.x + 34, yOffset - 9);
    ctx.stroke();

    // Big Mario mustache
    ctx.fillStyle = '#4a2c0a';
    ctx.beginPath();
    ctx.moveTo(player.x + 26, yOffset + 4);
    ctx.quadraticCurveTo(player.x + 36, yOffset + 10, player.x + 44, yOffset + 3);
    ctx.quadraticCurveTo(player.x + 42, yOffset + 0, player.x + 35, yOffset + 3);
    ctx.quadraticCurveTo(player.x + 30, yOffset + 2, player.x + 26, yOffset + 4);
    ctx.fill();
    
    // BEARD - full beard below mustache for copyright safety
    ctx.fillStyle = '#3a1c00';
    // Main beard mass
    ctx.beginPath();
    ctx.moveTo(player.x + 14, yOffset + 6);
    ctx.quadraticCurveTo(player.x + 10, yOffset + 12, player.x + 14, yOffset + 18);
    ctx.quadraticCurveTo(player.x + 22, yOffset + 22, player.x + 32, yOffset + 16);
    ctx.quadraticCurveTo(player.x + 36, yOffset + 12, player.x + 34, yOffset + 8);
    ctx.quadraticCurveTo(player.x + 28, yOffset + 8, player.x + 22, yOffset + 8);
    ctx.quadraticCurveTo(player.x + 16, yOffset + 8, player.x + 14, yOffset + 6);
    ctx.fill();
    // Beard detail/texture
    ctx.strokeStyle = '#2a0c00';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(player.x + 16 + i * 3, yOffset + 10);
      ctx.lineTo(player.x + 14 + i * 4, yOffset + 18);
      ctx.stroke();
    }

    ctx.restore();

    // FRONT ARM WITH PIZZA PADDLE - Held DOWN by default (pointing down), swings UP when attacking
    // Base angle is pointing down (PI/2 = 90 degrees downward)
    const baseSwing = player.facingRight ? Math.PI * 0.4 : -Math.PI * 0.4; // Pointing downward
    const swingAngle = player.isSwinging 
      ? baseSwing - Math.sin(player.paddleSwing) * 1.5 * (player.facingRight ? 1 : -1) // Swing up and forward
      : baseSwing + Math.sin(frame * 0.1) * 0.05 * (player.facingRight ? 1 : -1); // Slight idle bob
    
    const armX = player.facingRight ? player.x + 30 : player.x + 10;
    
    ctx.save();
    ctx.translate(armX, yOffset + 20);
    ctx.rotate(swingAngle);
    
    // Motion blur when swinging
    if (player.isSwinging && player.paddleSwing > 0.4 && player.paddleSwing < 2.2) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#d4a373';
      for (let i = 1; i <= 3; i++) {
        ctx.save();
        ctx.rotate(-i * 0.12 * (player.facingRight ? 1 : -1));
        ctx.beginPath();
        ctx.arc(40, 0, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    
    // Arm (red sleeve)
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(0, -4, 14, 9);
    
    // Hand
    ctx.fillStyle = '#f4d0a8';
    ctx.beginPath();
    ctx.arc(14, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    
    // Paddle handle
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(18, -2.5, 12, 5);
    
    // Pizza peel (paddle head)
    ctx.fillStyle = '#d4a373';
    ctx.beginPath();
    ctx.arc(40, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a0522d';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    
    // Pepperoni pattern
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(36, -3, 2.5, 0, Math.PI * 2);
    ctx.arc(43, 3, 2.5, 0, Math.PI * 2);
    ctx.arc(46, -2, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // POW effect when swinging
    if (player.isSwinging && player.paddleSwing > 0.8 && player.paddleSwing < 2) {
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#ff6b35';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeText('POW!', 50, -6);
      ctx.fillText('POW!', 50, -6);
    }
    
    ctx.restore();
    ctx.restore();
  };

  useEffect(() => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { width, height } = getCanvasDimensions();
    canvas.width = width;
    canvas.height = height;
    
    // Performance optimization: use delta time for smooth animation
    let lastTime = performance.now();
    const targetFPS = 60;
    const frameTime = 1000 / targetFPS;

    const gameLoop = (currentTimestamp: number) => {
      const deltaTime = currentTimestamp - lastTime;
      
      // Skip frames if we're running too fast (reduces CPU usage)
      if (deltaTime < frameTime * 0.8) {
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return;
      }
      
      lastTime = currentTimestamp;
      const timeScale = Math.min(deltaTime / frameTime, 2); // Cap at 2x to prevent huge jumps
      
      const player = playerRef.current;
      const karens = karensRef.current;
      const toppings = toppingsRef.current;
      const particles = particlesRef.current;
      const platforms = platformsRef.current;
      const groundY = groundYRef.current;
      const currentTime = Date.now();

      // Check for level changes
      const newLevel = [...LEVELS].reverse().find(l => scoreRef.current >= l.scoreThreshold) || LEVELS[0];
      if (newLevel.theme !== currentLevelRef.current.theme) {
        currentLevelRef.current = newLevel;
        setCurrentLevel(newLevel);
        playSound('levelUp');
        spawnParticles(width / 2, height / 2, '#ffd700', 20, `🌟 ${newLevel.name}!`);
        // Increase Karen spawn rate as levels progress
        karenSpawnRateRef.current = Math.max(60, KAREN_SPAWN_RATE_START - (LEVELS.indexOf(newLevel) * 15));
      }

      const colors = getLevelColors(currentLevelRef.current.theme);

      // Apply screen shake
      if (screenShakeRef.current > 0) {
        const shakeX = (Math.random() - 0.5) * screenShakeRef.current * 2;
        const shakeY = (Math.random() - 0.5) * screenShakeRef.current * 2;
        ctx.save();
        ctx.translate(shakeX, shakeY);
        screenShakeRef.current *= 0.9;
        if (screenShakeRef.current < 0.5) screenShakeRef.current = 0;
      }

      // Sky gradient with enhanced colors
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, colors.sky[0]);
      gradient.addColorStop(0.5, colors.sky[1]);
      gradient.addColorStop(1, colors.sky[2]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Add atmospheric glow at horizon
      const horizonGlow = ctx.createLinearGradient(0, height - 100, 0, height - 50);
      horizonGlow.addColorStop(0, 'rgba(255, 200, 150, 0)');
      horizonGlow.addColorStop(1, 'rgba(255, 200, 150, 0.15)');
      ctx.fillStyle = horizonGlow;
      ctx.fillRect(0, height - 100, width, 50);

      // Stars for space theme
      if (currentLevelRef.current.theme === 'space') {
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 50; i++) {
          const starX = (i * 47 + frameCountRef.current * 0.2) % width;
          const starY = (i * 31) % (height - 80);
          const size = (i % 3) + 1;
          ctx.beginPath();
          ctx.arc(starX, starY, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Fire effects for hell theme
      if (currentLevelRef.current.theme === 'hell') {
        for (let i = 0; i < 8; i++) {
          const fireX = (i * 70 + frameCountRef.current * 0.5) % (width + 50) - 25;
          const fireY = height - 60 + Math.sin(frameCountRef.current * 0.1 + i) * 10;
          ctx.fillStyle = `rgba(255, ${100 + Math.random() * 100}, 0, 0.6)`;
          ctx.beginPath();
          ctx.moveTo(fireX, fireY);
          ctx.lineTo(fireX + 15, fireY - 30 - Math.random() * 20);
          ctx.lineTo(fireX + 30, fireY);
          ctx.fill();
        }
      }

      // Clouds or halos for heaven theme
      if (currentLevelRef.current.theme === 'heaven') {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
        for (let i = 0; i < 5; i++) {
          const haloX = (i * 120 + frameCountRef.current * 0.3) % (width + 100) - 50;
          ctx.beginPath();
          ctx.arc(haloX, 60 + (i % 3) * 30, 25, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // HEMET theme - mummies, crackheads, flying needles, dumpster fires, buildings
      if (currentLevelRef.current.theme === 'hemet') {
        // Background buildings (far back)
        ctx.fillStyle = '#3a3a3a';
        for (let i = 0; i < 8; i++) {
          const buildingX = (i * 80 - (frameCountRef.current * 0.15) % 80) - 20;
          const buildingHeight = 80 + (i % 4) * 40;
          const buildingWidth = 50 + (i % 3) * 15;
          ctx.fillRect(buildingX, height - 50 - buildingHeight, buildingWidth, buildingHeight);
          // Windows
          ctx.fillStyle = '#1a1a1a';
          for (let wy = 0; wy < Math.floor(buildingHeight / 20); wy++) {
            for (let wx = 0; wx < 3; wx++) {
              const windowLit = (i + wy + wx + Math.floor(frameCountRef.current * 0.02)) % 5 < 2;
              ctx.fillStyle = windowLit ? '#ffcc44' : '#1a1a1a';
              ctx.fillRect(buildingX + 8 + wx * 14, height - 45 - buildingHeight + 10 + wy * 20, 8, 12);
            }
          }
          ctx.fillStyle = '#3a3a3a';
        }

        // Mid-ground buildings (closer)
        ctx.fillStyle = '#2a2a2a';
        for (let i = 0; i < 5; i++) {
          const buildingX = (i * 120 + 40 - (frameCountRef.current * 0.25) % 120) - 30;
          const buildingHeight = 60 + (i % 3) * 30;
          ctx.fillRect(buildingX, height - 50 - buildingHeight, 40, buildingHeight);
          // Broken windows
          ctx.fillStyle = '#1a1a1a';
          for (let w = 0; w < 2; w++) {
            ctx.fillRect(buildingX + 8 + w * 18, height - 40 - buildingHeight + 15, 10, 15);
          }
          ctx.fillStyle = '#2a2a2a';
        }

        // Dumpster fires
        for (let i = 0; i < 4; i++) {
          const dumpsterX = (i * 140 + 60 + frameCountRef.current * 0.3) % (width + 100) - 50;
          const dumpsterY = height - 75;
          
          ctx.save();
          ctx.globalAlpha = 0.85;
          // Dumpster body
          ctx.fillStyle = '#2d5a2d';
          ctx.fillRect(dumpsterX, dumpsterY, 45, 28);
          ctx.fillStyle = '#1d4a1d';
          ctx.fillRect(dumpsterX + 2, dumpsterY + 2, 41, 3);
          // Dumpster lid (open)
          ctx.fillStyle = '#2d5a2d';
          ctx.save();
          ctx.translate(dumpsterX + 45, dumpsterY);
          ctx.rotate(-0.5);
          ctx.fillRect(-42, -5, 42, 5);
          ctx.restore();
          // Fire coming out
          for (let f = 0; f < 5; f++) {
            const flameHeight = 15 + Math.sin(frameCountRef.current * 0.2 + f) * 10 + Math.random() * 8;
            const flameX = dumpsterX + 8 + f * 8;
            ctx.fillStyle = f % 2 === 0 ? '#ff4400' : '#ffaa00';
            ctx.beginPath();
            ctx.moveTo(flameX, dumpsterY);
            ctx.lineTo(flameX + 4, dumpsterY - flameHeight);
            ctx.lineTo(flameX + 8, dumpsterY);
            ctx.fill();
          }
          // Smoke
          ctx.fillStyle = 'rgba(60, 60, 60, 0.5)';
          for (let s = 0; s < 3; s++) {
            const smokeY = dumpsterY - 30 - s * 15 - (frameCountRef.current * 0.5 % 30);
            const smokeSize = 8 + s * 4;
            ctx.beginPath();
            ctx.arc(dumpsterX + 22 + Math.sin(frameCountRef.current * 0.1 + s) * 5, smokeY, smokeSize, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // Draw wandering mummies in background (more of them)
        for (let i = 0; i < 6; i++) {
          const mummyX = (i * 100 + frameCountRef.current * 0.4) % (width + 100) - 50;
          const mummyY = height - 95 + Math.sin(frameCountRef.current * 0.05 + i) * 5;
          const bobble = Math.sin(frameCountRef.current * 0.1 + i * 2) * 2;
          
          ctx.save();
          ctx.globalAlpha = 0.75;
          // Mummy body (wrapped in bandages)
          ctx.fillStyle = '#d4c4a8';
          ctx.fillRect(mummyX + 8, mummyY + 15 + bobble, 14, 30);
          // Bandage strips
          ctx.strokeStyle = '#c9b898';
          ctx.lineWidth = 2;
          for (let j = 0; j < 6; j++) {
            ctx.beginPath();
            ctx.moveTo(mummyX + 6, mummyY + 18 + j * 5 + bobble);
            ctx.lineTo(mummyX + 24, mummyY + 20 + j * 5 + bobble);
            ctx.stroke();
          }
          // Mummy head
          ctx.fillStyle = '#d4c4a8';
          ctx.beginPath();
          ctx.arc(mummyX + 15, mummyY + 10 + bobble, 10, 0, Math.PI * 2);
          ctx.fill();
          // Head bandages
          ctx.strokeStyle = '#b9a888';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(mummyX + 5, mummyY + 8 + bobble);
          ctx.lineTo(mummyX + 25, mummyY + 12 + bobble);
          ctx.stroke();
          // Glowing eyes
          ctx.fillStyle = '#ff6600';
          ctx.shadowColor = '#ff6600';
          ctx.shadowBlur = 5;
          ctx.beginPath();
          ctx.arc(mummyX + 12, mummyY + 8 + bobble, 2, 0, Math.PI * 2);
          ctx.arc(mummyX + 18, mummyY + 8 + bobble, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // Arms reaching out
          ctx.fillStyle = '#d4c4a8';
          ctx.fillRect(mummyX - 5, mummyY + 18 + bobble, 15, 5);
          ctx.fillRect(mummyX + 20, mummyY + 18 + bobble, 15, 5);
          ctx.restore();
        }

        // Draw crackhead/druggie characters wandering (more of them)
        for (let i = 0; i < 5; i++) {
          const crackX = (i * 110 + 50 + frameCountRef.current * 0.7) % (width + 120) - 60;
          const crackY = height - 90;
          const twitch = Math.sin(frameCountRef.current * 0.4 + i * 3) * 4;
          const jitter = Math.sin(frameCountRef.current * 0.3 + i * 5) * 3;
          
          ctx.save();
          ctx.globalAlpha = 0.7;
          // Skinny legs
          ctx.fillStyle = '#3a3a5a';
          ctx.fillRect(crackX + 10 + twitch, crackY + 35 + jitter, 4, 15);
          ctx.fillRect(crackX + 16 + twitch, crackY + 35 + jitter, 4, 15);
          // Skinny body
          ctx.fillStyle = i % 2 === 0 ? '#4a4a4a' : '#5a4a3a';
          ctx.fillRect(crackX + 8 + twitch, crackY + 15 + jitter, 14, 22);
          // Head
          ctx.fillStyle = '#8b7355';
          ctx.beginPath();
          ctx.arc(crackX + 15 + twitch, crackY + 8 + jitter, 9, 0, Math.PI * 2);
          ctx.fill();
          // Sunken cheeks
          ctx.fillStyle = '#7a6345';
          ctx.beginPath();
          ctx.arc(crackX + 10 + twitch, crackY + 10 + jitter, 3, 0, Math.PI * 2);
          ctx.arc(crackX + 20 + twitch, crackY + 10 + jitter, 3, 0, Math.PI * 2);
          ctx.fill();
          // Messy/patchy hair
          ctx.strokeStyle = '#2a2a2a';
          ctx.lineWidth = 2;
          for (let h = 0; h < 6; h++) {
            ctx.beginPath();
            ctx.moveTo(crackX + 8 + h * 2.5 + twitch, crackY - 1 + jitter);
            ctx.lineTo(crackX + 6 + h * 3 + twitch, crackY - 10 - Math.random() * 6 + jitter);
            ctx.stroke();
          }
          // Crazy wide eyes
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(crackX + 11 + twitch, crackY + 5 + jitter, 4, 0, Math.PI * 2);
          ctx.arc(crackX + 19 + twitch, crackY + 5 + jitter, 4, 0, Math.PI * 2);
          ctx.fill();
          // Dilated pupils (darting around)
          ctx.fillStyle = '#000000';
          const pupilOffset = Math.sin(frameCountRef.current * 0.2 + i) * 2;
          ctx.beginPath();
          ctx.arc(crackX + 11 + pupilOffset + twitch, crackY + 5 + jitter, 2, 0, Math.PI * 2);
          ctx.arc(crackX + 19 - pupilOffset + twitch, crackY + 5 + jitter, 2, 0, Math.PI * 2);
          ctx.fill();
          // Open mouth (yelling/mumbling)
          ctx.fillStyle = '#2a1a1a';
          ctx.beginPath();
          ctx.arc(crackX + 15 + twitch, crackY + 13 + jitter, 3, 0, Math.PI);
          ctx.fill();
          // Twitchy arms
          ctx.strokeStyle = '#8b7355';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(crackX + 8 + twitch, crackY + 18 + jitter);
          ctx.lineTo(crackX - 2 + Math.sin(frameCountRef.current * 0.6 + i) * 8, crackY + 30 + jitter);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(crackX + 22 + twitch, crackY + 18 + jitter);
          ctx.lineTo(crackX + 32 + Math.cos(frameCountRef.current * 0.6 + i) * 8, crackY + 28 + jitter);
          ctx.stroke();
          ctx.restore();
        }

        // Flying needles (bigger)
        for (let i = 0; i < 10; i++) {
          const needleX = (i * 70 + frameCountRef.current * 2) % (width + 80) - 40;
          const needleY = 60 + (i * 35) % 180 + Math.sin(frameCountRef.current * 0.08 + i * 2) * 25;
          const rotation = frameCountRef.current * 0.12 + i;
          const scale = 1.5 + (i % 3) * 0.3;
          
          ctx.save();
          ctx.globalAlpha = 0.85;
          ctx.translate(needleX, needleY);
          ctx.rotate(rotation);
          ctx.scale(scale, scale);
          // Syringe body (bigger)
          ctx.fillStyle = '#d0d0d0';
          ctx.fillRect(-20, -4, 35, 8);
          // Measurement lines
          ctx.strokeStyle = '#888888';
          ctx.lineWidth = 0.5;
          for (let m = 0; m < 5; m++) {
            ctx.beginPath();
            ctx.moveTo(-15 + m * 6, -3);
            ctx.lineTo(-15 + m * 6, 3);
            ctx.stroke();
          }
          // Needle tip (sharp)
          ctx.fillStyle = '#707070';
          ctx.beginPath();
          ctx.moveTo(15, 0);
          ctx.lineTo(28, 0);
          ctx.lineTo(15, -2);
          ctx.lineTo(15, 2);
          ctx.fill();
          // Plunger
          ctx.fillStyle = '#ee3333';
          ctx.fillRect(-25, -5, 7, 10);
          // Liquid inside (brownish)
          ctx.fillStyle = 'rgba(100, 60, 30, 0.7)';
          ctx.fillRect(-16, -2, 24, 4);
          // Bubbles in liquid
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.beginPath();
          ctx.arc(-8, 0, 1.5, 0, Math.PI * 2);
          ctx.arc(2, -1, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Background hills
      ctx.fillStyle = colors.hills;
      for (let i = -1; i < 3; i++) {
        const hillX = (i * 200 - (frameCountRef.current * 0.3) % 200);
        ctx.beginPath();
        ctx.arc(hillX + 80, height - 45, 70, Math.PI, 0);
        ctx.fill();
      }

      // Clouds
      ctx.fillStyle = colors.clouds;
      const cloudPositions = [100, 280, 450];
      cloudPositions.forEach((baseX, i) => {
        const cloudX = (baseX - (frameCountRef.current * 0.4) % (width + 100));
        const cloudY = 50 + (i % 2) * 30;
        ctx.beginPath();
        ctx.arc(cloudX, cloudY, 18, 0, Math.PI * 2);
        ctx.arc(cloudX + 22, cloudY - 5, 22, 0, Math.PI * 2);
        ctx.arc(cloudX + 44, cloudY, 18, 0, Math.PI * 2);
        ctx.fill();
      });

      // Ground
      ctx.fillStyle = colors.ground;
      ctx.fillRect(0, height - 50, width, 50);
      
      // Ground pattern
      for (let i = 0; i < width; i += 24) {
        const offsetX = (frameCountRef.current * gameSpeedRef.current) % 24;
        ctx.fillStyle = colors.groundPattern;
        ctx.fillRect(i - offsetX, height - 50, 22, 2);
        ctx.fillRect(i - offsetX, height - 50, 2, 50);
        ctx.fillStyle = colors.groundDark;
        ctx.fillRect(i - offsetX + 21, height - 50, 2, 50);
      }
      
      // Ground top
      ctx.fillStyle = colors.grass;
      ctx.fillRect(0, height - 52, width, 4);

      // Handle player horizontal movement
      if (movingLeftRef.current) {
        player.x -= PLAYER_SPEED;
        player.facingRight = false;
      }
      if (movingRightRef.current) {
        player.x += PLAYER_SPEED;
        player.facingRight = true;
      }
      
      // Keep player in bounds
      player.x = Math.max(10, Math.min(width - player.width - 10, player.x));

      // Update platforms
      for (let i = platforms.length - 1; i >= 0; i--) {
        const platform = platforms[i];
        platform.x -= gameSpeedRef.current;
        
        if (platform.type === 'brick') {
          drawBrickPlatform(ctx, platform, colors);
        } else if (platform.type === 'pipe') {
          drawPipe(ctx, platform, groundY, colors);
        }
        
        if (platform.x + platform.width < -50) {
          platforms.splice(i, 1);
        }
      }

      // Spawn new platforms
      if (frameCountRef.current % PLATFORM_SPAWN_RATE === 0 && Math.random() > 0.3) {
        const platformY = height - 100 - Math.random() * 120;
        platforms.push({
          x: width + 20,
          y: platformY,
          width: 60 + Math.random() * 60,
          height: 24,
          type: 'brick',
        });
      }
      
      // Spawn pipes
      if (frameCountRef.current % PIPE_SPAWN_RATE === 0 && Math.random() > 0.4) {
        platforms.push({
          x: width + 30,
          y: height - 90 - Math.random() * 60,
          width: 50,
          height: 22,
          type: 'pipe',
        });
      }

      // Physics
      player.velocityY += GRAVITY;
      player.y += player.velocityY;

      // Platform collision
      let onPlatform = false;
      for (const platform of platforms) {
        const playerBottom = player.y + player.height;
        const playerRight = player.x + player.width;
        const playerLeft = player.x;
        
        // Only collide if falling down
        if (player.velocityY > 0) {
          if (playerBottom >= platform.y && 
              playerBottom <= platform.y + 15 &&
              playerRight > platform.x + 5 && 
              playerLeft < platform.x + platform.width - 5) {
            player.y = platform.y - player.height;
            player.velocityY = 0;
            if (player.isJumping && wasJumpingRef.current) {
              playSound('land');
              wasJumpingRef.current = false;
            }
            player.isJumping = false;
            player.jumpCount = 0;
            onPlatform = true;
            break;
          }
        }
        
        // Side collision with pipes (obstacles)
        if (platform.type === 'pipe') {
          const pipeLeft = platform.x + 5;
          const pipeRight = platform.x + platform.width - 5;
          
          if (playerRight > pipeLeft && playerLeft < pipeRight &&
              playerBottom > platform.y + 10 && player.y < groundY) {
            // Push player back
            if (playerRight - pipeLeft < 15) {
              player.x = pipeLeft - player.width - 2;
            }
          }
        }
      }

      // Ground collision
      if (player.y + player.height >= groundY) {
        player.y = groundY - player.height;
        player.velocityY = 0;
        if (player.isJumping && wasJumpingRef.current) {
          playSound('land');
          wasJumpingRef.current = false;
        }
        player.isJumping = false;
        player.jumpCount = 0;
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2;
        p.life--;
        
        ctx.globalAlpha = p.life / (p.text ? 30 : 40);
        if (p.text) {
          const scale = 1 + (40 - p.life) * 0.02;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.scale(scale, scale);
          ctx.font = 'bold 16px sans-serif';
          ctx.fillStyle = '#ffff00';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 3;
          ctx.strokeText(p.text, 0, 0);
          ctx.fillText(p.text, 0, 0);
          ctx.restore();
        } else {
          // Glowing particles
          const size = 3 + (40 - p.life) * 0.05;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
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

      // Spawn Karens
      frameCountRef.current++;
      
      if (frameCountRef.current % karenSpawnRateRef.current === 0) {
        const types: ('basic' | 'manager' | 'supervisor' | 'regional')[] = 
          ['basic', 'manager', 'supervisor', 'regional'];
        const type = types[Math.floor(Math.random() * types.length)];
        const phrase = KAREN_PHRASES[Math.floor(Math.random() * KAREN_PHRASES.length)];
        
        // Spawn on ground or on a platform
        const spawnY = Math.random() > 0.5 ? height - 110 : height - 160 - Math.random() * 80;
        
        karens.push({
          x: width + 20,
          y: spawnY,
          type,
          width: 40,
          height: 55,
          isHit: false,
          velocityY: 0,
          isBoss: false,
          phrase,
          headImage: Math.floor(Math.random() * 3),
          usePhoto: Math.random() < 0.3, // 30% chance to use meme photo
        });
      }
      
      // Boss Karen
      if (frameCountRef.current % BOSS_SPAWN_RATE === 0 && frameCountRef.current > 300) {
        const bossPhrase = BOSS_KAREN_PHRASES[Math.floor(Math.random() * BOSS_KAREN_PHRASES.length)];
        karens.push({
          x: width + 30,
          y: height - 160,
          type: 'boss',
          width: 60,
          height: 80,
          isHit: false,
          velocityY: 0,
          isBoss: true,
          phrase: bossPhrase,
          headImage: Math.floor(Math.random() * 3),
          usePhoto: Math.random() < 0.5, // 50% chance for boss to use meme photo
        });
      }

      // Update and draw Karens
      for (let i = karens.length - 1; i >= 0; i--) {
        const karen = karens[i];
        karen.x -= gameSpeedRef.current * (karen.isBoss ? 0.7 : 1);
        
        // Apply gravity to Karens
        karen.velocityY += GRAVITY * 0.5;
        karen.y += karen.velocityY;
        
        // Karen ground/platform collision
        if (karen.y + karen.height > groundY) {
          karen.y = groundY - karen.height;
          karen.velocityY = 0;
        }
        
        for (const platform of platforms) {
          if (karen.velocityY >= 0 &&
              karen.y + karen.height >= platform.y &&
              karen.y + karen.height <= platform.y + 10 &&
              karen.x + karen.width > platform.x &&
              karen.x < platform.x + platform.width) {
            karen.y = platform.y - karen.height;
            karen.velocityY = 0;
          }
        }

        // Paddle hit detection - only when swinging!
        if (player.isSwinging && player.paddleSwing > 0.3 && player.paddleSwing < 2.5) {
          const swingBonus = 20;
          const paddleRect = {
            x: player.facingRight ? player.x + 35 : player.x - 50,
            y: player.y - 10,
            width: 50 + swingBonus,
            height: 50,
          };

          if (!karen.isHit && checkCollision(paddleRect, karen)) {
            karen.isHit = true;
            const config = KAREN_CONFIG[karen.type];
            
            comboRef.current++;
            setCombo(comboRef.current);
            lastHitTimeRef.current = currentTime;
            
            // Robust multiplier system - scales up to 10x for huge combos
            const multiplier = Math.min(comboRef.current, 10);
            const basePoints = config.points;
            const points = basePoints * multiplier;
            scoreRef.current += points;
            setScore(scoreRef.current);
            
            playSound(karen.isBoss ? 'bossHit' : 'hit');
            spawnParticles(karen.x + 20, karen.y, karen.isBoss ? '#ff0000' : '#e91e63', karen.isBoss ? 20 : 12, `+${points}`, true);
            triggerScreenShake(karen.isBoss ? 12 : 6);
            
            if (scoreRef.current % 100 === 0) {
              gameSpeedRef.current += 0.12;
            }
          }
        }

        // Body collision - Karens hurt you
        const bodyRect = {
          x: player.x + 8,
          y: player.y + 8,
          width: 26,
          height: 42,
        };

        if (!karen.isHit && checkCollision(bodyRect, karen)) {
          karen.isHit = true;
          const damage = karen.isBoss ? 1 : 0.5;
          livesRef.current -= damage;
          setLives(Math.max(0, livesRef.current));
          player.isHurt = true;
          comboRef.current = 0;
          setCombo(0);
          
          playSound('hurt');
          spawnParticles(karen.x, karen.y, '#ff0000', 15, undefined, true);
          triggerScreenShake(8);
          
          if (livesRef.current <= 0) {
            playSound('gameOver');
            setGameState('gameover');
            return;
          }
        }

        if (!karen.isHit) {
          drawKaren(ctx, karen, frameCountRef.current);
        }

        if (karen.x + karen.width < 0 || karen.isHit) {
          karens.splice(i, 1);
        }
      }

      // Spawn toppings
      if (frameCountRef.current % TOPPING_SPAWN_RATE === 0) {
        const types: ('pepperoni' | 'mushroom' | 'olive' | 'pepper' | 'cheese')[] = 
          ['pepperoni', 'mushroom', 'olive', 'pepper', 'cheese'];
        const type = types[Math.floor(Math.random() * types.length)];
        
        toppings.push({
          x: width + 10,
          y: 70 + Math.random() * 120,
          type,
          width: 28,
          height: 28,
          collected: false,
          velocityY: 0,
        });
      }

      // Update and draw toppings
      for (let i = toppings.length - 1; i >= 0; i--) {
        const topping = toppings[i];
        topping.x -= gameSpeedRef.current * 1.1;
        topping.y += Math.sin(frameCountRef.current * 0.05 + i) * 0.6;

        const playerRect = {
          x: player.x,
          y: player.y,
          width: player.width + 40,
          height: player.height,
        };

        if (!topping.collected && checkCollision(playerRect, topping)) {
          topping.collected = true;
          const config = TOPPING_CONFIG[topping.type];
          scoreRef.current += config.points;
          setScore(scoreRef.current);
          
          playSound('collect');
          spawnParticles(topping.x, topping.y, config.color, 8, `+${config.points}`);
        }

        if (!topping.collected) {
          // Pulsing glow effect
          const pulse = Math.sin(frameCountRef.current * 0.1 + i) * 0.3 + 0.7;
          
          // Outer glow ring
          ctx.save();
          ctx.shadowColor = TOPPING_CONFIG[topping.type].color;
          ctx.shadowBlur = 12 * pulse;
          ctx.beginPath();
          ctx.arc(topping.x + 14, topping.y + 14, 18 + pulse * 3, 0, Math.PI * 2);
          ctx.fillStyle = `${TOPPING_CONFIG[topping.type].color}22`;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
          
          // Inner circle background
          ctx.fillStyle = `${TOPPING_CONFIG[topping.type].color}44`;
          ctx.beginPath();
          ctx.arc(topping.x + 14, topping.y + 14, 15, 0, Math.PI * 2);
          ctx.fill();
          
          // Emoji
          ctx.font = '24px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(TOPPING_CONFIG[topping.type].emoji, topping.x + 14, topping.y + 14);
          ctx.textBaseline = 'alphabetic';
        }

        if (topping.x + topping.width < 0 || topping.collected) {
          toppings.splice(i, 1);
        }
      }

      // Level indicator with better styling
      ctx.save();
      const levelPulse = Math.sin(frameCountRef.current * 0.05) * 0.1 + 0.9;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillStyle = `rgba(255,255,255,${levelPulse})`;
      ctx.fillText(`🎮 ${currentLevelRef.current.name}`, width / 2, 60);
      ctx.shadowBlur = 0;
      ctx.restore();

      // Combo display with animated effect
      if (comboRef.current > 1) {
        ctx.save();
        const comboPulse = Math.sin(frameCountRef.current * 0.15) * 0.1 + 1;
        const comboColors = ['#e74c3c', '#f39c12', '#9b59b6', '#3498db', '#2ecc71'];
        const comboColor = comboColors[Math.min(comboRef.current - 1, comboColors.length - 1)];
        
        ctx.font = `bold ${20 + comboPulse * 4}px sans-serif`;
        ctx.shadowColor = comboColor;
        ctx.shadowBlur = 10;
        ctx.fillStyle = comboColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        const comboText = `${comboRef.current}x COMBO!`;
        ctx.textAlign = 'center';
        ctx.strokeText(comboText, width / 2, 85);
        ctx.fillText(comboText, width / 2, 85);
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // UI bar with gradient
      const uiGradient = ctx.createLinearGradient(0, 0, 0, 44);
      uiGradient.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
      uiGradient.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
      ctx.fillStyle = uiGradient;
      ctx.fillRect(0, 0, width, 44);
      
      // Decorative line under UI
      ctx.fillStyle = 'linear-gradient(90deg, #e74c3c, #f39c12, #e74c3c)';
      ctx.fillRect(0, 42, width, 2);
      
      // Format score with K/M for huge numbers
      const formatScore = (s: number) => {
        if (s >= 1000000) return (s / 1000000).toFixed(1) + 'M';
        if (s >= 10000) return (s / 1000).toFixed(1) + 'K';
        return s.toString();
      };
      
      // Score with glow
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 4;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`🍕 ${formatScore(scoreRef.current)}`, 10, 28);
      ctx.shadowBlur = 0;
      
      // Show current multiplier
      const currentMultiplier = Math.min(comboRef.current, 10);
      if (currentMultiplier > 1) {
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`x${currentMultiplier}`, 10, 40);
      }

      // Lives display
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'right';
      const fullHearts = Math.floor(livesRef.current);
      const hasHalfHeart = livesRef.current % 1 !== 0;
      
      for (let i = 2; i >= 0; i--) {
        const xPos = width - 10 - (2 - i) * 26;
        const heartIndex = 2 - i;
        
        if (heartIndex < fullHearts) {
          ctx.fillText('❤️', xPos, 28);
        } else if (heartIndex === fullHearts && hasHalfHeart) {
          ctx.globalAlpha = 0.35;
          ctx.fillText('🖤', xPos, 28);
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.beginPath();
          ctx.rect(xPos - 22, 0, 11, 40);
          ctx.clip();
          ctx.fillText('❤️', xPos, 28);
          ctx.restore();
        } else {
          ctx.globalAlpha = 0.35;
          ctx.fillText('🖤', xPos, 28);
          ctx.globalAlpha = 1;
        }
      }
      ctx.textAlign = 'left';

      // Retro scanline effect overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
      for (let y = 0; y < height; y += 3) {
        ctx.fillRect(0, y, width, 1);
      }

      // Vignette effect
      const vignetteGradient = ctx.createRadialGradient(
        width / 2, height / 2, height * 0.3,
        width / 2, height / 2, height * 0.8
      );
      vignetteGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignetteGradient.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
      ctx.fillStyle = vignetteGradient;
      ctx.fillRect(0, 0, width, height);

      // Restore canvas after screen shake
      if (screenShakeRef.current > 0 || true) {
        ctx.restore();
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoopRef.current = requestAnimationFrame((t) => gameLoop(t));

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
      if (e.repeat) return; // Prevent key repeat causing issues
      if (e.code === 'Space') {
        e.preventDefault();
        handleJump();
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        movingLeftRef.current = true;
        setMovingLeft(true);
        playerRef.current.facingRight = false;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        movingRightRef.current = true;
        setMovingRight(true);
        playerRef.current.facingRight = true;
      }
    };
    
    const handleKeyup = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        movingLeftRef.current = false;
        setMovingLeft(false);
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        movingRightRef.current = false;
        setMovingRight(false);
      }
    };
    
    // Use capture phase for more reliable input
    window.addEventListener('keydown', handleKeydown, { capture: true });
    window.addEventListener('keyup', handleKeyup, { capture: true });
    
    // Clear stuck keys on blur
    const handleBlur = () => {
      movingLeftRef.current = false;
      movingRightRef.current = false;
      setMovingLeft(false);
      setMovingRight(false);
    };
    window.addEventListener('blur', handleBlur);
    
    return () => {
      window.removeEventListener('keydown', handleKeydown, { capture: true });
      window.removeEventListener('keyup', handleKeyup, { capture: true });
      window.removeEventListener('blur', handleBlur);
    };
  }, [handleJump]); // Only depend on handleJump

  const { width, height } = getCanvasDimensions();

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] px-3 py-1">
        <div className="flex items-center gap-2 mb-0">
          <Button variant="ghost" size="icon" onClick={() => navigate('/games')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold flex-1">Super Karen Destroy 3</h1>
          <div className="flex items-center gap-2">
            {gameState === 'playing' && (
              <div className="flex items-center gap-0.5">
                {[0, 1, 2].map((i) => {
                  const fullHearts = Math.floor(lives);
                  const hasHalfHeart = lives % 1 !== 0;
                  const isFull = i < fullHearts;
                  const isHalf = i === fullHearts && hasHalfHeart;
                  
                  return (
                    <div key={i} className="relative w-5 h-5 flex items-center justify-center">
                      {isFull ? (
                        <Heart className="h-5 w-5 text-red-500" fill="currentColor" />
                      ) : isHalf ? (
                        <div className="relative w-5 h-5">
                          <Heart className="absolute h-5 w-5 text-muted-foreground/30" fill="currentColor" />
                          <div className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
                            <Heart className="h-5 w-5 text-red-500" fill="currentColor" />
                          </div>
                        </div>
                      ) : (
                        <Heart className="h-5 w-5 text-muted-foreground/30" fill="currentColor" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <span>{highScore}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-start justify-center pt-1">
          {gameState === 'idle' ? (
            <div className="text-center p-6 rounded-2xl bg-gradient-to-b from-background/80 to-background border border-border/50 backdrop-blur-sm max-w-sm">
              <div className="text-7xl mb-4 animate-bounce">👨‍🍳💥💇‍♀️</div>
              <h2 className="text-2xl font-black mb-2 bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500 bg-clip-text text-transparent">
                Super Karen Destroy 3
              </h2>
              <p className="text-muted-foreground mb-4 text-sm">
                Smash Karens with your pizza paddle across 7 epic levels!
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-4 bg-muted/30 rounded-lg p-3">
                <div className="text-left">
                  <p className="font-bold text-foreground mb-1">🎮 Controls</p>
                  <p>⬆️ Jump & Attack</p>
                  <p>⬅️➡️ Move</p>
                </div>
                <div className="text-left">
                  <p className="font-bold text-foreground mb-1">🗺️ Levels</p>
                  <p className="truncate">🏙️ City → 🏜️ Desert</p>
                  <p className="truncate">⛰️ Mountains → 🌌 Space</p>
                </div>
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-4">
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3 text-red-500" fill="currentColor" />
                  <Heart className="h-3 w-3 text-red-500" fill="currentColor" />
                  <Heart className="h-3 w-3 text-red-500" fill="currentColor" />
                  3 Lives
                </span>
                <span className="text-border">•</span>
                <span>🔥 Combo multipliers up to 10x</span>
              </div>
              <Button onClick={initGame} size="lg" className="gap-2 w-full bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white font-bold shadow-lg shadow-red-500/25">
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
                className="rounded-xl shadow-2xl touch-none"
                style={{ width, height }}
              />

              {/* Mobile controls overlay */}
              {gameState === 'playing' && (
                <div className="absolute bottom-2 left-2 right-2 flex justify-between items-end pointer-events-none">
                  {/* Left button */}
                  <Button
                    size="lg"
                    variant={movingLeft ? "default" : "secondary"}
                    className="pointer-events-auto h-16 w-16 rounded-full opacity-80 select-none"
                    onTouchStart={(e) => { 
                      e.preventDefault(); 
                      e.stopPropagation();
                      movingLeftRef.current = true;
                      setMovingLeft(true);
                      playerRef.current.facingRight = false;
                    }}
                    onTouchEnd={(e) => { 
                      e.preventDefault();
                      e.stopPropagation();
                      movingLeftRef.current = false;
                      setMovingLeft(false);
                    }}
                    onTouchCancel={() => {
                      movingLeftRef.current = false;
                      setMovingLeft(false);
                    }}
                    onMouseDown={() => {
                      movingLeftRef.current = true;
                      setMovingLeft(true);
                      playerRef.current.facingRight = false;
                    }}
                    onMouseUp={() => {
                      movingLeftRef.current = false;
                      setMovingLeft(false);
                    }}
                    onMouseLeave={() => {
                      movingLeftRef.current = false;
                      setMovingLeft(false);
                    }}
                  >
                    <ChevronLeft className="h-10 w-10" />
                  </Button>
                  
                  {/* Center jump button - LARGE for easy tapping */}
                  <Button
                    size="lg"
                    variant="default"
                    className="pointer-events-auto h-20 w-20 rounded-full bg-primary/90 hover:bg-primary select-none text-2xl font-bold"
                    onTouchStart={(e) => { 
                      e.preventDefault();
                      e.stopPropagation();
                      handleJump();
                    }}
                    onClick={handleJump}
                  >
                    ⬆️
                  </Button>
                  
                  {/* Right button */}
                  <Button
                    size="lg"
                    variant={movingRight ? "default" : "secondary"}
                    className="pointer-events-auto h-16 w-16 rounded-full opacity-80 select-none"
                    onTouchStart={(e) => { 
                      e.preventDefault();
                      e.stopPropagation();
                      movingRightRef.current = true;
                      setMovingRight(true);
                      playerRef.current.facingRight = true;
                    }}
                    onTouchEnd={(e) => { 
                      e.preventDefault();
                      e.stopPropagation();
                      movingRightRef.current = false;
                      setMovingRight(false);
                    }}
                    onTouchCancel={() => {
                      movingRightRef.current = false;
                      setMovingRight(false);
                    }}
                    onMouseDown={() => {
                      movingRightRef.current = true;
                      setMovingRight(true);
                      playerRef.current.facingRight = true;
                    }}
                    onMouseUp={() => {
                      movingRightRef.current = false;
                      setMovingRight(false);
                    }}
                    onMouseLeave={() => {
                      movingRightRef.current = false;
                      setMovingRight(false);
                    }}
                  >
                    <ChevronRight className="h-10 w-10" />
                  </Button>
                </div>
              )}

              {gameState === 'gameover' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-background/95 to-destructive/10 backdrop-blur-sm rounded-xl p-6">
                  <div className="text-6xl mb-3 animate-pulse">💇‍♀️💢</div>
                  <p className="text-3xl font-black text-destructive mb-2">The Karens Won!</p>
                  <div className="bg-muted/50 rounded-lg px-4 py-2 mb-3">
                    <p className="text-sm text-muted-foreground">You reached</p>
                    <p className="text-lg font-bold text-foreground">{currentLevel.name}</p>
                  </div>
                  <div className="relative mb-4">
                    <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                    <p className="relative text-6xl font-black bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 bg-clip-text text-transparent">
                      {score.toLocaleString()}
                    </p>
                  </div>
                  <p className="text-muted-foreground mb-4 text-sm">
                    {score > highScore ? '🎉 NEW HIGH SCORE!' : `Best: ${highScore.toLocaleString()}`}
                  </p>
                  <div className="flex gap-3">
                    <Button onClick={initGame} size="lg" className="gap-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold shadow-lg">
                      <RotateCcw className="h-5 w-5" />
                      Try Again
                    </Button>
                    {score > 0 && (
                      <Button
                        onClick={() => setShareDialogOpen(true)}
                        size="lg"
                        variant="outline"
                        className="gap-2 border-2"
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
          <p className="text-center text-xs text-muted-foreground py-0.5">
            ← Move Left • ⬆️ Jump (tap twice for double jump!) • Move Right →
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
