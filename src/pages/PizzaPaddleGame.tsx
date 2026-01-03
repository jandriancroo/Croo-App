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

const GRAVITY = 0.55;
const JUMP_FORCE = -15;
const GAME_SPEED_START = 3.5;
const KAREN_SPAWN_RATE = 80;
const BOSS_SPAWN_RATE = 500; // Boss every ~500 frames
const TOPPING_SPAWN_RATE = 120; // Spawn toppings regularly

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

const playSound = (type: 'hit' | 'hurt' | 'collect' | 'jump' | 'bossHit' | 'gameOver') => {
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
    x: 50,
    y: 0,
    velocityY: 0,
    isJumping: false,
    width: 60,
    height: 80,
    frame: 0,
    isHurt: false,
    paddleSwing: 0,
    isSwinging: false,
  });

  const karensRef = useRef<Karen[]>([]);
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
      paddleSwing: 0,
      isSwinging: false,
    };
    
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

  // Draw Karen character
  const drawKaren = (ctx: CanvasRenderingContext2D, karen: Karen, frame: number) => {
    const { x, y, type, isBoss } = karen;
    const config = KAREN_CONFIG[type];
    const scale = isBoss ? 1.5 : 1;
    const headSize = isBoss ? 28 : 18;
    const bobOffset = Math.sin(frame * 0.1 + x) * 3;

    ctx.save();
    
    // Draw phrase above Karen (from the Karen object)
    ctx.font = isBoss ? 'bold 14px sans-serif' : 'bold 12px sans-serif';
    ctx.fillStyle = isBoss ? '#ff0000' : '#333';
    ctx.textAlign = 'center';
    ctx.fillText(karen.phrase, x + 20 * scale, y - 20 * scale);

    // Body
    ctx.fillStyle = isBoss ? '#2c0000' : '#e91e63';
    ctx.beginPath();
    ctx.ellipse(x + 20 * scale, y + 35 * scale + bobOffset, 15 * scale, 20 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms crossed (Karen pose)
    ctx.strokeStyle = '#fdbba4';
    ctx.lineWidth = 6 * scale;
    ctx.beginPath();
    ctx.moveTo(x + 5 * scale, y + 30 * scale + bobOffset);
    ctx.lineTo(x + 35 * scale, y + 35 * scale + bobOffset);
    ctx.stroke();

    // Head
    ctx.fillStyle = '#fdbba4';
    ctx.beginPath();
    ctx.arc(x + 20 * scale, y + 10 * scale + bobOffset, headSize, 0, Math.PI * 2);
    ctx.fill();

    // Karen haircut (the iconic asymmetric bob)
    ctx.fillStyle = config.hairColor;
    ctx.beginPath();
    // Back of hair
    ctx.ellipse(x + 20 * scale, y + 5 * scale + bobOffset, headSize + 5, headSize + 2, 0, Math.PI, 0);
    ctx.fill();
    
    // Asymmetric front - longer on one side
    ctx.beginPath();
    ctx.moveTo(x + 2 * scale, y + 5 * scale + bobOffset);
    ctx.quadraticCurveTo(x - 5 * scale, y + 25 * scale + bobOffset, x + 5 * scale, y + 30 * scale + bobOffset);
    ctx.lineTo(x + 12 * scale, y + 15 * scale + bobOffset);
    ctx.fill();
    
    // Short side
    ctx.beginPath();
    ctx.moveTo(x + 38 * scale, y + 5 * scale + bobOffset);
    ctx.quadraticCurveTo(x + 42 * scale, y + 12 * scale + bobOffset, x + 38 * scale, y + 18 * scale + bobOffset);
    ctx.lineTo(x + 30 * scale, y + 10 * scale + bobOffset);
    ctx.fill();

    // Spiky top
    ctx.beginPath();
    ctx.moveTo(x + 10 * scale, y - 5 * scale + bobOffset);
    ctx.lineTo(x + 15 * scale, y - 12 * scale + bobOffset);
    ctx.lineTo(x + 20 * scale, y - 8 * scale + bobOffset);
    ctx.lineTo(x + 25 * scale, y - 14 * scale + bobOffset);
    ctx.lineTo(x + 30 * scale, y - 5 * scale + bobOffset);
    ctx.closePath();
    ctx.fill();

    // Eyes
    if (isBoss) {
      // Red glowing eyes for boss
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(x + 14 * scale, y + 8 * scale + bobOffset, 4 * scale, 0, Math.PI * 2);
      ctx.arc(x + 26 * scale, y + 8 * scale + bobOffset, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      // Evil pupils
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x + 14 * scale, y + 8 * scale + bobOffset, 2 * scale, 0, Math.PI * 2);
      ctx.arc(x + 26 * scale, y + 8 * scale + bobOffset, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal angry eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(x + 14 * scale, y + 8 * scale + bobOffset, 4 * scale, 5 * scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 26 * scale, y + 8 * scale + bobOffset, 4 * scale, 5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x + 14 * scale, y + 9 * scale + bobOffset, 2 * scale, 0, Math.PI * 2);
      ctx.arc(x + 26 * scale, y + 9 * scale + bobOffset, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // Angry eyebrows
    ctx.strokeStyle = config.hairColor;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(x + 10 * scale, y + 2 * scale + bobOffset);
    ctx.lineTo(x + 18 * scale, y + 5 * scale + bobOffset);
    ctx.moveTo(x + 30 * scale, y + 2 * scale + bobOffset);
    ctx.lineTo(x + 22 * scale, y + 5 * scale + bobOffset);
    ctx.stroke();

    // Frowning mouth
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.arc(x + 20 * scale, y + 20 * scale + bobOffset, 5 * scale, Math.PI + 0.3, -0.3);
    ctx.stroke();

    // Pointing finger (for boss)
    if (isBoss) {
      ctx.fillStyle = '#fdbba4';
      ctx.beginPath();
      ctx.moveTo(x + 40 * scale, y + 25 * scale + bobOffset);
      ctx.lineTo(x + 55 * scale, y + 20 * scale + bobOffset);
      ctx.lineTo(x + 55 * scale, y + 25 * scale + bobOffset);
      ctx.lineTo(x + 40 * scale, y + 30 * scale + bobOffset);
      ctx.fill();
    }

    ctx.restore();
  };

  // Draw the chef SIDEWAYS like Mario (side-scrolling style)
  const drawPlayer = (ctx: CanvasRenderingContext2D, player: Player, frame: number) => {
    ctx.save();
    
    const bobOffset = Math.sin(frame * 0.15) * 2;
    const legSwing = Math.sin(frame * 0.3) * 10;
    const runCycle = player.isJumping ? 0 : legSwing;
    
    // Update paddle swing
    if (player.isSwinging) {
      player.paddleSwing += 0.4;
      if (player.paddleSwing >= Math.PI) {
        player.isSwinging = false;
        player.paddleSwing = 0;
      }
    }
    
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(player.x + 25, groundYRef.current, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const yOffset = player.y + bobOffset;
    
    if (player.isHurt) {
      ctx.globalAlpha = 0.7 + Math.sin(frame * 0.5) * 0.3;
    }

    // === SIDEWAYS MARIO-STYLE PIZZA GUY ===
    
    // Back leg (behind body)
    ctx.fillStyle = '#2c3e50';
    ctx.save();
    ctx.translate(player.x + 20, yOffset + 55);
    ctx.rotate(runCycle * 0.05);
    ctx.fillRect(-5, 0, 10, 22);
    // Back shoe
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(-3, 20, 14, 6);
    ctx.restore();

    // Body (side view - narrower)
    ctx.fillStyle = '#ecf0f1';
    ctx.beginPath();
    ctx.ellipse(player.x + 25, yOffset + 40, 12, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Apron detail
    ctx.fillStyle = '#bdc3c7';
    ctx.beginPath();
    ctx.ellipse(player.x + 30, yOffset + 42, 6, 15, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Front leg
    ctx.fillStyle = '#2c3e50';
    ctx.save();
    ctx.translate(player.x + 28, yOffset + 55);
    ctx.rotate(-runCycle * 0.05);
    ctx.fillRect(-5, 0, 10, 22);
    // Front shoe
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(-3, 20, 16, 6);
    ctx.restore();

    // Neck (side)
    ctx.fillStyle = '#e0ac69';
    ctx.fillRect(player.x + 22, yOffset + 18, 10, 8);

    // Head (side profile - oval)
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.ellipse(player.x + 30, yOffset + 10, 12, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose (side profile)
    ctx.fillStyle = '#e0ac69';
    ctx.beginPath();
    ctx.ellipse(player.x + 42, yOffset + 10, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hair (side - back of head)
    ctx.fillStyle = '#2c1810';
    ctx.beginPath();
    ctx.arc(player.x + 25, yOffset + 5, 12, Math.PI * 0.7, Math.PI * 1.8);
    ctx.lineTo(player.x + 20, yOffset + 15);
    ctx.fill();

    // Chef hat (side view)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(player.x + 28, yOffset - 15, 14, 10, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 25, yOffset - 20, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 32, yOffset - 22, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x + 38, yOffset - 18, 7, 0, Math.PI * 2);
    ctx.fill();

    // Eye (side - just one visible)
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.ellipse(player.x + 36, yOffset + 6, 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(player.x + 37, yOffset + 5, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Mouth (side - smile)
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x + 40, yOffset + 14, 3, 0, Math.PI * 0.7);
    ctx.stroke();

    // Mustache (side profile)
    ctx.fillStyle = '#2c1810';
    ctx.beginPath();
    ctx.moveTo(player.x + 38, yOffset + 12);
    ctx.quadraticCurveTo(player.x + 46, yOffset + 14, player.x + 48, yOffset + 10);
    ctx.quadraticCurveTo(player.x + 46, yOffset + 11, player.x + 38, yOffset + 12);
    ctx.fill();

    // ARM AND PADDLE (extending forward)
    const baseSwing = -0.3;
    const swingAngle = player.isSwinging 
      ? baseSwing - Math.sin(player.paddleSwing) * 1.2
      : baseSwing + Math.sin(frame * 0.2) * 0.1;
    
    ctx.save();
    ctx.translate(player.x + 38, yOffset + 32);
    ctx.rotate(swingAngle);
    
    // Motion blur effect when swinging
    if (player.isSwinging && player.paddleSwing > 0.5 && player.paddleSwing < 2) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#d4a373';
      for (let i = 1; i <= 3; i++) {
        ctx.save();
        ctx.rotate(-i * 0.15);
        ctx.beginPath();
        ctx.arc(45, 0, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    
    // Arm (chef sleeve)
    ctx.fillStyle = '#ecf0f1';
    ctx.fillRect(0, -5, 18, 10);
    
    // Hand
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.arc(18, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    
    // Paddle handle
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(22, -3, 15, 6);
    
    // Paddle head (pizza peel)
    ctx.fillStyle = '#d4a373';
    ctx.beginPath();
    ctx.arc(45, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a0522d';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Paddle pattern (pepperoni spots)
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(40, -4, 3, 0, Math.PI * 2);
    ctx.arc(48, 4, 3, 0, Math.PI * 2);
    ctx.arc(50, -2, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // "POW" effect when swinging
    if (player.isSwinging && player.paddleSwing > 1 && player.paddleSwing < 2) {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#ff6b35';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeText('POW!', 55, -8);
      ctx.fillText('POW!', 55, -8);
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
      const groundY = groundYRef.current;
      const currentTime = Date.now();

      // Background gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#87ceeb');
      gradient.addColorStop(0.6, '#e0f6ff');
      gradient.addColorStop(1, '#b8e994');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Background buildings (pizza shops)
      ctx.fillStyle = '#d4a373';
      ctx.fillRect(50 - (frameCountRef.current * 0.5) % 600, height - 150, 60, 100);
      ctx.fillRect(200 - (frameCountRef.current * 0.5) % 600, height - 180, 80, 130);
      ctx.fillRect(400 - (frameCountRef.current * 0.5) % 600, height - 130, 50, 80);
      
      // Shop signs
      ctx.fillStyle = '#e74c3c';
      ctx.font = '10px sans-serif';
      ctx.fillText('🍕 PIZZA', 55 - (frameCountRef.current * 0.5) % 600, height - 155);

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
      
      ctx.fillStyle = '#27ae60';
      for (let i = 0; i < width; i += 20) {
        ctx.fillRect(i - (frameCountRef.current * gameSpeedRef.current) % 20, height - 50, 2, 50);
      }

      // Physics
      player.velocityY += GRAVITY;
      player.y += player.velocityY;

      if (player.y + player.height >= groundY) {
        player.y = groundY - player.height;
        player.velocityY = 0;
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
      
      // Regular Karens
      if (frameCountRef.current % KAREN_SPAWN_RATE === 0) {
        const types: ('basic' | 'manager' | 'supervisor' | 'regional')[] = 
          ['basic', 'manager', 'supervisor', 'regional'];
        const type = types[Math.floor(Math.random() * types.length)];
        const phrase = KAREN_PHRASES[Math.floor(Math.random() * KAREN_PHRASES.length)];
        
        karens.push({
          x: width + 20,
          y: height - 120 - Math.random() * 150,
          type,
          width: 45,
          height: 60,
          isHit: false,
          velocityY: (Math.random() - 0.5) * 2,
          isBoss: false,
          phrase,
        });
      }
      
      // Boss Karen (less frequent)
      if (frameCountRef.current % BOSS_SPAWN_RATE === 0 && frameCountRef.current > 200) {
        const bossPhrase = BOSS_KAREN_PHRASES[Math.floor(Math.random() * BOSS_KAREN_PHRASES.length)];
        karens.push({
          x: width + 30,
          y: height - 180,
          type: 'boss',
          width: 70,
          height: 90,
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
        karen.y += karen.velocityY;
        karen.velocityY += 0.02;

        // Keep in bounds
        if (karen.y > groundY - karen.height) {
          karen.y = groundY - karen.height;
          karen.velocityY = -Math.abs(karen.velocityY) * 0.5;
        }

        // Paddle hit detection (extended when swinging)
        const swingBonus = player.isSwinging ? 20 : 0;
        const paddleRect = {
          x: player.x + 55,
          y: player.y + 5,
          width: 55 + swingBonus,
          height: 55,
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
          
          // Play hit sound
          playSound(karen.isBoss ? 'bossHit' : 'hit');
          
          // Spawn hit particles with score
          spawnParticles(karen.x + 20, karen.y, karen.isBoss ? '#ff0000' : '#e91e63', 12, `+${points}`);
          
          if (scoreRef.current % 100 === 0) {
            gameSpeedRef.current += 0.15;
          }
        }

        // Body collision - Karens hurt you when they touch you (not hit first)
        const bodyRect = {
          x: player.x + 15,
          y: player.y + 15,
          width: 35,
          height: 60,
        };

        if (!karen.isHit && checkCollision(bodyRect, karen)) {
          karen.isHit = true;
          // Half heart for regular, full heart for boss (using 0.5 increments)
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

        // Draw Karen
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
          y: 80 + Math.random() * 150,
          type,
          width: 30,
          height: 30,
          collected: false,
          velocityY: Math.sin(Math.random() * Math.PI) * 0.5,
        });
      }

      // Update and draw toppings
      for (let i = toppings.length - 1; i >= 0; i--) {
        const topping = toppings[i];
        topping.x -= gameSpeedRef.current * 1.2;
        topping.y += Math.sin(frameCountRef.current * 0.05 + i) * 0.8;

        // Player collision (collect with body or paddle)
        const playerRect = {
          x: player.x,
          y: player.y,
          width: player.width + 60,
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

        // Draw topping
        if (!topping.collected) {
          ctx.font = '24px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(TOPPING_CONFIG[topping.type].emoji, topping.x + 15, topping.y + 22);
          
          // Glow effect
          ctx.shadowColor = TOPPING_CONFIG[topping.type].color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(topping.x + 15, topping.y + 15, 18, 0, Math.PI * 2);
          ctx.strokeStyle = `${TOPPING_CONFIG[topping.type].color}44`;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        if (topping.x + topping.width < 0 || topping.collected) {
          toppings.splice(i, 1);
        }
      }

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

      // UI bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, width, 45);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(`Score: ${scoreRef.current}`, 15, 30);

      // Lives - half hearts support (6 half hearts = 3 full hearts)
      ctx.font = '24px serif';
      const fullHearts = Math.floor(livesRef.current);
      const hasHalfHeart = livesRef.current % 1 !== 0;
      
      for (let i = 0; i < 3; i++) {
        const xPos = width - 35 - i * 32;
        if (i < fullHearts) {
          ctx.fillText('❤️', xPos, 32);
        } else if (i === fullHearts && hasHalfHeart) {
          // Draw half heart - using a clipped approach
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.fillText('❤️', xPos, 32);
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillRect(xPos + 12, 10, 20, 30);
          ctx.restore();
          ctx.globalAlpha = 0.3;
          ctx.fillText('🖤', xPos, 32);
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = 0.3;
          ctx.fillText('🖤', xPos, 32);
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
                Defend your pizza shop from angry Karens!
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
            Tap to jump & swing paddle • Hit Karens, avoid body contact!
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
