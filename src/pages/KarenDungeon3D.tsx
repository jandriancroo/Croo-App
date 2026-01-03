import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { ShareScoreDialog } from '@/components/games/ShareScoreDialog';
import { useGameSounds } from '@/hooks/useGameSounds';

// 10 Different AI-generated Karen variations
const KAREN_VARIATIONS = [
  { hair: '#FFD700', skin: '#FFDAB9', lipstick: '#C41E3A', eyeShadow: '#8B008B', expression: 'angry', accessory: 'sunglasses' },
  { hair: '#8B4513', skin: '#DEB887', lipstick: '#FF69B4', eyeShadow: '#4169E1', expression: 'screaming', accessory: 'pearls' },
  { hair: '#F5DEB3', skin: '#FFE4E1', lipstick: '#DC143C', eyeShadow: '#228B22', expression: 'smug', accessory: 'manager-haircut' },
  { hair: '#A52A2A', skin: '#FAEBD7', lipstick: '#B22222', eyeShadow: '#FF6347', expression: 'pointing', accessory: 'phone' },
  { hair: '#D2691E', skin: '#F5F5DC', lipstick: '#FF1493', eyeShadow: '#9400D3', expression: 'eyeroll', accessory: 'wine-glass' },
  { hair: '#BC8F8F', skin: '#FFEBCD', lipstick: '#FF4500', eyeShadow: '#00CED1', expression: 'demanding', accessory: 'visor' },
  { hair: '#CD853F', skin: '#FFDEAD', lipstick: '#E91E63', eyeShadow: '#FF8C00', expression: 'complaining', accessory: 'karen-bob' },
  { hair: '#DAA520', skin: '#FFE4C4', lipstick: '#9C27B0', eyeShadow: '#00BCD4', expression: 'condescending', accessory: 'earrings' },
  { hair: '#F4A460', skin: '#FFF8DC', lipstick: '#673AB7', eyeShadow: '#4CAF50', expression: 'lawsuit-threatening', accessory: 'designer-bag' },
  { hair: '#DEB887', skin: '#FFFACD', lipstick: '#3F51B5', eyeShadow: '#FFEB3B', expression: 'speaking-to-manager', accessory: 'minivan-keys' },
];

// Room themes
const ROOM_THEMES = [
  { name: 'Tea Party', color: '#E8D5B7', props: ['teacups', 'scones', 'doilies'] },
  { name: 'Kids Birthday', color: '#FFB6C1', props: ['balloons', 'cake', 'presents'] },
  { name: 'Rom-Com Couch', color: '#D8BFD8', props: ['tv', 'wine', 'tissues'] },
  { name: 'HOA Meeting', color: '#F5F5DC', props: ['clipboard', 'gavel', 'rule-book'] },
  { name: 'Hallway', color: '#A9A9A9', props: [] },
];

interface Karen {
  id: number;
  x: number;
  z: number;
  y: number;
  health: number;
  variation: number;
  speed: number;
  angle: number;
  dying: boolean;
  deathTime: number;
  goreParticles: GoreParticle[];
}

interface GoreParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: string;
  life: number;
}

interface Meatball {
  id: number;
  x: number;
  z: number;
  y: number;
  angle: number;
  speed: number;
}

interface AmmoPickup {
  id: number;
  x: number;
  z: number;
  collected: boolean;
}

interface Room {
  x: number;
  z: number;
  width: number;
  depth: number;
  theme: number;
  connected: number[];
}

interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

type GameState = 'portrait-warning' | 'idle' | 'playing' | 'gameover';

export default function KarenDungeon3D() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const sounds = useGameSounds();
  
  const [gameState, setGameState] = useState<GameState>('portrait-warning');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [health, setHealth] = useState(100);
  const [ammo, setAmmo] = useState(30);
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  
  // Game state refs
  const playerRef = useRef({ x: 0, z: 0, y: 0, angle: 0 });
  const karensRef = useRef<Karen[]>([]);
  const meatballsRef = useRef<Meatball[]>([]);
  const ammoPickupsRef = useRef<AmmoPickup[]>([]);
  const roomsRef = useRef<Room[]>([]);
  const wallsRef = useRef<Wall[]>([]);
  const scoreRef = useRef(0);
  const healthRef = useRef(100);
  const ammoRef = useRef(30);
  const comboRef = useRef(0);
  const lastComboTimeRef = useRef(0);
  const nextKarenIdRef = useRef(0);
  const nextMeatballIdRef = useRef(0);
  const nextAmmoIdRef = useRef(0);
  
  // Thumbpad controls
  const thumbpadRef = useRef({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
  const lookpadRef = useRef({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });

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

  // Generate procedural level
  const generateLevel = useCallback(() => {
    const rooms: Room[] = [];
    const walls: Wall[] = [];
    
    // Start room
    rooms.push({ x: 0, z: 0, width: 10, depth: 10, theme: 4, connected: [1, 2, 3, 4] });
    
    // Generate connected rooms
    const directions = [
      { dx: 15, dz: 0 }, { dx: -15, dz: 0 }, { dx: 0, dz: 15 }, { dx: 0, dz: -15 },
      { dx: 20, dz: 15 }, { dx: -20, dz: 15 }, { dx: 20, dz: -15 }, { dx: -20, dz: -15 },
    ];
    
    for (let i = 0; i < 8; i++) {
      const dir = directions[i % directions.length];
      const theme = i < 4 ? i : 4; // First 4 are themed rooms, rest are hallways
      rooms.push({
        x: dir.dx + (Math.random() - 0.5) * 5,
        z: dir.dz + (Math.random() - 0.5) * 5,
        width: 8 + Math.random() * 6,
        depth: 8 + Math.random() * 6,
        theme,
        connected: [0],
      });
    }
    
    // Generate walls for each room
    rooms.forEach(room => {
      const hw = room.width / 2;
      const hd = room.depth / 2;
      walls.push({ x1: room.x - hw, z1: room.z - hd, x2: room.x + hw, z2: room.z - hd });
      walls.push({ x1: room.x + hw, z1: room.z - hd, x2: room.x + hw, z2: room.z + hd });
      walls.push({ x1: room.x + hw, z1: room.z + hd, x2: room.x - hw, z2: room.z + hd });
      walls.push({ x1: room.x - hw, z1: room.z + hd, x2: room.x - hw, z2: room.z - hd });
    });
    
    roomsRef.current = rooms;
    wallsRef.current = walls;
    
    // Spawn ammo pickups
    rooms.forEach((room, i) => {
      if (i > 0 && Math.random() > 0.3) {
        ammoPickupsRef.current.push({
          id: nextAmmoIdRef.current++,
          x: room.x + (Math.random() - 0.5) * room.width * 0.6,
          z: room.z + (Math.random() - 0.5) * room.depth * 0.6,
          collected: false,
        });
      }
    });
  }, []);

  const spawnKaren = useCallback(() => {
    const rooms = roomsRef.current;
    if (rooms.length === 0) return;
    
    // Spawn in a random room that's not the start room
    const roomIndex = 1 + Math.floor(Math.random() * (rooms.length - 1));
    const room = rooms[roomIndex];
    
    const karen: Karen = {
      id: nextKarenIdRef.current++,
      x: room.x + (Math.random() - 0.5) * room.width * 0.6,
      z: room.z + (Math.random() - 0.5) * room.depth * 0.6,
      y: 0,
      health: 100,
      variation: Math.floor(Math.random() * KAREN_VARIATIONS.length),
      speed: 0.015 + Math.random() * 0.015,
      angle: Math.random() * Math.PI * 2,
      dying: false,
      deathTime: 0,
      goreParticles: [],
    };
    karensRef.current.push(karen);
  }, []);

  const shootMeatball = useCallback(() => {
    if (ammoRef.current <= 0) return;
    
    ammoRef.current--;
    setAmmo(ammoRef.current);
    sounds.shoot();
    
    const meatball: Meatball = {
      id: nextMeatballIdRef.current++,
      x: playerRef.current.x,
      z: playerRef.current.z,
      y: 1.5,
      angle: playerRef.current.angle,
      speed: 0.6,
    };
    meatballsRef.current.push(meatball);
  }, [sounds]);

  const createGoreExplosion = (karen: Karen) => {
    const variation = KAREN_VARIATIONS[karen.variation];
    const colors = ['#8B0000', '#DC143C', '#B22222', variation.hair, variation.skin, '#FF6347'];
    
    for (let i = 0; i < 30; i++) {
      karen.goreParticles.push({
        x: karen.x,
        y: 1.5,
        z: karen.z,
        vx: (Math.random() - 0.5) * 0.3,
        vy: Math.random() * 0.4 + 0.1,
        vz: (Math.random() - 0.5) * 0.3,
        size: 0.1 + Math.random() * 0.2,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
      });
    }
  };

  const startGame = useCallback(() => {
    playerRef.current = { x: 0, z: 0, y: 0, angle: 0 };
    karensRef.current = [];
    meatballsRef.current = [];
    ammoPickupsRef.current = [];
    scoreRef.current = 0;
    healthRef.current = 100;
    ammoRef.current = 30;
    comboRef.current = 0;
    setScore(0);
    setHealth(100);
    setAmmo(30);
    setCombo(0);
    setMultiplier(1);
    
    generateLevel();
    setGameState('playing');
    sounds.startMusic('dungeon');
    
    // Spawn initial Karens
    for (let i = 0; i < 5; i++) {
      setTimeout(() => spawnKaren(), i * 500);
    }
  }, [generateLevel, spawnKaren, sounds]);

  // Draw a Karen character
  const drawKaren = (ctx: CanvasRenderingContext2D, screenX: number, screenY: number, size: number, variation: number, dying: boolean, deathProgress: number) => {
    const v = KAREN_VARIATIONS[variation];
    const scale = dying ? 1 - deathProgress * 0.5 : 1;
    const shake = dying ? Math.sin(deathProgress * 50) * 5 : 0;
    
    ctx.save();
    ctx.translate(screenX + shake, screenY);
    ctx.scale(scale, scale);
    
    if (dying) {
      // Exploding effect
      ctx.globalAlpha = 1 - deathProgress;
    }
    
    // Hair (Karen bob)
    ctx.fillStyle = v.hair;
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.3, size * 0.55, size * 0.35, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-size * 0.4, 0, size * 0.15, size * 0.4, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(size * 0.4, 0, size * 0.15, size * 0.4, -0.3, 0, Math.PI * 2);
    ctx.fill();
    
    // Face
    ctx.fillStyle = v.skin;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
    
    // Eye shadow
    ctx.fillStyle = v.eyeShadow;
    ctx.beginPath();
    ctx.ellipse(-size * 0.18, -size * 0.08, size * 0.12, size * 0.06, -0.2, 0, Math.PI * 2);
    ctx.ellipse(size * 0.18, -size * 0.08, size * 0.12, size * 0.06, 0.2, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyes (angry)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-size * 0.18, 0, size * 0.1, size * 0.08, 0, 0, Math.PI * 2);
    ctx.ellipse(size * 0.18, 0, size * 0.1, size * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(-size * 0.18, 0, size * 0.05, 0, Math.PI * 2);
    ctx.arc(size * 0.18, 0, size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    
    // Angry eyebrows
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = size * 0.04;
    ctx.beginPath();
    ctx.moveTo(-size * 0.28, -size * 0.15);
    ctx.lineTo(-size * 0.08, -size * 0.08);
    ctx.moveTo(size * 0.28, -size * 0.15);
    ctx.lineTo(size * 0.08, -size * 0.08);
    ctx.stroke();
    
    // Mouth (shouting)
    ctx.fillStyle = v.lipstick;
    ctx.beginPath();
    ctx.ellipse(0, size * 0.2, size * 0.15, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a0a0a';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.2, size * 0.1, size * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Accessory indicator
    if (v.accessory === 'sunglasses') {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(-size * 0.35, -size * 0.05, size * 0.25, size * 0.1);
      ctx.fillRect(size * 0.1, -size * 0.05, size * 0.25, size * 0.1);
      ctx.fillRect(-size * 0.1, -size * 0.02, size * 0.2, size * 0.03);
    } else if (v.accessory === 'pearls') {
      ctx.fillStyle = '#FFFAF0';
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.arc(-size * 0.25 + i * size * 0.08, size * 0.4, size * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    ctx.restore();
  };

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let spawnTimer = 0;

    const gameLoop = (timestamp: number) => {
      const deltaTime = Math.min(timestamp - lastTimeRef.current, 50);
      lastTimeRef.current = timestamp;
      
      const width = canvas.width;
      const height = canvas.height;
      
      // Clear canvas
      ctx.fillStyle = '#0a0808';
      ctx.fillRect(0, 0, width, height);
      
      // === DOOM-STYLE RAYCASTING RENDERER ===
      
      // Ceiling with ominous lighting
      const ceilGradient = ctx.createLinearGradient(0, 0, 0, height * 0.45);
      ceilGradient.addColorStop(0, '#0a0505');
      ceilGradient.addColorStop(0.5, '#1a0f0f');
      ceilGradient.addColorStop(1, '#0f0808');
      ctx.fillStyle = ceilGradient;
      ctx.fillRect(0, 0, width, height * 0.45);
      
      // Floor with blood stains
      const floorGradient = ctx.createLinearGradient(0, height * 0.55, 0, height);
      floorGradient.addColorStop(0, '#1a1010');
      floorGradient.addColorStop(0.5, '#2a1818');
      floorGradient.addColorStop(1, '#3a2020');
      ctx.fillStyle = floorGradient;
      ctx.fillRect(0, height * 0.55, width, height * 0.45);
      
      // Floor tiles with perspective
      for (let row = 0; row < 10; row++) {
        const y = height * 0.55 + row * (height * 0.05);
        const perspective = 1 - (row / 15);
        const tileWidth = 80 / perspective;
        const offsetX = ((playerRef.current.x * 20) + (playerRef.current.angle * 50)) % tileWidth;
        
        for (let i = -2; i < width / tileWidth + 2; i++) {
          const x = i * tileWidth - offsetX;
          const shade = ((Math.floor(i) + row) % 2 === 0) ? 0.08 : 0;
          ctx.fillStyle = `rgba(100, 50, 50, ${shade})`;
          ctx.fillRect(x, y, tileWidth - 2, height * 0.05 - 1);
        }
      }
      
      // Draw room walls
      roomsRef.current.forEach((room, roomIndex) => {
        const theme = ROOM_THEMES[room.theme];
        const hw = room.width / 2;
        const hd = room.depth / 2;
        
        // Calculate visibility of each wall
        const wallCorners = [
          { x: room.x - hw, z: room.z - hd },
          { x: room.x + hw, z: room.z - hd },
          { x: room.x + hw, z: room.z + hd },
          { x: room.x - hw, z: room.z + hd },
        ];
        
        wallCorners.forEach((corner, i) => {
          const nextCorner = wallCorners[(i + 1) % 4];
          const midX = (corner.x + nextCorner.x) / 2;
          const midZ = (corner.z + nextCorner.z) / 2;
          
          const relX = midX - playerRef.current.x;
          const relZ = midZ - playerRef.current.z;
          const dist = Math.sqrt(relX * relX + relZ * relZ);
          
          if (dist > 30) return;
          
          const angle = Math.atan2(relZ, relX) - playerRef.current.angle;
          const normalizedAngle = ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          
          if (Math.abs(normalizedAngle) < Math.PI / 1.5) {
            const screenX = width / 2 + Math.tan(normalizedAngle) * (width / 2);
            const wallHeight = height * 0.5 / (dist / 8);
            const wallWidth = Math.max(50, 200 / (dist / 5));
            
            const darkness = Math.max(0.15, 1 - dist / 20);
            
            // Wall with texture
            const wallGrad = ctx.createLinearGradient(screenX - wallWidth/2, 0, screenX + wallWidth/2, 0);
            const baseColor = theme.color;
            wallGrad.addColorStop(0, `rgba(${parseInt(baseColor.slice(1,3),16) * darkness}, ${parseInt(baseColor.slice(3,5),16) * darkness}, ${parseInt(baseColor.slice(5,7),16) * darkness}, 1)`);
            wallGrad.addColorStop(0.5, `rgba(${parseInt(baseColor.slice(1,3),16) * darkness * 1.2}, ${parseInt(baseColor.slice(3,5),16) * darkness * 1.2}, ${parseInt(baseColor.slice(5,7),16) * darkness * 1.2}, 1)`);
            wallGrad.addColorStop(1, `rgba(${parseInt(baseColor.slice(1,3),16) * darkness * 0.7}, ${parseInt(baseColor.slice(3,5),16) * darkness * 0.7}, ${parseInt(baseColor.slice(5,7),16) * darkness * 0.7}, 1)`);
            
            ctx.fillStyle = wallGrad;
            ctx.fillRect(screenX - wallWidth/2, height * 0.5 - wallHeight, wallWidth, wallHeight * 2);
            
            // Brick pattern
            ctx.strokeStyle = `rgba(40, 20, 20, ${darkness * 0.5})`;
            ctx.lineWidth = 1;
            const brickH = 15;
            for (let by = 0; by < wallHeight * 2 / brickH; by++) {
              const brickY = height * 0.5 - wallHeight + by * brickH;
              const offset = (by % 2) * (wallWidth / 6);
              for (let bx = 0; bx < 4; bx++) {
                ctx.strokeRect(screenX - wallWidth/2 + bx * (wallWidth/3) + offset, brickY, wallWidth/3 - 2, brickH - 1);
              }
            }
            
            // Theme decorations
            if (roomIndex > 0 && dist < 15) {
              ctx.fillStyle = `rgba(255, 255, 200, ${darkness * 0.3})`;
              ctx.font = `${Math.max(10, 30 / (dist/5))}px serif`;
              ctx.textAlign = 'center';
              ctx.fillText(theme.name.toUpperCase(), screenX, height * 0.5 - wallHeight + 30);
            }
          }
        });
      });
      
      // Player movement from thumbpad
      const moveSpeed = 0.06 * (deltaTime / 16);
      const turnSpeed = 0.03 * (deltaTime / 16);
      
      if (thumbpadRef.current.active) {
        const dx = thumbpadRef.current.currentX - thumbpadRef.current.startX;
        const dy = thumbpadRef.current.currentY - thumbpadRef.current.startY;
        const maxDist = 50;
        
        const moveX = Math.max(-1, Math.min(1, dx / maxDist));
        const moveY = Math.max(-1, Math.min(1, dy / maxDist));
        
        // Strafe with horizontal
        playerRef.current.x += Math.cos(playerRef.current.angle + Math.PI/2) * moveX * moveSpeed;
        playerRef.current.z += Math.sin(playerRef.current.angle + Math.PI/2) * moveX * moveSpeed;
        
        // Forward/back with vertical
        playerRef.current.x += Math.cos(playerRef.current.angle) * -moveY * moveSpeed;
        playerRef.current.z += Math.sin(playerRef.current.angle) * -moveY * moveSpeed;
      }
      
      if (lookpadRef.current.active) {
        const dx = lookpadRef.current.currentX - lookpadRef.current.startX;
        const maxDist = 50;
        const turn = Math.max(-1, Math.min(1, dx / maxDist));
        playerRef.current.angle += turn * turnSpeed * 2;
      }
      
      // Update meatballs
      meatballsRef.current = meatballsRef.current.filter(meatball => {
        meatball.x += Math.cos(meatball.angle) * meatball.speed * (deltaTime / 16);
        meatball.z += Math.sin(meatball.angle) * meatball.speed * (deltaTime / 16);
        
        const dist = Math.sqrt((meatball.x - playerRef.current.x) ** 2 + (meatball.z - playerRef.current.z) ** 2);
        return dist < 40;
      });
      
      // Update ammo pickups
      ammoPickupsRef.current.forEach(pickup => {
        if (pickup.collected) return;
        
        const dx = playerRef.current.x - pickup.x;
        const dz = playerRef.current.z - pickup.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < 1.5) {
          pickup.collected = true;
          ammoRef.current = Math.min(50, ammoRef.current + 10);
          setAmmo(ammoRef.current);
          sounds.pickup();
        }
      });
      
      // Update Karens
      karensRef.current = karensRef.current.filter(karen => {
        if (karen.dying) {
          karen.deathTime += deltaTime / 1000;
          
          // Update gore particles
          karen.goreParticles.forEach(p => {
            p.x += p.vx * (deltaTime / 16);
            p.y += p.vy * (deltaTime / 16);
            p.z += p.vz * (deltaTime / 16);
            p.vy -= 0.02 * (deltaTime / 16); // gravity
            p.life -= 0.02 * (deltaTime / 16);
          });
          karen.goreParticles = karen.goreParticles.filter(p => p.life > 0 && p.y > 0);
          
          return karen.deathTime < 2;
        }
        
        // Move toward player
        const dx = playerRef.current.x - karen.x;
        const dz = playerRef.current.z - karen.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist > 0.1) {
          karen.x += (dx / dist) * karen.speed * (deltaTime / 16);
          karen.z += (dz / dist) * karen.speed * (deltaTime / 16);
          karen.angle = Math.atan2(dz, dx);
        }
        
        // Check collision with player
        if (dist < 1.2) {
          healthRef.current -= 15;
          setHealth(healthRef.current);
          comboRef.current = 0;
          setCombo(0);
          setMultiplier(1);
          sounds.hurt();
          
          if (healthRef.current <= 0) {
            sounds.stopMusic();
            sounds.gameOver();
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
            
            karen.health -= 50;
            sounds.splat();
            
            if (karen.health <= 0) {
              karen.dying = true;
              karen.deathTime = 0;
              createGoreExplosion(karen);
              sounds.explosion();
              
              // Score
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
            }
            break;
          }
        }
        
        return true;
      });
      
      // Spawn Karens
      spawnTimer += deltaTime;
      if (spawnTimer > 3000) {
        spawnTimer = 0;
        spawnKaren();
      }
      
      // Draw ammo pickups
      ammoPickupsRef.current.forEach(pickup => {
        if (pickup.collected) return;
        
        const relX = pickup.x - playerRef.current.x;
        const relZ = pickup.z - playerRef.current.z;
        const dist = Math.sqrt(relX * relX + relZ * relZ);
        
        if (dist > 20) return;
        
        const angle = Math.atan2(relZ, relX) - playerRef.current.angle;
        const normalizedAngle = ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        
        if (Math.abs(normalizedAngle) < Math.PI / 2) {
          const screenX = width / 2 + Math.tan(normalizedAngle) * (width / 2);
          const scale = Math.max(0.1, 3 / dist);
          const size = 25 * scale;
          const screenY = height * 0.6 + Math.sin(timestamp / 200) * 5;
          
          // Ammo box
          ctx.fillStyle = '#4a7c59';
          ctx.fillRect(screenX - size, screenY - size/2, size * 2, size);
          ctx.fillStyle = '#5a9c69';
          ctx.fillRect(screenX - size + 2, screenY - size/2 + 2, size * 2 - 4, size - 4);
          ctx.fillStyle = '#FFD700';
          ctx.font = `${size * 0.6}px bold sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('AMMO', screenX, screenY + size * 0.2);
        }
      });
      
      // Sort Karens by distance
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
        const normalizedAngle = ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        
        if (Math.abs(normalizedAngle) > Math.PI / 2) return;
        
        const screenX = width / 2 + Math.tan(normalizedAngle) * (width / 2);
        const scale = Math.max(0.1, 4 / dist);
        const karenSize = 100 * scale;
        const screenY = height * 0.5 - karenSize * 0.1;
        
        // Draw gore particles first (behind Karen)
        karen.goreParticles.forEach(p => {
          const pRelX = p.x - playerRef.current.x;
          const pRelZ = p.z - playerRef.current.z;
          const pDist = Math.sqrt(pRelX * pRelX + pRelZ * pRelZ);
          const pAngle = Math.atan2(pRelZ, pRelX) - playerRef.current.angle;
          const pNormAngle = ((pAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          
          if (Math.abs(pNormAngle) < Math.PI / 2) {
            const pScreenX = width / 2 + Math.tan(pNormAngle) * (width / 2);
            const pScale = Math.max(0.1, 4 / pDist);
            const pSize = p.size * 80 * pScale;
            const pScreenY = height * 0.5 - p.y * 50 * pScale;
            
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(pScreenX, pScreenY, pSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        });
        
        drawKaren(ctx, screenX, screenY, karenSize, karen.variation, karen.dying, karen.deathTime);
      });
      
      // Draw meatballs
      meatballsRef.current.forEach(meatball => {
        const relX = meatball.x - playerRef.current.x;
        const relZ = meatball.z - playerRef.current.z;
        const dist = Math.sqrt(relX * relX + relZ * relZ);
        const angle = Math.atan2(relZ, relX) - playerRef.current.angle;
        const normalizedAngle = ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        
        if (Math.abs(normalizedAngle) > Math.PI / 2) return;
        
        const screenX = width / 2 + Math.tan(normalizedAngle) * (width / 2);
        const scale = Math.max(0.1, 3 / dist);
        const size = 30 * scale;
        const screenY = height * 0.5;
        
        // Realistic meatball
        const meatGrad = ctx.createRadialGradient(screenX - size * 0.3, screenY - size * 0.3, 0, screenX, screenY, size);
        meatGrad.addColorStop(0, '#a0522d');
        meatGrad.addColorStop(0.4, '#8b4513');
        meatGrad.addColorStop(0.8, '#6b3810');
        meatGrad.addColorStop(1, '#4a2508');
        ctx.fillStyle = meatGrad;
        ctx.beginPath();
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
        ctx.fill();
        
        // Sauce
        ctx.fillStyle = '#8b0000';
        ctx.beginPath();
        ctx.arc(screenX + size * 0.3, screenY + size * 0.2, size * 0.3, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Draw meatball cannon at bottom center
      const cannonX = width / 2;
      const cannonY = height - 80;
      
      ctx.save();
      ctx.translate(cannonX, cannonY);
      
      // Cannon base
      ctx.fillStyle = '#4a4a4a';
      ctx.beginPath();
      ctx.ellipse(0, 20, 60, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Cannon barrel
      const barrelGrad = ctx.createLinearGradient(-25, -60, 25, -60);
      barrelGrad.addColorStop(0, '#3a3a3a');
      barrelGrad.addColorStop(0.3, '#6a6a6a');
      barrelGrad.addColorStop(0.7, '#5a5a5a');
      barrelGrad.addColorStop(1, '#2a2a2a');
      ctx.fillStyle = barrelGrad;
      ctx.beginPath();
      ctx.moveTo(-25, 0);
      ctx.lineTo(-20, -80);
      ctx.lineTo(20, -80);
      ctx.lineTo(25, 0);
      ctx.closePath();
      ctx.fill();
      
      // Meatball in barrel
      const loadedMeatGrad = ctx.createRadialGradient(-5, -60, 0, 0, -55, 18);
      loadedMeatGrad.addColorStop(0, '#a0522d');
      loadedMeatGrad.addColorStop(1, '#5a2d10');
      ctx.fillStyle = loadedMeatGrad;
      ctx.beginPath();
      ctx.arc(0, -55, 18, 0, Math.PI * 2);
      ctx.fill();
      
      // Barrel opening
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.ellipse(0, -80, 20, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
      
      // Crosshair
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(width / 2 - 20, height / 2);
      ctx.lineTo(width / 2 - 8, height / 2);
      ctx.moveTo(width / 2 + 8, height / 2);
      ctx.lineTo(width / 2 + 20, height / 2);
      ctx.moveTo(width / 2, height / 2 - 20);
      ctx.lineTo(width / 2, height / 2 - 8);
      ctx.moveTo(width / 2, height / 2 + 8);
      ctx.lineTo(width / 2, height / 2 + 20);
      ctx.stroke();
      
      ctx.fillStyle = 'rgba(255, 50, 50, 0.8)';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 3, 0, Math.PI * 2);
      ctx.fill();
      
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };
    
    gameLoopRef.current = requestAnimationFrame(gameLoop);
    
    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameState, spawnKaren, sounds]);

  // Touch handlers for thumbpads
  const handleLeftTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    thumbpadRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
    };
  };
  
  const handleLeftTouchMove = (e: React.TouchEvent) => {
    if (!thumbpadRef.current.active) return;
    const touch = e.touches[0];
    thumbpadRef.current.currentX = touch.clientX;
    thumbpadRef.current.currentY = touch.clientY;
  };
  
  const handleLeftTouchEnd = () => {
    thumbpadRef.current.active = false;
  };
  
  const handleRightTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    lookpadRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
    };
  };
  
  const handleRightTouchMove = (e: React.TouchEvent) => {
    if (!lookpadRef.current.active) return;
    const touch = e.touches[0];
    lookpadRef.current.currentX = touch.clientX;
    lookpadRef.current.currentY = touch.clientY;
  };
  
  const handleRightTouchEnd = () => {
    lookpadRef.current.active = false;
  };

  const formatScore = (s: number) => {
    if (s >= 1000000) return `${(s / 1000000).toFixed(1)}M`;
    if (s >= 1000) return `${(s / 1000).toFixed(1)}K`;
    return s.toString();
  };

  if (gameState === 'portrait-warning') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-4 z-50">
        <RotateCcw className="w-24 h-24 text-primary animate-spin mb-6" style={{ animationDuration: '3s' }} />
        <h1 className="text-2xl font-bold text-center mb-2">Rotate Your Device</h1>
        <p className="text-muted-foreground text-center">
          Karen Dungeon 3D requires landscape mode
        </p>
        <Button variant="outline" className="mt-6" onClick={() => navigate('/games')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Games
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden touch-none">
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="absolute inset-0"
      />
      
      {/* HUD */}
      <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none z-10">
        <div className="flex flex-col gap-1">
          <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-red-900/50">
            <div className="text-xs text-red-400">SCORE</div>
            <div className="text-xl font-bold text-white">{formatScore(score)}</div>
          </div>
          {combo > 1 && (
            <div className="bg-red-900/80 backdrop-blur-sm rounded-lg px-3 py-1 animate-pulse border border-red-500">
              <span className="text-white font-bold">{combo}x COMBO! {multiplier}x</span>
            </div>
          )}
        </div>
        
        <div className="flex flex-col items-end gap-1">
          <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-red-900/50">
            <div className="text-xs text-red-400">HIGH</div>
            <div className="text-lg font-bold text-red-500">{formatScore(highScore)}</div>
          </div>
        </div>
      </div>
      
      {/* Health Bar */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-48 z-10">
        <div className="bg-black/70 backdrop-blur-sm rounded-lg p-2 border border-red-900/50">
          <div className="text-xs text-center text-red-400 mb-1">HEALTH</div>
          <div className="h-4 bg-gray-900 rounded-full overflow-hidden border border-red-900/30">
            <div 
              className="h-full bg-gradient-to-r from-red-800 to-red-500 transition-all"
              style={{ width: `${health}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* Ammo Counter */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10">
        <div className="bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 border border-amber-900/50">
          <div className="text-xs text-amber-400 text-center">MEATBALLS</div>
          <div className="text-2xl font-bold text-amber-500 text-center">{ammo}</div>
        </div>
      </div>
      
      {/* Left Thumbpad - Movement */}
      <div
        className="absolute bottom-8 left-8 z-20"
        onTouchStart={handleLeftTouchStart}
        onTouchMove={handleLeftTouchMove}
        onTouchEnd={handleLeftTouchEnd}
      >
        <div className="w-32 h-32 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center">
          <div 
            className="w-16 h-16 rounded-full bg-white/30 border border-white/50"
            style={{
              transform: thumbpadRef.current.active 
                ? `translate(${Math.max(-25, Math.min(25, thumbpadRef.current.currentX - thumbpadRef.current.startX))}px, ${Math.max(-25, Math.min(25, thumbpadRef.current.currentY - thumbpadRef.current.startY))}px)`
                : 'translate(0, 0)',
            }}
          />
        </div>
        <div className="text-white/50 text-xs text-center mt-1">MOVE</div>
      </div>
      
      {/* Right Thumbpad - Look */}
      <div
        className="absolute bottom-8 right-32 z-20"
        onTouchStart={handleRightTouchStart}
        onTouchMove={handleRightTouchMove}
        onTouchEnd={handleRightTouchEnd}
      >
        <div className="w-28 h-28 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center">
          <div 
            className="w-14 h-14 rounded-full bg-white/30 border border-white/50"
            style={{
              transform: lookpadRef.current.active 
                ? `translate(${Math.max(-20, Math.min(20, lookpadRef.current.currentX - lookpadRef.current.startX))}px, 0)`
                : 'translate(0, 0)',
            }}
          />
        </div>
        <div className="text-white/50 text-xs text-center mt-1">LOOK</div>
      </div>
      
      {/* Fire Button */}
      <button
        className="absolute bottom-12 right-4 z-20 w-24 h-24 rounded-full bg-red-600/60 border-4 border-red-500 flex items-center justify-center active:bg-red-500/80 active:scale-95 transition-transform"
        onTouchStart={shootMeatball}
        onClick={shootMeatball}
      >
        <span className="text-white text-2xl font-bold">🔥</span>
      </button>
      
      {/* Idle State */}
      {gameState === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30">
          <h1 className="text-4xl font-bold text-red-500 mb-2 drop-shadow-lg" style={{ textShadow: '0 0 20px rgba(255,0,0,0.5)' }}>
            🏰 KAREN DUNGEON 3D 💀
          </h1>
          <p className="text-lg text-gray-400 mb-6">
            10 Karen Variations • Gore Effects • Themed Rooms
          </p>
          <div className="flex gap-4">
            <Button variant="outline" onClick={() => navigate('/games')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button size="lg" onClick={startGame} className="bg-red-600 hover:bg-red-700 text-xl px-8">
              ENTER THE DUNGEON
            </Button>
          </div>
          <div className="mt-6 text-gray-500 text-sm text-center max-w-md">
            <p>Left Thumbpad: Move & Strafe</p>
            <p>Right Thumbpad: Look Around</p>
            <p>Fire Button: Launch Meatballs</p>
            <p className="mt-2 text-red-400">Find ammo pickups in themed rooms!</p>
          </div>
        </div>
      )}
      
      {/* Game Over */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-30">
          <h1 className="text-5xl font-bold text-red-600 mb-4" style={{ textShadow: '0 0 30px rgba(255,0,0,0.8)' }}>
            GAME OVER
          </h1>
          <div className="text-3xl text-white mb-2">Score: {formatScore(score)}</div>
          {score >= highScore && score > 0 && (
            <div className="text-xl text-yellow-400 mb-4">🎉 NEW HIGH SCORE!</div>
          )}
          <div className="flex gap-4 mt-4">
            <Button variant="outline" onClick={() => navigate('/games')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button onClick={startGame} className="bg-red-600 hover:bg-red-700">
              Play Again
            </Button>
            <Button variant="secondary" onClick={() => setShowShareDialog(true)}>
              Share Score
            </Button>
          </div>
        </div>
      )}
      
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
