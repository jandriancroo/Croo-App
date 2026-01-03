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

const GRAVITY = 0.6;
const JUMP_FORCE = -14;
const GAME_SPEED_START = 3;
const KAREN_SPAWN_RATE = 90;
const BOSS_SPAWN_RATE = 600;
const TOPPING_SPAWN_RATE = 140;
const PLATFORM_SPAWN_RATE = 180;
const PIPE_SPAWN_RATE = 250;

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

const playSound = (type: 'hit' | 'hurt' | 'collect' | 'jump' | 'bossHit' | 'gameOver' | 'land') => {
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

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [combo, setCombo] = useState(0);

  const playerRef = useRef<Player>({
    x: 80,
    y: 0,
    velocityY: 0,
    isJumping: false,
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
      isJumping: false,
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
      wasJumpingRef.current = true;
      playSound('jump');
    }
    // Trigger paddle swing
    player.isSwinging = true;
    player.paddleSwing = 0;
  }, [gameState]);

  const spawnParticles = (x: number, y: number, color: string, count: number, text?: string) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 1) * 6,
        life: 30,
        color,
        text: i === 0 ? text : undefined,
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

  // Draw brick platform (Mario style)
  const drawBrickPlatform = (ctx: CanvasRenderingContext2D, platform: Platform) => {
    const brickWidth = 20;
    const brickHeight = 12;
    const rows = Math.floor(platform.height / brickHeight);
    const cols = Math.ceil(platform.width / brickWidth);
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const offsetX = row % 2 === 0 ? 0 : brickWidth / 2;
        const brickX = platform.x + col * brickWidth - offsetX;
        const brickY = platform.y + row * brickHeight;
        
        // Brick face - warm orange-brown
        ctx.fillStyle = '#c84c0c';
        ctx.fillRect(brickX, brickY, brickWidth - 1, brickHeight - 1);
        
        // Highlights
        ctx.fillStyle = '#e87020';
        ctx.fillRect(brickX, brickY, brickWidth - 2, 2);
        ctx.fillRect(brickX, brickY, 2, brickHeight - 2);
        
        // Shadows
        ctx.fillStyle = '#8c3808';
        ctx.fillRect(brickX + brickWidth - 2, brickY, 1, brickHeight - 1);
        ctx.fillRect(brickX, brickY + brickHeight - 2, brickWidth - 1, 1);
      }
    }
  };

  // Draw PVC pipe (black style)
  const drawPipe = (ctx: CanvasRenderingContext2D, platform: Platform, groundY: number) => {
    const pipeHeight = groundY - platform.y;
    
    // Main pipe body - black PVC
    const gradient = ctx.createLinearGradient(platform.x, 0, platform.x + platform.width, 0);
    gradient.addColorStop(0, '#1a1a1a');
    gradient.addColorStop(0.2, '#3a3a3a');
    gradient.addColorStop(0.5, '#2a2a2a');
    gradient.addColorStop(0.8, '#1a1a1a');
    gradient.addColorStop(1, '#0a0a0a');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(platform.x + 5, platform.y + 20, platform.width - 10, pipeHeight - 20);
    
    // Pipe top rim (wider)
    const topGradient = ctx.createLinearGradient(platform.x, 0, platform.x + platform.width, 0);
    topGradient.addColorStop(0, '#2a2a2a');
    topGradient.addColorStop(0.2, '#4a4a4a');
    topGradient.addColorStop(0.5, '#3a3a3a');
    topGradient.addColorStop(0.8, '#2a2a2a');
    topGradient.addColorStop(1, '#1a1a1a');
    
    ctx.fillStyle = topGradient;
    ctx.fillRect(platform.x, platform.y, platform.width, 22);
    
    // Shine effect
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(platform.x + 8, platform.y + 22, 4, pipeHeight - 25);
    
    // Pipe rim highlight
    ctx.strokeStyle = '#4a4a4a';
    ctx.lineWidth = 2;
    ctx.strokeRect(platform.x + 1, platform.y + 1, platform.width - 2, 20);
  };

  // Draw Karen character
  const drawKaren = (ctx: CanvasRenderingContext2D, karen: Karen, frame: number) => {
    const { x, y, type, isBoss } = karen;
    const config = KAREN_CONFIG[type];
    const scale = isBoss ? 1.4 : 1;
    const headSize = isBoss ? 26 : 16;
    const bobOffset = Math.sin(frame * 0.1 + x) * 3;

    ctx.save();
    
    // Draw phrase above Karen
    ctx.font = isBoss ? 'bold 12px sans-serif' : 'bold 10px sans-serif';
    ctx.fillStyle = isBoss ? '#ff0000' : '#333';
    ctx.textAlign = 'center';
    ctx.fillText(karen.phrase, x + 18 * scale, y - 15 * scale);

    // Body
    ctx.fillStyle = isBoss ? '#2c0000' : '#e91e63';
    ctx.beginPath();
    ctx.ellipse(x + 18 * scale, y + 32 * scale + bobOffset, 13 * scale, 18 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms crossed
    ctx.strokeStyle = '#fdbba4';
    ctx.lineWidth = 5 * scale;
    ctx.beginPath();
    ctx.moveTo(x + 5 * scale, y + 28 * scale + bobOffset);
    ctx.lineTo(x + 32 * scale, y + 32 * scale + bobOffset);
    ctx.stroke();

    // Head
    ctx.fillStyle = '#fdbba4';
    ctx.beginPath();
    ctx.arc(x + 18 * scale, y + 10 * scale + bobOffset, headSize, 0, Math.PI * 2);
    ctx.fill();

    // Karen haircut
    ctx.fillStyle = config.hairColor;
    ctx.beginPath();
    ctx.ellipse(x + 18 * scale, y + 5 * scale + bobOffset, headSize + 4, headSize + 1, 0, Math.PI, 0);
    ctx.fill();
    
    // Asymmetric front
    ctx.beginPath();
    ctx.moveTo(x + 2 * scale, y + 5 * scale + bobOffset);
    ctx.quadraticCurveTo(x - 4 * scale, y + 22 * scale + bobOffset, x + 5 * scale, y + 26 * scale + bobOffset);
    ctx.lineTo(x + 10 * scale, y + 12 * scale + bobOffset);
    ctx.fill();
    
    // Short side
    ctx.beginPath();
    ctx.moveTo(x + 34 * scale, y + 5 * scale + bobOffset);
    ctx.quadraticCurveTo(x + 38 * scale, y + 10 * scale + bobOffset, x + 34 * scale, y + 15 * scale + bobOffset);
    ctx.lineTo(x + 26 * scale, y + 8 * scale + bobOffset);
    ctx.fill();

    // Spiky top
    ctx.beginPath();
    ctx.moveTo(x + 8 * scale, y - 4 * scale + bobOffset);
    ctx.lineTo(x + 12 * scale, y - 10 * scale + bobOffset);
    ctx.lineTo(x + 18 * scale, y - 6 * scale + bobOffset);
    ctx.lineTo(x + 24 * scale, y - 12 * scale + bobOffset);
    ctx.lineTo(x + 28 * scale, y - 4 * scale + bobOffset);
    ctx.closePath();
    ctx.fill();

    // Eyes
    if (isBoss) {
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(x + 12 * scale, y + 8 * scale + bobOffset, 3.5 * scale, 0, Math.PI * 2);
      ctx.arc(x + 24 * scale, y + 8 * scale + bobOffset, 3.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x + 12 * scale, y + 8 * scale + bobOffset, 1.5 * scale, 0, Math.PI * 2);
      ctx.arc(x + 24 * scale, y + 8 * scale + bobOffset, 1.5 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(x + 12 * scale, y + 8 * scale + bobOffset, 3.5 * scale, 4 * scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 24 * scale, y + 8 * scale + bobOffset, 3.5 * scale, 4 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x + 12 * scale, y + 9 * scale + bobOffset, 1.8 * scale, 0, Math.PI * 2);
      ctx.arc(x + 24 * scale, y + 9 * scale + bobOffset, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // Angry eyebrows
    ctx.strokeStyle = config.hairColor;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(x + 8 * scale, y + 2 * scale + bobOffset);
    ctx.lineTo(x + 16 * scale, y + 5 * scale + bobOffset);
    ctx.moveTo(x + 28 * scale, y + 2 * scale + bobOffset);
    ctx.lineTo(x + 20 * scale, y + 5 * scale + bobOffset);
    ctx.stroke();

    // Frowning mouth
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.arc(x + 18 * scale, y + 18 * scale + bobOffset, 4 * scale, Math.PI + 0.3, -0.3);
    ctx.stroke();

    if (isBoss) {
      ctx.fillStyle = '#fdbba4';
      ctx.beginPath();
      ctx.moveTo(x + 36 * scale, y + 22 * scale + bobOffset);
      ctx.lineTo(x + 50 * scale, y + 18 * scale + bobOffset);
      ctx.lineTo(x + 50 * scale, y + 22 * scale + bobOffset);
      ctx.lineTo(x + 36 * scale, y + 26 * scale + bobOffset);
      ctx.fill();
    }

    ctx.restore();
  };

  // Draw Mario-style Pizza Chef (more Mario-like!)
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

    // === MARIO-STYLE PIZZA CHEF (SIDE VIEW) ===
    
    // Back leg
    ctx.fillStyle = '#1e3a5f'; // Blue overalls like Mario
    ctx.save();
    ctx.translate(player.x + 12, yOffset + 35);
    ctx.rotate((player.isJumping ? 0.3 : runCycle * 0.03));
    ctx.fillRect(-4, 0, 9, 16);
    // Brown shoe (Mario style)
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.ellipse(2, 16, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Back arm (behind body)
    ctx.fillStyle = '#e74c3c'; // Red shirt like Mario
    ctx.save();
    ctx.translate(player.x + 16, yOffset + 18);
    ctx.rotate(-0.2 + Math.sin(frame * 0.2) * 0.1);
    ctx.fillRect(-3, 0, 7, 14);
    // Hand
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
    // Brown shoe
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.ellipse(4, 16, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Neck
    ctx.fillStyle = '#f4d0a8';
    ctx.fillRect(player.x + 17, yOffset + 6, 8, 6);

    // Head (side profile - oval, more Mario-like proportions)
    ctx.fillStyle = '#f4d0a8';
    ctx.beginPath();
    ctx.ellipse(player.x + 24, yOffset - 2, 11, 13, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Big Mario nose
    ctx.fillStyle = '#e8c090';
    ctx.beginPath();
    ctx.ellipse(player.x + 35, yOffset + 2, 6, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Hair/sideburns (brown like Mario)
    ctx.fillStyle = '#4a2c0a';
    ctx.beginPath();
    ctx.arc(player.x + 18, yOffset - 2, 10, Math.PI * 0.6, Math.PI * 1.6);
    ctx.lineTo(player.x + 16, yOffset + 8);
    ctx.fill();
    
    // Sideburn
    ctx.fillRect(player.x + 12, yOffset + 2, 4, 8);

    // Chef hat (white, puffy like Mario's cap but chef style)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(player.x + 22, yOffset - 18, 13, 9, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 18, yOffset - 22, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 26, yOffset - 24, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 32, yOffset - 20, 6, 0, Math.PI * 2);
    ctx.fill();
    
    // Hat band (red like Mario's cap M)
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(player.x + 11, yOffset - 10, 22, 4);
    
    // Pizza logo on hat
    ctx.font = '8px sans-serif';
    ctx.fillText('🍕', player.x + 18, yOffset - 15);

    // Eye (just one visible in side view)
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.ellipse(player.x + 29, yOffset - 2, 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(player.x + 30, yOffset - 3, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Big Mario mustache
    ctx.fillStyle = '#4a2c0a';
    ctx.beginPath();
    ctx.moveTo(player.x + 28, yOffset + 5);
    ctx.quadraticCurveTo(player.x + 38, yOffset + 9, player.x + 42, yOffset + 4);
    ctx.quadraticCurveTo(player.x + 40, yOffset + 2, player.x + 34, yOffset + 4);
    ctx.quadraticCurveTo(player.x + 30, yOffset + 3, player.x + 28, yOffset + 5);
    ctx.fill();

    ctx.restore();

    // FRONT ARM WITH PIZZA PADDLE (always visible, not flipped)
    const baseSwing = player.facingRight ? -0.4 : 0.4;
    const swingAngle = player.isSwinging 
      ? baseSwing - Math.sin(player.paddleSwing) * 1.3 * (player.facingRight ? 1 : -1)
      : baseSwing + Math.sin(frame * 0.15) * 0.08 * (player.facingRight ? 1 : -1);
    
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

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = getCanvasDimensions();
    canvas.width = width;
    canvas.height = height;

    const gameLoop = () => {
      const player = playerRef.current;
      const karens = karensRef.current;
      const toppings = toppingsRef.current;
      const particles = particlesRef.current;
      const platforms = platformsRef.current;
      const groundY = groundYRef.current;
      const currentTime = Date.now();

      // Sky gradient (Mario style - brighter blue)
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#5c94fc');
      gradient.addColorStop(0.7, '#87ceeb');
      gradient.addColorStop(1, '#5c94fc');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Background hills (Mario style)
      ctx.fillStyle = '#2a8000';
      for (let i = -1; i < 3; i++) {
        const hillX = (i * 200 - (frameCountRef.current * 0.3) % 200);
        ctx.beginPath();
        ctx.arc(hillX + 80, height - 45, 70, Math.PI, 0);
        ctx.fill();
      }

      // Clouds (Mario style blocks)
      ctx.fillStyle = '#ffffff';
      const cloudPositions = [100, 280, 450];
      cloudPositions.forEach((baseX, i) => {
        const cloudX = (baseX - (frameCountRef.current * 0.4) % (width + 100));
        const cloudY = 50 + (i % 2) * 30;
        ctx.beginPath();
        ctx.arc(cloudX, cloudY, 18, 0, Math.PI * 2);
        ctx.arc(cloudX + 22, cloudY - 5, 22, 0, Math.PI * 2);
        ctx.arc(cloudX + 44, cloudY, 18, 0, Math.PI * 2);
        ctx.fill();
        // Cloud eyes
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(cloudX + 14, cloudY - 3, 2, 0, Math.PI * 2);
        ctx.arc(cloudX + 30, cloudY - 3, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
      });

      // Ground (Mario style)
      ctx.fillStyle = '#c84c0c';
      ctx.fillRect(0, height - 50, width, 50);
      
      // Ground pattern (bricks)
      for (let i = 0; i < width; i += 24) {
        const offsetX = (frameCountRef.current * gameSpeedRef.current) % 24;
        ctx.fillStyle = '#e87020';
        ctx.fillRect(i - offsetX, height - 50, 22, 2);
        ctx.fillRect(i - offsetX, height - 50, 2, 50);
        ctx.fillStyle = '#8c3808';
        ctx.fillRect(i - offsetX + 21, height - 50, 2, 50);
      }
      
      // Ground top grass
      ctx.fillStyle = '#00a800';
      ctx.fillRect(0, height - 52, width, 4);

      // Update platforms
      for (let i = platforms.length - 1; i >= 0; i--) {
        const platform = platforms[i];
        platform.x -= gameSpeedRef.current;
        
        if (platform.type === 'brick') {
          drawBrickPlatform(ctx, platform);
        } else if (platform.type === 'pipe') {
          drawPipe(ctx, platform, groundY);
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
            // Push player back or damage
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
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2;
        p.life--;
        
        ctx.globalAlpha = p.life / 30;
        if (p.text) {
          ctx.font = 'bold 14px sans-serif';
          ctx.fillStyle = '#ffff00';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 2;
          ctx.strokeText(p.text, p.x, p.y);
          ctx.fillText(p.text, p.x, p.y);
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
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
      
      if (frameCountRef.current % KAREN_SPAWN_RATE === 0) {
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
        });
      }
      
      // Boss Karen
      if (frameCountRef.current % BOSS_SPAWN_RATE === 0 && frameCountRef.current > 200) {
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

        // Paddle hit detection
        const swingBonus = player.isSwinging ? 18 : 0;
        const paddleRect = {
          x: player.facingRight ? player.x + 40 : player.x - 40,
          y: player.y + 5,
          width: 45 + swingBonus,
          height: 45,
        };

        if (!karen.isHit && checkCollision(paddleRect, karen)) {
          karen.isHit = true;
          const config = KAREN_CONFIG[karen.type];
          
          comboRef.current++;
          setCombo(comboRef.current);
          lastHitTimeRef.current = currentTime;
          
          const multiplier = Math.min(comboRef.current, 5);
          const points = config.points * multiplier;
          scoreRef.current += points;
          setScore(scoreRef.current);
          
          playSound(karen.isBoss ? 'bossHit' : 'hit');
          spawnParticles(karen.x + 20, karen.y, karen.isBoss ? '#ff0000' : '#e91e63', 12, `+${points}`);
          
          if (scoreRef.current % 100 === 0) {
            gameSpeedRef.current += 0.12;
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
          spawnParticles(karen.x, karen.y, '#ff0000', 15);
          
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
          ctx.font = '22px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(TOPPING_CONFIG[topping.type].emoji, topping.x + 14, topping.y + 20);
          
          ctx.shadowColor = TOPPING_CONFIG[topping.type].color;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(topping.x + 14, topping.y + 14, 16, 0, Math.PI * 2);
          ctx.strokeStyle = `${TOPPING_CONFIG[topping.type].color}44`;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        if (topping.x + topping.width < 0 || topping.collected) {
          toppings.splice(i, 1);
        }
      }

      // Combo display
      if (comboRef.current > 1) {
        ctx.save();
        ctx.font = 'bold 22px sans-serif';
        ctx.fillStyle = '#e74c3c';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        const comboText = `${comboRef.current}x COMBO!`;
        ctx.strokeText(comboText, width / 2 - 55, 75);
        ctx.fillText(comboText, width / 2 - 55, 75);
        ctx.restore();
      }

      // UI bar
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, width, 42);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(`Score: ${scoreRef.current}`, 12, 28);

      // Lives display
      ctx.font = '22px serif';
      const fullHearts = Math.floor(livesRef.current);
      const hasHalfHeart = livesRef.current % 1 !== 0;
      
      for (let i = 0; i < 3; i++) {
        const xPos = width - 32 - i * 30;
        if (i < fullHearts) {
          ctx.fillText('❤️', xPos, 30);
        } else if (i === fullHearts && hasHalfHeart) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.fillText('❤️', xPos, 30);
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillRect(xPos + 11, 8, 18, 28);
          ctx.restore();
          ctx.globalAlpha = 0.3;
          ctx.fillText('🖤', xPos, 30);
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = 0.3;
          ctx.fillText('🖤', xPos, 30);
          ctx.globalAlpha = 1;
        }
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
                    <div key={i} className="relative">
                      <Heart 
                        className={`h-5 w-5 ${isFull || isHalf ? 'text-red-500' : 'text-muted-foreground/30'}`}
                        fill={isFull ? 'currentColor' : isHalf ? 'url(#halfGradient)' : 'none'}
                      />
                      {isHalf && (
                        <svg width="0" height="0" className="absolute">
                          <defs>
                            <linearGradient id="halfGradient">
                              <stop offset="50%" stopColor="currentColor" />
                              <stop offset="50%" stopColor="transparent" />
                            </linearGradient>
                          </defs>
                        </svg>
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

        <div className="flex-1 flex items-center justify-center">
          {gameState === 'idle' ? (
            <div className="text-center">
              <div className="text-7xl mb-4">👨‍🍳💥💇‍♀️</div>
              <h2 className="text-2xl font-bold mb-2">Super Karen Destroy 3</h2>
              <p className="text-muted-foreground mb-3 max-w-xs mx-auto">
                Jump on platforms, avoid pipes, defeat Karens!
              </p>
              <div className="text-xs text-muted-foreground mb-3 space-y-1">
                <p className="font-semibold text-foreground">Points per Karen:</p>
                <p>💇‍♀️ Basic: 10 • Manager: 15 • Supervisor: 20</p>
                <p>Regional: 25 • 👹 MEGA KAREN: 100</p>
                <p className="font-semibold text-foreground mt-2">Bonus Toppings:</p>
                <p>🍕 5 • 🍄 8 • 🫒 6 • 🌶️ 10 • 🧀 15</p>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                ❤️ 3 Lives (half heart per Karen, full heart per Boss)
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
                  <div className="text-5xl mb-2">💇‍♀️💢</div>
                  <p className="text-2xl font-bold text-destructive mb-1">The Karens Won!</p>
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
            Tap to jump & swing • Use platforms, avoid pipes!
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
