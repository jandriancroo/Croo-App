import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { ShareScoreDialog } from '@/components/games/ShareScoreDialog';
import karenHead1 from '@/assets/karen-head-1.jpeg';
import karenHead2 from '@/assets/karen-head-2.jpeg';
import karenHead3 from '@/assets/karen-head-3.jpeg';

interface Karen {
  id: number;
  x: number;
  z: number;
  health: number;
  type: 'photo' | 'cartoon';
  photoIndex?: number;
  speed: number;
  angle: number;
}

interface Meatball {
  id: number;
  x: number;
  z: number;
  angle: number;
  speed: number;
}

interface SauceSplat {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
}

type GameState = 'portrait-warning' | 'idle' | 'playing' | 'gameover';

const karenPhotos = [karenHead1, karenHead2, karenHead3];

export default function KarenDungeon3D() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  
  const [gameState, setGameState] = useState<GameState>('portrait-warning');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [health, setHealth] = useState(100);
  const [ammo, setAmmo] = useState(10);
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  
  // Game state refs
  const playerRef = useRef({ x: 0, z: 0, angle: 0 });
  const karensRef = useRef<Karen[]>([]);
  const meatballsRef = useRef<Meatball[]>([]);
  const sauceSplatsRef = useRef<SauceSplat[]>([]);
  const scoreRef = useRef(0);
  const healthRef = useRef(100);
  const ammoRef = useRef(10);
  const comboRef = useRef(0);
  const lastComboTimeRef = useRef(0);
  const swingingRef = useRef(false);
  const swingAngleRef = useRef(0);
  const nextKarenIdRef = useRef(0);
  const nextMeatballIdRef = useRef(0);
  const nextSplatIdRef = useRef(0);
  const loadedImagesRef = useRef<HTMLImageElement[]>([]);
  
  // Controls state
  const controlsRef = useRef({
    left: false,
    right: false,
    up: false,
    down: false,
  });

  // Check orientation
  useEffect(() => {
    const checkOrientation = () => {
      const landscape = window.innerWidth > window.innerHeight;
      setIsLandscape(landscape);
      if (landscape && gameState === 'portrait-warning') {
        setGameState('idle');
      } else if (!landscape && gameState !== 'portrait-warning' && gameState !== 'gameover') {
        setGameState('portrait-warning');
      }
    };
    
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, [gameState]);

  // Load Karen images
  useEffect(() => {
    const images: HTMLImageElement[] = [];
    karenPhotos.forEach((src, index) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        images[index] = img;
      };
    });
    loadedImagesRef.current = images;
  }, []);

  // Fetch high score
  useEffect(() => {
    const fetchHighScore = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('game_high_scores')
        .select('score')
        .eq('user_id', user.id)
        .eq('game_type', 'karen-dungeon')
        .order('score', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setHighScore(data.score);
    };
    fetchHighScore();
  }, [user]);

  const saveScore = async (finalScore: number) => {
    if (!user || finalScore === 0) return;
    try {
      await supabase.from('game_high_scores').insert({
        user_id: user.id,
        game_type: 'karen-dungeon',
        score: finalScore,
      });
      if (finalScore > highScore) {
        setHighScore(finalScore);
        toast.success('New high score!');
      }
    } catch (error) {
      console.error('Error saving score:', error);
    }
  };

  const spawnKaren = useCallback(() => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 15 + Math.random() * 10;
    const karen: Karen = {
      id: nextKarenIdRef.current++,
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      health: 1,
      type: Math.random() > 0.5 ? 'photo' : 'cartoon',
      photoIndex: Math.floor(Math.random() * 3),
      speed: 0.02 + Math.random() * 0.02,
      angle: 0,
    };
    karensRef.current.push(karen);
  }, []);

  const shootMeatball = useCallback(() => {
    if (ammoRef.current <= 0) return;
    
    ammoRef.current--;
    setAmmo(ammoRef.current);
    
    const meatball: Meatball = {
      id: nextMeatballIdRef.current++,
      x: playerRef.current.x,
      z: playerRef.current.z,
      angle: playerRef.current.angle,
      speed: 0.5,
    };
    meatballsRef.current.push(meatball);
  }, []);

  const swingPaddle = useCallback(() => {
    if (swingingRef.current) return;
    swingingRef.current = true;
    swingAngleRef.current = 0;
  }, []);

  const createSauceSplat = (screenX: number, screenY: number) => {
    for (let i = 0; i < 8; i++) {
      sauceSplatsRef.current.push({
        id: nextSplatIdRef.current++,
        x: screenX + (Math.random() - 0.5) * 100,
        y: screenY + (Math.random() - 0.5) * 100,
        size: 20 + Math.random() * 40,
        opacity: 1,
      });
    }
  };

  const startGame = useCallback(() => {
    playerRef.current = { x: 0, z: 0, angle: 0 };
    karensRef.current = [];
    meatballsRef.current = [];
    sauceSplatsRef.current = [];
    scoreRef.current = 0;
    healthRef.current = 100;
    ammoRef.current = 10;
    comboRef.current = 0;
    setScore(0);
    setHealth(100);
    setAmmo(10);
    setCombo(0);
    setMultiplier(1);
    setGameState('playing');
    
    // Spawn initial Karens
    for (let i = 0; i < 3; i++) {
      spawnKaren();
    }
  }, [spawnKaren]);

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let spawnTimer = 0;
    let ammoTimer = 0;

    const gameLoop = (timestamp: number) => {
      const deltaTime = Math.min(timestamp - lastTimeRef.current, 50);
      lastTimeRef.current = timestamp;
      
      const width = canvas.width;
      const height = canvas.height;
      
      // Clear canvas with dungeon floor color
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);
      
      // Draw floor gradient
      const floorGradient = ctx.createLinearGradient(0, height * 0.5, 0, height);
      floorGradient.addColorStop(0, '#2d2d44');
      floorGradient.addColorStop(1, '#1a1a2e');
      ctx.fillStyle = floorGradient;
      ctx.fillRect(0, height * 0.5, width, height * 0.5);
      
      // Draw ceiling
      const ceilGradient = ctx.createLinearGradient(0, 0, 0, height * 0.5);
      ceilGradient.addColorStop(0, '#0f0f1a');
      ceilGradient.addColorStop(1, '#1a1a2e');
      ctx.fillStyle = ceilGradient;
      ctx.fillRect(0, 0, width, height * 0.5);
      
      // Player movement
      const moveSpeed = 0.08 * (deltaTime / 16);
      const turnSpeed = 0.04 * (deltaTime / 16);
      
      if (controlsRef.current.left) {
        playerRef.current.angle -= turnSpeed;
      }
      if (controlsRef.current.right) {
        playerRef.current.angle += turnSpeed;
      }
      if (controlsRef.current.up) {
        playerRef.current.x += Math.cos(playerRef.current.angle) * moveSpeed;
        playerRef.current.z += Math.sin(playerRef.current.angle) * moveSpeed;
      }
      if (controlsRef.current.down) {
        playerRef.current.x -= Math.cos(playerRef.current.angle) * moveSpeed;
        playerRef.current.z -= Math.sin(playerRef.current.angle) * moveSpeed;
      }
      
      // Update swing animation
      if (swingingRef.current) {
        swingAngleRef.current += 15 * (deltaTime / 16);
        if (swingAngleRef.current >= 180) {
          swingingRef.current = false;
          swingAngleRef.current = 0;
        }
      }
      
      // Update meatballs
      meatballsRef.current = meatballsRef.current.filter(meatball => {
        meatball.x += Math.cos(meatball.angle) * meatball.speed * (deltaTime / 16);
        meatball.z += Math.sin(meatball.angle) * meatball.speed * (deltaTime / 16);
        
        const dist = Math.sqrt(meatball.x ** 2 + meatball.z ** 2);
        return dist < 30;
      });
      
      // Update Karens
      karensRef.current = karensRef.current.filter(karen => {
        // Move toward player
        const dx = playerRef.current.x - karen.x;
        const dz = playerRef.current.z - karen.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist > 0.1) {
          karen.x += (dx / dist) * karen.speed * (deltaTime / 16);
          karen.z += (dz / dist) * karen.speed * (deltaTime / 16);
        }
        
        // Check collision with player
        if (dist < 1) {
          healthRef.current -= 10;
          setHealth(healthRef.current);
          comboRef.current = 0;
          setCombo(0);
          setMultiplier(1);
          
          if (healthRef.current <= 0) {
            setGameState('gameover');
            saveScore(scoreRef.current);
          }
          return false;
        }
        
        // Check collision with meatballs
        for (let i = meatballsRef.current.length - 1; i >= 0; i--) {
          const mb = meatballsRef.current[i];
          const mbDist = Math.sqrt((mb.x - karen.x) ** 2 + (mb.z - karen.z) ** 2);
          if (mbDist < 1.5) {
            meatballsRef.current.splice(i, 1);
            
            // Calculate screen position for splat
            const relX = karen.x - playerRef.current.x;
            const relZ = karen.z - playerRef.current.z;
            const angle = Math.atan2(relZ, relX) - playerRef.current.angle;
            const screenX = width / 2 + Math.tan(angle) * (width / 2);
            createSauceSplat(screenX, height * 0.4);
            
            // Add score
            const now = Date.now();
            if (now - lastComboTimeRef.current < 2000) {
              comboRef.current++;
            } else {
              comboRef.current = 1;
            }
            lastComboTimeRef.current = now;
            
            const newMultiplier = Math.min(10, 1 + Math.floor(comboRef.current / 3));
            setCombo(comboRef.current);
            setMultiplier(newMultiplier);
            
            scoreRef.current += 100 * newMultiplier;
            setScore(scoreRef.current);
            
            return false;
          }
        }
        
        // Check paddle swing hit
        if (swingingRef.current && dist < 2) {
          const relAngle = Math.atan2(dz, dx) - playerRef.current.angle;
          const normalizedAngle = ((relAngle + Math.PI) % (Math.PI * 2)) - Math.PI;
          if (Math.abs(normalizedAngle) < Math.PI / 3) {
            scoreRef.current += 150 * multiplier;
            setScore(scoreRef.current);
            return false;
          }
        }
        
        return true;
      });
      
      // Update sauce splats
      sauceSplatsRef.current = sauceSplatsRef.current.filter(splat => {
        splat.opacity -= 0.01 * (deltaTime / 16);
        return splat.opacity > 0;
      });
      
      // Spawn Karens
      spawnTimer += deltaTime;
      if (spawnTimer > 2000) {
        spawnTimer = 0;
        spawnKaren();
      }
      
      // Regenerate ammo
      ammoTimer += deltaTime;
      if (ammoTimer > 3000 && ammoRef.current < 10) {
        ammoTimer = 0;
        ammoRef.current++;
        setAmmo(ammoRef.current);
      }
      
      // Draw sauce splats
      sauceSplatsRef.current.forEach(splat => {
        ctx.fillStyle = `rgba(200, 50, 50, ${splat.opacity})`;
        ctx.beginPath();
        ctx.ellipse(splat.x, splat.y, splat.size, splat.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Sort Karens by distance for proper rendering
      const sortedKarens = [...karensRef.current].sort((a, b) => {
        const distA = Math.sqrt((a.x - playerRef.current.x) ** 2 + (a.z - playerRef.current.z) ** 2);
        const distB = Math.sqrt((b.x - playerRef.current.x) ** 2 + (b.z - playerRef.current.z) ** 2);
        return distB - distA;
      });
      
      // Draw Karens
      sortedKarens.forEach(karen => {
        const relX = karen.x - playerRef.current.x;
        const relZ = karen.z - playerRef.current.z;
        const dist = Math.sqrt(relX * relX + relZ * relZ);
        
        const angle = Math.atan2(relZ, relX) - playerRef.current.angle;
        
        // Check if in view
        if (Math.abs(angle) > Math.PI / 2) return;
        
        const screenX = width / 2 + Math.tan(angle) * (width / 2);
        const scale = Math.max(0.1, 3 / dist);
        const karenSize = 120 * scale;
        const screenY = height * 0.5 - karenSize * 0.3;
        
        if (karen.type === 'photo' && karen.photoIndex !== undefined) {
          const img = loadedImagesRef.current[karen.photoIndex];
          if (img && img.complete) {
            // Draw circular Karen head
            ctx.save();
            ctx.beginPath();
            ctx.arc(screenX, screenY, karenSize / 2, 0, Math.PI * 2);
            ctx.clip();
            
            // Draw image cropped to focus on face
            const imgSize = Math.min(img.width, img.height);
            ctx.drawImage(
              img,
              img.width / 2 - imgSize / 3,
              img.height * 0.1,
              imgSize * 0.66,
              imgSize * 0.66,
              screenX - karenSize / 2,
              screenY - karenSize / 2,
              karenSize,
              karenSize
            );
            ctx.restore();
            
            // Angry red glow
            ctx.strokeStyle = `rgba(255, 0, 0, ${0.5 + Math.sin(Date.now() / 200) * 0.3})`;
            ctx.lineWidth = 3 * scale;
            ctx.beginPath();
            ctx.arc(screenX, screenY, karenSize / 2 + 2, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          // Draw cartoon Karen
          ctx.fillStyle = '#ffcc99';
          ctx.beginPath();
          ctx.arc(screenX, screenY, karenSize / 2, 0, Math.PI * 2);
          ctx.fill();
          
          // Angry eyebrows
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 3 * scale;
          ctx.beginPath();
          ctx.moveTo(screenX - karenSize * 0.25, screenY - karenSize * 0.15);
          ctx.lineTo(screenX - karenSize * 0.1, screenY - karenSize * 0.05);
          ctx.moveTo(screenX + karenSize * 0.25, screenY - karenSize * 0.15);
          ctx.lineTo(screenX + karenSize * 0.1, screenY - karenSize * 0.05);
          ctx.stroke();
          
          // Eyes
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(screenX - karenSize * 0.15, screenY, karenSize * 0.12, 0, Math.PI * 2);
          ctx.arc(screenX + karenSize * 0.15, screenY, karenSize * 0.12, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#333';
          ctx.beginPath();
          ctx.arc(screenX - karenSize * 0.15, screenY, karenSize * 0.06, 0, Math.PI * 2);
          ctx.arc(screenX + karenSize * 0.15, screenY, karenSize * 0.06, 0, Math.PI * 2);
          ctx.fill();
          
          // Angry mouth
          ctx.strokeStyle = '#c00';
          ctx.lineWidth = 2 * scale;
          ctx.beginPath();
          ctx.arc(screenX, screenY + karenSize * 0.2, karenSize * 0.15, 0, Math.PI);
          ctx.stroke();
          
          // Karen haircut
          ctx.fillStyle = '#ffd700';
          ctx.beginPath();
          ctx.ellipse(screenX, screenY - karenSize * 0.35, karenSize * 0.4, karenSize * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      
      // Draw meatballs
      meatballsRef.current.forEach(meatball => {
        const relX = meatball.x - playerRef.current.x;
        const relZ = meatball.z - playerRef.current.z;
        const dist = Math.sqrt(relX * relX + relZ * relZ);
        const angle = Math.atan2(relZ, relX) - playerRef.current.angle;
        
        if (Math.abs(angle) > Math.PI / 2) return;
        
        const screenX = width / 2 + Math.tan(angle) * (width / 2);
        const scale = Math.max(0.1, 2 / dist);
        const size = 20 * scale;
        const screenY = height * 0.5;
        
        // Meatball
        const gradient = ctx.createRadialGradient(screenX - size * 0.2, screenY - size * 0.2, 0, screenX, screenY, size);
        gradient.addColorStop(0, '#8b4513');
        gradient.addColorStop(1, '#5c3317');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Draw paddle if swinging
      if (swingingRef.current) {
        const paddleX = width / 2 + Math.sin(swingAngleRef.current * Math.PI / 180) * 100;
        const paddleY = height * 0.7;
        
        // Paddle handle
        ctx.fillStyle = '#8b4513';
        ctx.fillRect(paddleX - 10, paddleY, 20, 80);
        
        // Paddle head
        ctx.fillStyle = '#deb887';
        ctx.beginPath();
        ctx.ellipse(paddleX, paddleY - 30, 50, 60, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8b4513';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      
      // Draw crosshair
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(width / 2 - 15, height / 2);
      ctx.lineTo(width / 2 + 15, height / 2);
      ctx.moveTo(width / 2, height / 2 - 15);
      ctx.lineTo(width / 2, height / 2 + 15);
      ctx.stroke();
      
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };
    
    gameLoopRef.current = requestAnimationFrame(gameLoop);
    
    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameState, spawnKaren, multiplier]);

  // Format score
  const formatScore = (s: number) => {
    if (s >= 1000000) return `${(s / 1000000).toFixed(1)}M`;
    if (s >= 1000) return `${(s / 1000).toFixed(1)}K`;
    return s.toString();
  };

  // Portrait warning screen
  if (gameState === 'portrait-warning') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-4 z-50">
        <RotateCcw className="w-24 h-24 text-primary animate-spin mb-6" style={{ animationDuration: '3s' }} />
        <h1 className="text-2xl font-bold text-center mb-2">Rotate Your Device</h1>
        <p className="text-muted-foreground text-center">
          Karen Dungeon 3D requires landscape mode to play
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => navigate('/games')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Games
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden touch-none">
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="absolute inset-0"
      />
      
      {/* HUD - Top */}
      <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none z-10">
        <div className="flex flex-col gap-1">
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5">
            <div className="text-xs text-muted-foreground">SCORE</div>
            <div className="text-xl font-bold text-white">{formatScore(score)}</div>
          </div>
          {combo > 1 && (
            <div className="bg-primary/80 backdrop-blur-sm rounded-lg px-3 py-1 animate-pulse">
              <span className="text-white font-bold">{combo}x COMBO! {multiplier}x</span>
            </div>
          )}
        </div>
        
        <div className="flex flex-col items-end gap-1">
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5">
            <div className="text-xs text-muted-foreground">HIGH</div>
            <div className="text-lg font-bold text-primary">{formatScore(highScore)}</div>
          </div>
        </div>
      </div>
      
      {/* Health Bar */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-48 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg p-2">
          <div className="text-xs text-center text-white mb-1">HEALTH</div>
          <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all"
              style={{ width: `${health}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* Ammo Counter */}
      <div className="absolute bottom-32 right-4 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2">
          <div className="text-xs text-muted-foreground text-center">AMMO</div>
          <div className="flex gap-1 mt-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className={`w-2 h-4 rounded-sm ${i < ammo ? 'bg-amber-500' : 'bg-gray-600'}`}
              />
            ))}
          </div>
        </div>
      </div>
      
      {/* OSD Controls - Left Side D-Pad */}
      <div className="absolute bottom-8 left-8 z-20" style={{ opacity: 0.4 }}>
        <div className="relative w-36 h-36">
          {/* Up */}
          <button
            className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 bg-white/30 rounded-lg flex items-center justify-center active:bg-white/50"
            onTouchStart={() => controlsRef.current.up = true}
            onTouchEnd={() => controlsRef.current.up = false}
            onMouseDown={() => controlsRef.current.up = true}
            onMouseUp={() => controlsRef.current.up = false}
            onMouseLeave={() => controlsRef.current.up = false}
          >
            <span className="text-white text-2xl font-bold">▲</span>
          </button>
          
          {/* Down */}
          <button
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-12 bg-white/30 rounded-lg flex items-center justify-center active:bg-white/50"
            onTouchStart={() => controlsRef.current.down = true}
            onTouchEnd={() => controlsRef.current.down = false}
            onMouseDown={() => controlsRef.current.down = true}
            onMouseUp={() => controlsRef.current.down = false}
            onMouseLeave={() => controlsRef.current.down = false}
          >
            <span className="text-white text-2xl font-bold">▼</span>
          </button>
          
          {/* Left */}
          <button
            className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/30 rounded-lg flex items-center justify-center active:bg-white/50"
            onTouchStart={() => controlsRef.current.left = true}
            onTouchEnd={() => controlsRef.current.left = false}
            onMouseDown={() => controlsRef.current.left = true}
            onMouseUp={() => controlsRef.current.left = false}
            onMouseLeave={() => controlsRef.current.left = false}
          >
            <span className="text-white text-2xl font-bold">◀</span>
          </button>
          
          {/* Right */}
          <button
            className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/30 rounded-lg flex items-center justify-center active:bg-white/50"
            onTouchStart={() => controlsRef.current.right = true}
            onTouchEnd={() => controlsRef.current.right = false}
            onMouseDown={() => controlsRef.current.right = true}
            onMouseUp={() => controlsRef.current.right = false}
            onMouseLeave={() => controlsRef.current.right = false}
          >
            <span className="text-white text-2xl font-bold">▶</span>
          </button>
        </div>
      </div>
      
      {/* OSD Controls - Right Side A+B Buttons */}
      <div className="absolute bottom-8 right-8 z-20" style={{ opacity: 0.4 }}>
        <div className="flex gap-4">
          {/* B Button - Meatball Cannon */}
          <button
            className="w-16 h-16 bg-red-500/50 rounded-full flex items-center justify-center active:bg-red-500/80 border-2 border-white/30"
            onTouchStart={shootMeatball}
            onMouseDown={shootMeatball}
          >
            <span className="text-white text-xl font-bold">B</span>
          </button>
          
          {/* A Button - Paddle Swing */}
          <button
            className="w-16 h-16 bg-green-500/50 rounded-full flex items-center justify-center active:bg-green-500/80 border-2 border-white/30"
            onTouchStart={swingPaddle}
            onMouseDown={swingPaddle}
          >
            <span className="text-white text-xl font-bold">A</span>
          </button>
        </div>
      </div>
      
      {/* Idle State */}
      {gameState === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-30">
          <h1 className="text-4xl font-bold text-white mb-2 drop-shadow-lg">
            🏰 KAREN DUNGEON 3D 🍕
          </h1>
          <p className="text-lg text-gray-300 mb-6">
            First-Person Karen Destroyer
          </p>
          <div className="flex gap-4">
            <Button
              variant="outline"
              onClick={() => navigate('/games')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button
              size="lg"
              onClick={startGame}
              className="bg-primary hover:bg-primary/90 text-xl px-8"
            >
              START GAME
            </Button>
          </div>
          <div className="mt-6 text-gray-400 text-sm text-center max-w-sm">
            <p>D-Pad: Move & Turn</p>
            <p>A: Swing Paddle | B: Shoot Meatball</p>
          </div>
        </div>
      )}
      
      {/* Game Over State */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30">
          <h1 className="text-4xl font-bold text-red-500 mb-4">GAME OVER</h1>
          <div className="text-2xl text-white mb-2">Score: {formatScore(score)}</div>
          {score >= highScore && score > 0 && (
            <div className="text-lg text-primary mb-4">🎉 NEW HIGH SCORE!</div>
          )}
          <div className="flex gap-4 mt-4">
            <Button
              variant="outline"
              onClick={() => navigate('/games')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button onClick={startGame}>
              Play Again
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowShareDialog(true)}
            >
              Share Score
            </Button>
          </div>
        </div>
      )}
      
      {/* Share Dialog */}
      <ShareScoreDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        score={score}
        gameType="karen-dungeon"
        gameName="Karen Dungeon 3D"
      />
    </div>
  );
}
