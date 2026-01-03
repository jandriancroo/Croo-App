import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { ShareScoreDialog } from '@/components/games/ShareScoreDialog';
import { useGameSounds } from '@/hooks/useGameSounds';
import * as THREE from 'three';

// Karen insults for chat bubbles
const KAREN_INSULTS = [
  "I WANT THE MANAGER!",
  "THIS IS UNACCEPTABLE!",
  "I'LL HAVE YOU FIRED!",
  "DO YOU KNOW WHO I AM?!",
  "I'M CALLING CORPORATE!",
  "THIS IS DISCRIMINATION!",
  "MY HUSBAND IS A LAWYER!",
  "I'VE BEEN SHOPPING HERE FOR 20 YEARS!",
  "THE CUSTOMER IS ALWAYS RIGHT!",
  "I'LL LEAVE A 1-STAR REVIEW!",
  "YOU JUST LOST A CUSTOMER!",
  "I KNOW THE OWNER!",
  "WHERE'S YOUR SUPERVISOR?!",
  "I DEMAND A REFUND!",
  "THIS IS GOING ON YELP!",
];

const BOSS_INSULTS = [
  "I WILL DESTROY THIS BUSINESS!",
  "MY LAWYER IS ON SPEED DIAL!",
  "I'LL SUE EVERYONE HERE!",
  "YOU'RE ALL GETTING FIRED!",
  "I KNOW THE CEO PERSONALLY!",
  "THIS PLACE WILL BE SHUT DOWN!",
  "I'M THE HEAD OF THE HOA!",
  "MY YELP REVIEW WILL RUIN YOU!",
  "I'VE RUINED CAREERS BEFORE!",
  "PREPARE TO BE CANCELLED!",
];

// Karen variations - different hair colors and sizes
const KAREN_TYPES = [
  { hairColor: 0xFFD700, skinTone: 0xFFDDB4, size: 1.0, isBoss: false }, // Blonde
  { hairColor: 0x8B4513, skinTone: 0xE8C4A8, size: 1.0, isBoss: false }, // Brown
  { hairColor: 0xF5DEB3, skinTone: 0xFFE4C4, size: 1.0, isBoss: false }, // Platinum
  { hairColor: 0xA52A2A, skinTone: 0xDEB887, size: 1.0, isBoss: false }, // Auburn
  { hairColor: 0xD2691E, skinTone: 0xFFDAB9, size: 1.0, isBoss: false }, // Copper
  { hairColor: 0xBC8F8F, skinTone: 0xFFE4E1, size: 1.0, isBoss: false }, // Rose
  { hairColor: 0xCD853F, skinTone: 0xFAEBD7, size: 1.0, isBoss: false }, // Tan
  { hairColor: 0xDAA520, skinTone: 0xFFEBCD, size: 1.0, isBoss: false }, // Goldenrod
  { hairColor: 0x2F1810, skinTone: 0xFFE4C4, size: 1.5, isBoss: true },  // Boss 1
  { hairColor: 0x1a0a05, skinTone: 0xE8C4A8, size: 1.8, isBoss: true },  // Boss 2
];

// Room themes
const ROOM_THEMES = [
  { name: 'Tea Party', wallColor: 0xE8D5B7, floorColor: 0xD4C4A7 },
  { name: 'Kids Birthday', wallColor: 0xFFB6C1, floorColor: 0xFFE4E1 },
  { name: 'Rom-Com Couch', wallColor: 0xD8BFD8, floorColor: 0xE6E6FA },
  { name: 'HOA Meeting', wallColor: 0xF5F5DC, floorColor: 0xFFFACD },
  { name: 'Hallway', wallColor: 0x696969, floorColor: 0x505050 },
];

interface Karen {
  id: number;
  mesh: THREE.Group;
  position: THREE.Vector3;
  health: number;
  typeIndex: number;
  speed: number;
  dying: boolean;
  deathTime: number;
  insult: string;
  chatBubble: THREE.Sprite | null;
}

interface Meatball {
  id: number;
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  trail: THREE.Points;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

interface AmmoPickup {
  id: number;
  mesh: THREE.Mesh;
  collected: boolean;
}

type GameState = 'portrait-warning' | 'idle' | 'playing' | 'gameover';

export default function KarenDungeon3D() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const gameLoopRef = useRef<number>();
  const clockRef = useRef(new THREE.Clock());
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
  const playerPosRef = useRef(new THREE.Vector3(0, 1.6, 0));
  const playerRotRef = useRef(0);
  const karensRef = useRef<Karen[]>([]);
  const meatballsRef = useRef<Meatball[]>([]);
  const ammoPickupsRef = useRef<AmmoPickup[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const scoreRef = useRef(0);
  const healthRef = useRef(100);
  const ammoRef = useRef(30);
  const comboRef = useRef(0);
  const lastComboTimeRef = useRef(0);
  const nextIdRef = useRef(0);
  const spawnTimerRef = useRef(0);
  
  // Touch controls
  const thumbpadRef = useRef({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
  const lookpadRef = useRef({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
  
  // Cannon mesh ref
  const cannonRef = useRef<THREE.Group | null>(null);

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

  // Create Karen 3D model
  const createKaren = useCallback((typeIndex: number, position: THREE.Vector3): Karen => {
    const type = KAREN_TYPES[typeIndex];
    const group = new THREE.Group();
    const scale = type.size;
    
    // Body
    const bodyGeom = new THREE.CylinderGeometry(0.3 * scale, 0.4 * scale, 0.8 * scale, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: type.isBoss ? 0x2a0000 : 0xe91e63,
      roughness: 0.7,
      metalness: 0.1
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.4 * scale;
    body.castShadow = true;
    group.add(body);
    
    // Head
    const headGeom = new THREE.SphereGeometry(0.25 * scale, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ 
      color: type.skinTone,
      roughness: 0.8,
      metalness: 0
    });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.0 * scale;
    head.castShadow = true;
    group.add(head);
    
    // Karen hair - the "speak to the manager" cut
    const hairGroup = new THREE.Group();
    
    // Main hair volume
    const hairMainGeom = new THREE.SphereGeometry(0.28 * scale, 16, 12);
    hairMainGeom.scale(1, 0.7, 1);
    const hairMat = new THREE.MeshStandardMaterial({ 
      color: type.hairColor,
      roughness: 0.9,
      metalness: 0
    });
    const hairMain = new THREE.Mesh(hairMainGeom, hairMat);
    hairMain.position.y = 0.12 * scale;
    hairGroup.add(hairMain);
    
    // Spiky parts for boss Karens
    if (type.isBoss) {
      for (let i = 0; i < 6; i++) {
        const spikeGeom = new THREE.ConeGeometry(0.08 * scale, 0.25 * scale, 4);
        const spike = new THREE.Mesh(spikeGeom, hairMat);
        const angle = (i / 6) * Math.PI * 2;
        spike.position.set(
          Math.cos(angle) * 0.2 * scale,
          0.2 * scale,
          Math.sin(angle) * 0.2 * scale
        );
        spike.rotation.x = Math.cos(angle) * 0.5;
        spike.rotation.z = -Math.sin(angle) * 0.5;
        hairGroup.add(spike);
      }
    }
    
    hairGroup.position.y = 1.0 * scale;
    group.add(hairGroup);
    
    // Eyes - angry expression
    const eyeGeom = new THREE.SphereGeometry(0.04 * scale, 8, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
    
    [-0.08, 0.08].forEach(offsetX => {
      const eye = new THREE.Mesh(eyeGeom, eyeMat);
      eye.position.set(offsetX * scale, 1.02 * scale, 0.2 * scale);
      group.add(eye);
      
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.02 * scale, 6, 6),
        pupilMat
      );
      pupil.position.set(offsetX * scale, 1.02 * scale, 0.23 * scale);
      group.add(pupil);
    });
    
    // Angry eyebrows
    const browGeom = new THREE.BoxGeometry(0.08 * scale, 0.02 * scale, 0.02 * scale);
    const browMat = new THREE.MeshStandardMaterial({ color: type.hairColor });
    [-0.08, 0.08].forEach((offsetX, i) => {
      const brow = new THREE.Mesh(browGeom, browMat);
      brow.position.set(offsetX * scale, 1.08 * scale, 0.2 * scale);
      brow.rotation.z = (i === 0 ? 0.3 : -0.3);
      group.add(brow);
    });
    
    // Mouth - shouting
    const mouthGeom = new THREE.TorusGeometry(0.06 * scale, 0.02 * scale, 8, 12, Math.PI);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x8b0000 });
    const mouth = new THREE.Mesh(mouthGeom, mouthMat);
    mouth.position.set(0, 0.92 * scale, 0.22 * scale);
    mouth.rotation.x = Math.PI / 2;
    mouth.rotation.z = Math.PI;
    group.add(mouth);
    
    // Sharp teeth for bosses
    if (type.isBoss) {
      for (let i = 0; i < 4; i++) {
        const toothGeom = new THREE.ConeGeometry(0.015 * scale, 0.04 * scale, 4);
        const toothMat = new THREE.MeshStandardMaterial({ color: 0xffffee });
        const tooth = new THREE.Mesh(toothGeom, toothMat);
        tooth.position.set((i - 1.5) * 0.03 * scale, 0.9 * scale, 0.23 * scale);
        tooth.rotation.x = Math.PI;
        group.add(tooth);
      }
    }
    
    // Arms (crossed, angry pose)
    const armGeom = new THREE.CylinderGeometry(0.06 * scale, 0.06 * scale, 0.4 * scale, 8);
    const armMat = new THREE.MeshStandardMaterial({ color: type.skinTone });
    
    const leftArm = new THREE.Mesh(armGeom, armMat);
    leftArm.position.set(-0.35 * scale, 0.5 * scale, 0.1 * scale);
    leftArm.rotation.z = -Math.PI / 3;
    leftArm.rotation.x = Math.PI / 6;
    leftArm.castShadow = true;
    group.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeom, armMat);
    rightArm.position.set(0.35 * scale, 0.5 * scale, 0.1 * scale);
    rightArm.rotation.z = Math.PI / 3;
    rightArm.rotation.x = Math.PI / 6;
    rightArm.castShadow = true;
    group.add(rightArm);
    
    group.position.copy(position);
    
    // Create chat bubble sprite
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    
    const insult = type.isBoss 
      ? BOSS_INSULTS[Math.floor(Math.random() * BOSS_INSULTS.length)]
      : KAREN_INSULTS[Math.floor(Math.random() * KAREN_INSULTS.length)];
    
    // Draw bubble background
    ctx.fillStyle = type.isBoss ? '#ff0000' : '#ffffff';
    ctx.strokeStyle = type.isBoss ? '#aa0000' : '#333333';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(10, 10, 492, 90, 20);
    ctx.fill();
    ctx.stroke();
    
    // Draw pointer
    ctx.beginPath();
    ctx.moveTo(230, 100);
    ctx.lineTo(256, 120);
    ctx.lineTo(282, 100);
    ctx.fill();
    
    // Draw text
    ctx.fillStyle = type.isBoss ? '#ffffff' : '#000000';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Word wrap
    const words = insult.split(' ');
    let line = '';
    let lines: string[] = [];
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > 470) {
        lines.push(line.trim());
        line = word + ' ';
      } else {
        line = test;
      }
    }
    lines.push(line.trim());
    
    lines.forEach((l, i) => {
      ctx.fillText(l, 256, 40 + i * 28);
    });
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ 
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2 * scale, 0.5 * scale, 1);
    sprite.position.y = 1.6 * scale;
    group.add(sprite);
    
    return {
      id: nextIdRef.current++,
      mesh: group,
      position: position.clone(),
      health: type.isBoss ? 200 : 100,
      typeIndex,
      speed: type.isBoss ? 1.5 : 2 + Math.random(),
      dying: false,
      deathTime: 0,
      insult,
      chatBubble: sprite,
    };
  }, []);

  // Create meatball
  const createMeatball = useCallback((scene: THREE.Scene, pos: THREE.Vector3, dir: THREE.Vector3): Meatball => {
    const geometry = new THREE.SphereGeometry(0.15, 16, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.6,
      metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    scene.add(mesh);
    
    // Trail particles
    const trailGeom = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(30 * 3);
    trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.PointsMaterial({ color: 0xcc0000, size: 0.05, transparent: true, opacity: 0.6 });
    const trail = new THREE.Points(trailGeom, trailMat);
    scene.add(trail);
    
    return {
      id: nextIdRef.current++,
      mesh,
      velocity: dir.clone().multiplyScalar(20),
      trail,
    };
  }, []);

  // Create gore explosion
  const createGoreExplosion = useCallback((scene: THREE.Scene, position: THREE.Vector3, type: typeof KAREN_TYPES[0]) => {
    const colors = [0x8b0000, 0xdc143c, 0xb22222, type.hairColor, type.skinTone, 0xff6347];
    
    for (let i = 0; i < 40; i++) {
      const geom = new THREE.SphereGeometry(0.05 + Math.random() * 0.1, 6, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        roughness: 0.9,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(position);
      mesh.position.y += 1;
      mesh.castShadow = true;
      scene.add(mesh);
      
      particlesRef.current.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          Math.random() * 6 + 2,
          (Math.random() - 0.5) * 8
        ),
        life: 2,
      });
    }
    
    // Muzzle flash / explosion light
    const light = new THREE.PointLight(0xff4400, 5, 5);
    light.position.copy(position);
    light.position.y += 1;
    scene.add(light);
    
    setTimeout(() => scene.remove(light), 100);
  }, []);

  // Initialize Three.js scene
  const initScene = useCallback(() => {
    if (!containerRef.current) return;
    
    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0808);
    scene.fog = new THREE.FogExp2(0x1a0a0a, 0.05);
    sceneRef.current = scene;
    
    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    cameraRef.current = camera;
    
    // Renderer with post-processing support
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap for mobile performance
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    // Ambient light
    const ambient = new THREE.AmbientLight(0x331111, 0.4);
    scene.add(ambient);
    
    // Main directional light (like a torch)
    const dirLight = new THREE.DirectionalLight(0xff6644, 1.2);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    scene.add(dirLight);
    
    // Player flashlight
    const flashlight = new THREE.SpotLight(0xffffcc, 2, 30, Math.PI / 4, 0.5, 1);
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera);
    
    // Floor
    const floorGeom = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2a1818,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Generate dungeon rooms
    const rooms = [
      { x: 0, z: 0, width: 12, depth: 12, theme: 4 }, // Start room
      { x: 18, z: 0, width: 10, depth: 10, theme: 0 },
      { x: -18, z: 0, width: 10, depth: 10, theme: 1 },
      { x: 0, z: 18, width: 10, depth: 10, theme: 2 },
      { x: 0, z: -18, width: 10, depth: 10, theme: 3 },
      { x: 20, z: 18, width: 8, depth: 8, theme: 0 },
      { x: -20, z: 18, width: 8, depth: 8, theme: 1 },
      { x: 20, z: -18, width: 8, depth: 8, theme: 2 },
      { x: -20, z: -18, width: 8, depth: 8, theme: 3 },
    ];
    
    rooms.forEach(room => {
      const theme = ROOM_THEMES[room.theme];
      const wallHeight = 4;
      const wallThickness = 0.3;
      
      // Wall material
      const wallMat = new THREE.MeshStandardMaterial({
        color: theme.wallColor,
        roughness: 0.85,
        metalness: 0.05,
      });
      
      // Create walls
      const createWall = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
        const geom = new THREE.BoxGeometry(width, height, depth);
        const mesh = new THREE.Mesh(geom, wallMat);
        mesh.position.set(room.x + x, y, room.z + z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      };
      
      // North wall
      createWall(room.width, wallHeight, wallThickness, 0, wallHeight / 2, -room.depth / 2);
      // South wall  
      createWall(room.width, wallHeight, wallThickness, 0, wallHeight / 2, room.depth / 2);
      // East wall
      createWall(wallThickness, wallHeight, room.depth, room.width / 2, wallHeight / 2, 0);
      // West wall
      createWall(wallThickness, wallHeight, room.depth, -room.width / 2, wallHeight / 2, 0);
      
      // Ceiling
      const ceilGeom = new THREE.PlaneGeometry(room.width, room.depth);
      const ceilMat = new THREE.MeshStandardMaterial({ color: 0x1a0a0a, roughness: 0.95 });
      const ceiling = new THREE.Mesh(ceilGeom, ceilMat);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set(room.x, wallHeight, room.z);
      ceiling.receiveShadow = true;
      scene.add(ceiling);
      
      // Room floor (different color per theme)
      const roomFloorGeom = new THREE.PlaneGeometry(room.width - 0.2, room.depth - 0.2);
      const roomFloorMat = new THREE.MeshStandardMaterial({
        color: theme.floorColor,
        roughness: 0.8,
        metalness: 0.1,
      });
      const roomFloor = new THREE.Mesh(roomFloorGeom, roomFloorMat);
      roomFloor.rotation.x = -Math.PI / 2;
      roomFloor.position.set(room.x, 0.01, room.z);
      roomFloor.receiveShadow = true;
      scene.add(roomFloor);
      
      // Torches for lighting
      const torchPositions = [
        [room.width / 2 - 0.5, 2.5, room.depth / 2 - 0.5],
        [-room.width / 2 + 0.5, 2.5, room.depth / 2 - 0.5],
        [room.width / 2 - 0.5, 2.5, -room.depth / 2 + 0.5],
        [-room.width / 2 + 0.5, 2.5, -room.depth / 2 + 0.5],
      ];
      
      torchPositions.forEach(([x, y, z]) => {
        const torchLight = new THREE.PointLight(0xff6600, 1.5, 8);
        torchLight.position.set(room.x + x, y, room.z + z);
        scene.add(torchLight);
        
        // Torch mesh
        const torchGeom = new THREE.CylinderGeometry(0.05, 0.08, 0.4, 6);
        const torchMat = new THREE.MeshStandardMaterial({ color: 0x4a3020 });
        const torch = new THREE.Mesh(torchGeom, torchMat);
        torch.position.set(room.x + x, y - 0.2, room.z + z);
        scene.add(torch);
        
        // Flame (billboard sprite or just a small bright sphere)
        const flameGeom = new THREE.SphereGeometry(0.1, 8, 8);
        const flameMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
        const flame = new THREE.Mesh(flameGeom, flameMat);
        flame.position.set(room.x + x, y + 0.1, room.z + z);
        scene.add(flame);
      });
      
      // Spawn ammo in rooms
      if (room.theme !== 4 && Math.random() > 0.3) {
        const ammoGeom = new THREE.BoxGeometry(0.4, 0.3, 0.4);
        const ammoMat = new THREE.MeshStandardMaterial({ color: 0x4a7c59 });
        const ammoMesh = new THREE.Mesh(ammoGeom, ammoMat);
        ammoMesh.position.set(
          room.x + (Math.random() - 0.5) * room.width * 0.5,
          0.15,
          room.z + (Math.random() - 0.5) * room.depth * 0.5
        );
        ammoMesh.castShadow = true;
        scene.add(ammoMesh);
        
        ammoPickupsRef.current.push({
          id: nextIdRef.current++,
          mesh: ammoMesh,
          collected: false,
        });
      }
    });
    
    // Create meatball cannon (attached to camera)
    const cannonGroup = new THREE.Group();
    
    // Cannon barrel
    const barrelGeom = new THREE.CylinderGeometry(0.08, 0.12, 0.5, 12);
    const barrelMat = new THREE.MeshStandardMaterial({ 
      color: 0x3a3a3a, 
      roughness: 0.3, 
      metalness: 0.8 
    });
    const barrel = new THREE.Mesh(barrelGeom, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.3;
    cannonGroup.add(barrel);
    
    // Cannon base
    const baseGeom = new THREE.BoxGeometry(0.2, 0.15, 0.2);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7 });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.set(0, -0.1, 0);
    cannonGroup.add(base);
    
    // Meatball in cannon
    const loadedMeatGeom = new THREE.SphereGeometry(0.06, 12, 12);
    const loadedMeatMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const loadedMeat = new THREE.Mesh(loadedMeatGeom, loadedMeatMat);
    loadedMeat.position.z = -0.4;
    cannonGroup.add(loadedMeat);
    
    cannonGroup.position.set(0.25, -0.2, -0.5);
    cannonGroup.rotation.x = 0.1;
    camera.add(cannonGroup);
    cannonRef.current = cannonGroup;
    
    // Spawn initial Karens
    const spawnPositions = [
      new THREE.Vector3(15, 0, 0),
      new THREE.Vector3(-15, 0, 0),
      new THREE.Vector3(0, 0, 15),
      new THREE.Vector3(0, 0, -15),
      new THREE.Vector3(18, 0, 15),
    ];
    
    spawnPositions.forEach(pos => {
      const typeIndex = Math.floor(Math.random() * 8); // Regular Karens only at start
      const karen = createKaren(typeIndex, pos);
      scene.add(karen.mesh);
      karensRef.current.push(karen);
    });
    
    return () => {
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [createKaren]);

  // Start game
  const startGame = useCallback(() => {
    playerPosRef.current.set(0, 1.6, 0);
    playerRotRef.current = 0;
    scoreRef.current = 0;
    healthRef.current = 100;
    ammoRef.current = 30;
    comboRef.current = 0;
    setScore(0);
    setHealth(100);
    setAmmo(30);
    setCombo(0);
    setMultiplier(1);
    
    // Clear existing entities
    karensRef.current.forEach(k => sceneRef.current?.remove(k.mesh));
    karensRef.current = [];
    meatballsRef.current.forEach(m => {
      sceneRef.current?.remove(m.mesh);
      sceneRef.current?.remove(m.trail);
    });
    meatballsRef.current = [];
    particlesRef.current.forEach(p => sceneRef.current?.remove(p.mesh));
    particlesRef.current = [];
    
    // Reset ammo pickups
    ammoPickupsRef.current.forEach(a => a.collected = false);
    
    // Spawn fresh Karens
    if (sceneRef.current) {
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const dist = 12 + Math.random() * 8;
        const pos = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
        const typeIndex = Math.floor(Math.random() * 8);
        const karen = createKaren(typeIndex, pos);
        sceneRef.current.add(karen.mesh);
        karensRef.current.push(karen);
      }
    }
    
    clockRef.current.start();
    setGameState('playing');
    sounds.startMusic('dungeon');
  }, [createKaren, sounds]);

  // Shoot meatball
  const shootMeatball = useCallback(() => {
    if (ammoRef.current <= 0 || !sceneRef.current || !cameraRef.current) return;
    
    ammoRef.current--;
    setAmmo(ammoRef.current);
    sounds.shoot();
    
    // Cannon recoil animation
    if (cannonRef.current) {
      cannonRef.current.position.z = -0.3;
      setTimeout(() => {
        if (cannonRef.current) cannonRef.current.position.z = -0.5;
      }, 100);
    }
    
    // Create meatball
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(cameraRef.current.quaternion);
    
    const meatball = createMeatball(
      sceneRef.current,
      playerPosRef.current.clone().add(dir.clone().multiplyScalar(0.8)),
      dir
    );
    meatballsRef.current.push(meatball);
    
    // Muzzle flash
    const flash = new THREE.PointLight(0xff8800, 3, 3);
    flash.position.copy(playerPosRef.current);
    sceneRef.current.add(flash);
    setTimeout(() => sceneRef.current?.remove(flash), 50);
  }, [sounds, createMeatball]);

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing' && gameState !== 'idle') return;
    
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    
    if (!scene || !camera || !renderer) {
      if (gameState === 'idle' || gameState === 'playing') {
        initScene();
      }
      return;
    }
    
    let animationId: number;
    
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      
      const delta = Math.min(clockRef.current.getDelta(), 0.05);
      
      if (gameState !== 'playing') {
        renderer.render(scene, camera);
        return;
      }
      
      // Player movement from thumbpad
      const moveSpeed = 5 * delta;
      const turnSpeed = 2 * delta;
      
      if (thumbpadRef.current.active) {
        const dx = thumbpadRef.current.currentX - thumbpadRef.current.startX;
        const dy = thumbpadRef.current.currentY - thumbpadRef.current.startY;
        const maxDist = 50;
        
        const moveX = Math.max(-1, Math.min(1, dx / maxDist));
        const moveY = Math.max(-1, Math.min(1, dy / maxDist));
        
        // Forward/backward
        playerPosRef.current.x += Math.sin(playerRotRef.current) * -moveY * moveSpeed;
        playerPosRef.current.z += Math.cos(playerRotRef.current) * -moveY * moveSpeed;
        
        // Strafe
        playerPosRef.current.x += Math.sin(playerRotRef.current + Math.PI / 2) * moveX * moveSpeed;
        playerPosRef.current.z += Math.cos(playerRotRef.current + Math.PI / 2) * moveX * moveSpeed;
      }
      
      if (lookpadRef.current.active) {
        const dx = lookpadRef.current.currentX - lookpadRef.current.startX;
        const maxDist = 50;
        const turn = Math.max(-1, Math.min(1, dx / maxDist));
        playerRotRef.current -= turn * turnSpeed;
      }
      
      // Update camera
      camera.position.copy(playerPosRef.current);
      camera.rotation.y = playerRotRef.current;
      
      // Update meatballs
      meatballsRef.current = meatballsRef.current.filter(mb => {
        mb.mesh.position.add(mb.velocity.clone().multiplyScalar(delta));
        
        // Check if out of range
        const dist = mb.mesh.position.distanceTo(playerPosRef.current);
        if (dist > 50) {
          scene.remove(mb.mesh);
          scene.remove(mb.trail);
          return false;
        }
        
        // Check collision with Karens
        for (const karen of karensRef.current) {
          if (karen.dying) continue;
          
          const karenDist = mb.mesh.position.distanceTo(karen.position);
          if (karenDist < 1) {
            karen.health -= 60;
            sounds.splat();
            
            if (karen.health <= 0) {
              karen.dying = true;
              karen.deathTime = 0;
              createGoreExplosion(scene, karen.position, KAREN_TYPES[karen.typeIndex]);
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
              
              const basePoints = KAREN_TYPES[karen.typeIndex].isBoss ? 500 : 100;
              scoreRef.current += basePoints * newMultiplier;
              setScore(scoreRef.current);
            }
            
            scene.remove(mb.mesh);
            scene.remove(mb.trail);
            return false;
          }
        }
        
        return true;
      });
      
      // Update particles
      particlesRef.current = particlesRef.current.filter(p => {
        p.mesh.position.add(p.velocity.clone().multiplyScalar(delta));
        p.velocity.y -= 9.8 * delta;
        p.life -= delta;
        
        if (p.life <= 0 || p.mesh.position.y < 0) {
          scene.remove(p.mesh);
          return false;
        }
        
        p.mesh.scale.setScalar(p.life);
        return true;
      });
      
      // Update Karens
      karensRef.current = karensRef.current.filter(karen => {
        if (karen.dying) {
          karen.deathTime += delta;
          karen.mesh.scale.setScalar(1 - karen.deathTime * 0.5);
          karen.mesh.rotation.y += delta * 10;
          
          if (karen.deathTime > 1.5) {
            scene.remove(karen.mesh);
            return false;
          }
          return true;
        }
        
        // Move toward player
        const dir = new THREE.Vector3()
          .subVectors(playerPosRef.current, karen.position)
          .normalize();
        
        karen.position.add(dir.multiplyScalar(karen.speed * delta));
        karen.mesh.position.copy(karen.position);
        karen.mesh.lookAt(playerPosRef.current.x, karen.position.y, playerPosRef.current.z);
        
        // Bobbing animation
        karen.mesh.position.y = Math.sin(Date.now() * 0.005 + karen.id) * 0.1;
        
        // Chat bubble always faces camera
        if (karen.chatBubble) {
          karen.chatBubble.quaternion.copy(camera.quaternion);
        }
        
        // Check collision with player
        const playerDist = karen.position.distanceTo(playerPosRef.current);
        if (playerDist < 1.2) {
          healthRef.current -= 20;
          setHealth(healthRef.current);
          comboRef.current = 0;
          setCombo(0);
          setMultiplier(1);
          sounds.hurt();
          
          // Knockback Karen
          karen.position.add(dir.multiplyScalar(-3));
          
          if (healthRef.current <= 0) {
            sounds.stopMusic();
            sounds.gameOver();
            setGameState('gameover');
            saveScore(scoreRef.current);
          }
        }
        
        return true;
      });
      
      // Check ammo pickups
      ammoPickupsRef.current.forEach(pickup => {
        if (pickup.collected) return;
        
        const dist = pickup.mesh.position.distanceTo(playerPosRef.current);
        if (dist < 1.5) {
          pickup.collected = true;
          pickup.mesh.visible = false;
          ammoRef.current = Math.min(50, ammoRef.current + 10);
          setAmmo(ammoRef.current);
          sounds.pickup();
        }
        
        // Floating animation
        pickup.mesh.position.y = 0.15 + Math.sin(Date.now() * 0.003) * 0.05;
        pickup.mesh.rotation.y += delta;
      });
      
      // Spawn more Karens
      spawnTimerRef.current += delta;
      if (spawnTimerRef.current > 3) {
        spawnTimerRef.current = 0;
        
        const angle = Math.random() * Math.PI * 2;
        const dist = 15 + Math.random() * 10;
        const pos = new THREE.Vector3(
          playerPosRef.current.x + Math.cos(angle) * dist,
          0,
          playerPosRef.current.z + Math.sin(angle) * dist
        );
        
        // Chance for boss Karen
        const typeIndex = Math.random() < 0.1 
          ? 8 + Math.floor(Math.random() * 2) 
          : Math.floor(Math.random() * 8);
        
        const karen = createKaren(typeIndex, pos);
        scene.add(karen.mesh);
        karensRef.current.push(karen);
      }
      
      renderer.render(scene, camera);
    };
    
    animate();
    
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [gameState, initScene, sounds, createKaren, createGoreExplosion, saveScore]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Touch handlers
  const handleLeftTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
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
    e.preventDefault();
    if (!thumbpadRef.current.active) return;
    const touch = e.touches[0];
    thumbpadRef.current.currentX = touch.clientX;
    thumbpadRef.current.currentY = touch.clientY;
  };
  
  const handleLeftTouchEnd = () => {
    thumbpadRef.current.active = false;
  };
  
  const handleRightTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
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
    e.preventDefault();
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
      <div ref={containerRef} className="absolute inset-0" />
      
      {/* HUD */}
      <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none z-10">
        <div className="flex flex-col gap-1">
          <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-red-900/50">
            <div className="text-xs text-red-400">SCORE</div>
            <div className="text-xl font-bold text-white">{formatScore(score)}</div>
          </div>
          {combo > 1 && (
            <div className="bg-orange-900/80 backdrop-blur-sm rounded-lg px-3 py-1 border border-orange-500/50">
              <div className="text-sm font-bold text-orange-300">
                {combo}x COMBO! ({multiplier}x)
              </div>
            </div>
          )}
        </div>
        
        <div className="flex flex-col gap-1 items-end">
          {/* Health bar */}
          <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-red-900/50 w-32">
            <div className="text-xs text-red-400 mb-1">HEALTH</div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-300"
                style={{ width: `${health}%` }}
              />
            </div>
          </div>
          
          {/* Ammo */}
          <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-amber-900/50">
            <div className="text-xs text-amber-400">AMMO</div>
            <div className="text-xl font-bold text-amber-300">{ammo}</div>
          </div>
        </div>
      </div>
      
      {/* Crosshair */}
      {gameState === 'playing' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="relative">
            <div className="absolute w-6 h-0.5 bg-red-500/80 -left-8 top-1/2 -translate-y-1/2" />
            <div className="absolute w-6 h-0.5 bg-red-500/80 left-2 top-1/2 -translate-y-1/2" />
            <div className="absolute w-0.5 h-6 bg-red-500/80 left-1/2 -top-8 -translate-x-1/2" />
            <div className="absolute w-0.5 h-6 bg-red-500/80 left-1/2 top-2 -translate-x-1/2" />
            <div className="w-2 h-2 bg-red-500/80 rounded-full" />
          </div>
        </div>
      )}
      
      {/* Touch Controls */}
      {gameState === 'playing' && (
        <>
          {/* Left thumbpad - movement */}
          <div
            className="absolute left-4 bottom-4 w-32 h-32 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center z-20"
            onTouchStart={handleLeftTouchStart}
            onTouchMove={handleLeftTouchMove}
            onTouchEnd={handleLeftTouchEnd}
          >
            <div className="w-16 h-16 rounded-full bg-white/20 border border-white/40 flex items-center justify-center">
              <span className="text-white/60 text-xs">MOVE</span>
            </div>
          </div>
          
          {/* Right thumbpad - look */}
          <div
            className="absolute right-36 bottom-4 w-32 h-32 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center z-20"
            onTouchStart={handleRightTouchStart}
            onTouchMove={handleRightTouchMove}
            onTouchEnd={handleRightTouchEnd}
          >
            <div className="w-16 h-16 rounded-full bg-white/20 border border-white/40 flex items-center justify-center">
              <span className="text-white/60 text-xs">LOOK</span>
            </div>
          </div>
          
          {/* Fire button */}
          <button
            className="absolute right-4 bottom-4 w-28 h-28 rounded-full bg-red-600/80 border-4 border-red-400 flex items-center justify-center z-20 active:scale-95 active:bg-red-500"
            onTouchStart={(e) => { e.preventDefault(); shootMeatball(); }}
          >
            <span className="text-white font-bold text-lg">FIRE</span>
          </button>
        </>
      )}
      
      {/* Start/Game Over Overlay */}
      {(gameState === 'idle' || gameState === 'gameover') && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-30">
          <h1 className="text-4xl font-bold text-red-500 mb-2" style={{ textShadow: '0 0 20px #ff0000' }}>
            KAREN DUNGEON 3D
          </h1>
          
          {gameState === 'gameover' && (
            <div className="text-center mb-4">
              <p className="text-2xl text-white mb-2">GAME OVER</p>
              <p className="text-xl text-amber-400">Score: {formatScore(score)}</p>
              {score > highScore && score > 0 && (
                <p className="text-lg text-green-400">NEW HIGH SCORE!</p>
              )}
            </div>
          )}
          
          <div className="flex gap-4">
            <Button
              onClick={startGame}
              className="bg-red-600 hover:bg-red-500 text-white px-8 py-6 text-xl"
            >
              {gameState === 'gameover' ? 'PLAY AGAIN' : 'START GAME'}
            </Button>
            
            <Button
              variant="outline"
              onClick={() => navigate('/games')}
              className="border-red-600 text-red-400 px-6 py-6"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              EXIT
            </Button>
          </div>
          
          {highScore > 0 && (
            <p className="text-muted-foreground mt-4">High Score: {formatScore(highScore)}</p>
          )}
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
