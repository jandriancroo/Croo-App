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
  { hairColor: 0xFFD700, skinTone: 0xFFDDB4, size: 1.0, isBoss: false, outfit: 0xE91E63 }, // Blonde
  { hairColor: 0x8B4513, skinTone: 0xE8C4A8, size: 1.0, isBoss: false, outfit: 0x9C27B0 }, // Brown
  { hairColor: 0xF5DEB3, skinTone: 0xFFE4C4, size: 1.0, isBoss: false, outfit: 0x2196F3 }, // Platinum
  { hairColor: 0xA52A2A, skinTone: 0xDEB887, size: 1.0, isBoss: false, outfit: 0x4CAF50 }, // Auburn
  { hairColor: 0xD2691E, skinTone: 0xFFDAB9, size: 1.0, isBoss: false, outfit: 0xFF5722 }, // Copper
  { hairColor: 0xBC8F8F, skinTone: 0xFFE4E1, size: 1.0, isBoss: false, outfit: 0x795548 }, // Rose
  { hairColor: 0xCD853F, skinTone: 0xFAEBD7, size: 1.0, isBoss: false, outfit: 0x00BCD4 }, // Tan
  { hairColor: 0xDAA520, skinTone: 0xFFEBCD, size: 1.0, isBoss: false, outfit: 0xFF4081 }, // Goldenrod
  { hairColor: 0x2F1810, skinTone: 0xFFE4C4, size: 1.5, isBoss: true, outfit: 0x1a0000 },  // Boss 1
  { hairColor: 0x1a0a05, skinTone: 0xE8C4A8, size: 1.8, isBoss: true, outfit: 0x330000 },  // Boss 2
];

// Room themes with enhanced detail
const ROOM_THEMES = [
  { name: 'Tea Party', wallColor: 0xE8D5B7, floorColor: 0xD4C4A7, accent: 0xFFD700 },
  { name: 'Kids Birthday', wallColor: 0xFFB6C1, floorColor: 0xFFE4E1, accent: 0xFF69B4 },
  { name: 'Rom-Com Couch', wallColor: 0xD8BFD8, floorColor: 0xE6E6FA, accent: 0xDA70D6 },
  { name: 'HOA Meeting', wallColor: 0xF5F5DC, floorColor: 0xFFFACD, accent: 0x8B4513 },
  { name: 'Hallway', wallColor: 0x696969, floorColor: 0x505050, accent: 0x8B0000 },
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
  animPhase: number;
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
  rotationSpeed: THREE.Vector3;
}

interface AmmoPickup {
  id: number;
  mesh: THREE.Group;
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
  
  // Screen shake ref
  const screenShakeRef = useRef({ intensity: 0, duration: 0 });
  
  // Muzzle flash particles ref
  const muzzleFlashRef = useRef<THREE.PointLight | null>(null);

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

  // Create high-poly Karen 3D model with full body
  const createKaren = useCallback((typeIndex: number, position: THREE.Vector3): Karen => {
    const type = KAREN_TYPES[typeIndex];
    const group = new THREE.Group();
    const scale = type.size;
    
    // Skin material with subsurface scattering simulation
    const skinMat = new THREE.MeshStandardMaterial({ 
      color: type.skinTone,
      roughness: 0.6,
      metalness: 0,
    });
    
    // Hair material
    const hairMat = new THREE.MeshStandardMaterial({ 
      color: type.hairColor,
      roughness: 0.8,
      metalness: 0.1
    });
    
    // Outfit material
    const outfitMat = new THREE.MeshStandardMaterial({ 
      color: type.outfit,
      roughness: 0.5,
      metalness: 0.1
    });

    // === LEGS ===
    const legHeight = 0.6 * scale;
    const legRadius = 0.08 * scale;
    const legGeom = new THREE.CylinderGeometry(legRadius, legRadius * 0.8, legHeight, 16);
    
    // Left leg
    const leftLeg = new THREE.Mesh(legGeom, outfitMat);
    leftLeg.position.set(-0.12 * scale, legHeight / 2, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);
    
    // Right leg
    const rightLeg = new THREE.Mesh(legGeom, outfitMat);
    rightLeg.position.set(0.12 * scale, legHeight / 2, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);
    
    // Shoes
    const shoeGeom = new THREE.BoxGeometry(0.1 * scale, 0.06 * scale, 0.15 * scale);
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
    const leftShoe = new THREE.Mesh(shoeGeom, shoeMat);
    leftShoe.position.set(-0.12 * scale, 0.03 * scale, 0.02 * scale);
    group.add(leftShoe);
    const rightShoe = new THREE.Mesh(shoeGeom, shoeMat);
    rightShoe.position.set(0.12 * scale, 0.03 * scale, 0.02 * scale);
    group.add(rightShoe);
    
    // === TORSO ===
    // Lower body / skirt
    const skirtGeom = new THREE.CylinderGeometry(0.18 * scale, 0.25 * scale, 0.3 * scale, 24);
    const skirt = new THREE.Mesh(skirtGeom, outfitMat);
    skirt.position.y = legHeight + 0.15 * scale;
    skirt.castShadow = true;
    group.add(skirt);
    
    // Upper body
    const torsoGeom = new THREE.CylinderGeometry(0.2 * scale, 0.18 * scale, 0.4 * scale, 24);
    const torso = new THREE.Mesh(torsoGeom, outfitMat);
    torso.position.y = legHeight + 0.5 * scale;
    torso.castShadow = true;
    group.add(torso);
    
    // Shoulders
    const shoulderGeom = new THREE.SphereGeometry(0.08 * scale, 16, 12);
    const leftShoulder = new THREE.Mesh(shoulderGeom, outfitMat);
    leftShoulder.position.set(-0.22 * scale, legHeight + 0.65 * scale, 0);
    group.add(leftShoulder);
    const rightShoulder = new THREE.Mesh(shoulderGeom, outfitMat);
    rightShoulder.position.set(0.22 * scale, legHeight + 0.65 * scale, 0);
    group.add(rightShoulder);
    
    // === ARMS ===
    const armGeom = new THREE.CylinderGeometry(0.05 * scale, 0.04 * scale, 0.35 * scale, 12);
    const forearmGeom = new THREE.CylinderGeometry(0.04 * scale, 0.035 * scale, 0.3 * scale, 12);
    
    // Left arm (pointing/accusing pose)
    const leftUpperArm = new THREE.Mesh(armGeom, skinMat);
    leftUpperArm.position.set(-0.28 * scale, legHeight + 0.5 * scale, 0.05 * scale);
    leftUpperArm.rotation.z = -Math.PI / 4;
    leftUpperArm.rotation.x = Math.PI / 6;
    leftUpperArm.castShadow = true;
    group.add(leftUpperArm);
    
    const leftForearm = new THREE.Mesh(forearmGeom, skinMat);
    leftForearm.position.set(-0.4 * scale, legHeight + 0.35 * scale, 0.15 * scale);
    leftForearm.rotation.z = -Math.PI / 3;
    leftForearm.rotation.x = Math.PI / 4;
    leftForearm.castShadow = true;
    group.add(leftForearm);
    
    // Left hand (pointing finger)
    const handGeom = new THREE.SphereGeometry(0.035 * scale, 12, 8);
    const leftHand = new THREE.Mesh(handGeom, skinMat);
    leftHand.position.set(-0.48 * scale, legHeight + 0.25 * scale, 0.22 * scale);
    group.add(leftHand);
    
    // Pointing finger
    const fingerGeom = new THREE.CylinderGeometry(0.012 * scale, 0.01 * scale, 0.08 * scale, 8);
    const finger = new THREE.Mesh(fingerGeom, skinMat);
    finger.position.set(-0.52 * scale, legHeight + 0.22 * scale, 0.28 * scale);
    finger.rotation.x = Math.PI / 3;
    finger.rotation.z = -Math.PI / 6;
    group.add(finger);
    
    // Right arm (on hip, sassy pose)
    const rightUpperArm = new THREE.Mesh(armGeom, skinMat);
    rightUpperArm.position.set(0.28 * scale, legHeight + 0.45 * scale, -0.05 * scale);
    rightUpperArm.rotation.z = Math.PI / 3;
    rightUpperArm.rotation.x = -Math.PI / 8;
    rightUpperArm.castShadow = true;
    group.add(rightUpperArm);
    
    const rightForearm = new THREE.Mesh(forearmGeom, skinMat);
    rightForearm.position.set(0.35 * scale, legHeight + 0.28 * scale, -0.1 * scale);
    rightForearm.rotation.z = Math.PI / 2;
    rightForearm.castShadow = true;
    group.add(rightForearm);
    
    const rightHand = new THREE.Mesh(handGeom, skinMat);
    rightHand.position.set(0.32 * scale, legHeight + 0.15 * scale, -0.08 * scale);
    group.add(rightHand);
    
    // === NECK ===
    const neckGeom = new THREE.CylinderGeometry(0.06 * scale, 0.08 * scale, 0.1 * scale, 12);
    const neck = new THREE.Mesh(neckGeom, skinMat);
    neck.position.y = legHeight + 0.75 * scale;
    group.add(neck);
    
    // === HEAD (high poly) ===
    const headGeom = new THREE.SphereGeometry(0.18 * scale, 32, 24);
    const head = new THREE.Mesh(headGeom, skinMat);
    head.position.y = legHeight + 0.95 * scale;
    head.castShadow = true;
    group.add(head);
    
    // Jaw / chin definition
    const jawGeom = new THREE.SphereGeometry(0.12 * scale, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const jaw = new THREE.Mesh(jawGeom, skinMat);
    jaw.position.set(0, legHeight + 0.85 * scale, 0.04 * scale);
    jaw.scale.set(1, 0.6, 0.8);
    group.add(jaw);
    
    // === KAREN HAIRCUT (The "Speak to the Manager" cut) ===
    const hairGroup = new THREE.Group();
    
    // Main hair volume - asymmetric bob
    const hairMainGeom = new THREE.SphereGeometry(0.2 * scale, 32, 24);
    const hairMain = new THREE.Mesh(hairMainGeom, hairMat);
    hairMain.position.set(0, 0.08 * scale, -0.02 * scale);
    hairMain.scale.set(1.1, 0.85, 1);
    hairGroup.add(hairMain);
    
    // Spiky/layered top
    for (let i = 0; i < 12; i++) {
      const spikeSize = 0.06 + Math.random() * 0.04;
      const spikeGeom = new THREE.ConeGeometry(spikeSize * scale, 0.15 * scale, 8);
      const spike = new THREE.Mesh(spikeGeom, hairMat);
      const angle = (i / 12) * Math.PI * 2;
      const radius = 0.12 + Math.random() * 0.05;
      spike.position.set(
        Math.cos(angle) * radius * scale,
        0.12 * scale + Math.random() * 0.05 * scale,
        Math.sin(angle) * radius * scale * 0.8
      );
      spike.rotation.x = Math.cos(angle) * 0.4;
      spike.rotation.z = -Math.sin(angle) * 0.4;
      hairGroup.add(spike);
    }
    
    // Back layered spikes (extra volume)
    for (let i = 0; i < 8; i++) {
      const spikeGeom = new THREE.ConeGeometry(0.05 * scale, 0.18 * scale, 6);
      const spike = new THREE.Mesh(spikeGeom, hairMat);
      const angle = Math.PI + (i / 8 - 0.5) * Math.PI * 0.8;
      spike.position.set(
        Math.cos(angle) * 0.15 * scale,
        0.05 * scale,
        Math.sin(angle) * 0.18 * scale
      );
      spike.rotation.x = 0.3;
      spike.rotation.z = Math.sin(angle) * 0.3;
      hairGroup.add(spike);
    }
    
    // Front swept bangs (asymmetric)
    const bangsGeom = new THREE.BoxGeometry(0.2 * scale, 0.06 * scale, 0.08 * scale);
    bangsGeom.translate(-0.05 * scale, 0, 0);
    const bangs = new THREE.Mesh(bangsGeom, hairMat);
    bangs.position.set(0.02 * scale, 0.1 * scale, 0.16 * scale);
    bangs.rotation.x = 0.2;
    bangs.rotation.z = 0.1;
    hairGroup.add(bangs);
    
    // Boss Karens get extra spiky crazy hair
    if (type.isBoss) {
      for (let i = 0; i < 16; i++) {
        const spikeGeom = new THREE.ConeGeometry(0.04 * scale, 0.25 * scale, 6);
        const spikeMat = new THREE.MeshStandardMaterial({ 
          color: type.hairColor,
          roughness: 0.7,
          emissive: 0x330000,
          emissiveIntensity: 0.3
        });
        const spike = new THREE.Mesh(spikeGeom, spikeMat);
        const angle = (i / 16) * Math.PI * 2;
        spike.position.set(
          Math.cos(angle) * 0.18 * scale,
          0.15 * scale,
          Math.sin(angle) * 0.18 * scale
        );
        spike.rotation.x = Math.cos(angle) * 0.6;
        spike.rotation.z = -Math.sin(angle) * 0.6;
        hairGroup.add(spike);
      }
    }
    
    hairGroup.position.y = legHeight + 0.95 * scale;
    group.add(hairGroup);
    
    // === FACE FEATURES ===
    // Eye sockets (slightly inset)
    const eyeSocketGeom = new THREE.SphereGeometry(0.035 * scale, 16, 12);
    const eyeSocketMat = new THREE.MeshStandardMaterial({ color: 0xf0d0c0 });
    
    // Eyes (angry, squinting)
    const eyeWhiteGeom = new THREE.SphereGeometry(0.028 * scale, 16, 12);
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const pupilGeom = new THREE.SphereGeometry(0.015 * scale, 12, 8);
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a });
    const irisGeom = new THREE.SphereGeometry(0.018 * scale, 12, 8);
    const irisMat = new THREE.MeshStandardMaterial({ color: type.isBoss ? 0xff0000 : 0x4a7c4e });
    
    [-0.06, 0.06].forEach(offsetX => {
      // Eye socket
      const socket = new THREE.Mesh(eyeSocketGeom, eyeSocketMat);
      socket.position.set(offsetX * scale, legHeight + 0.98 * scale, 0.14 * scale);
      socket.scale.set(1, 0.7, 0.5);
      group.add(socket);
      
      // Eye white
      const eyeWhite = new THREE.Mesh(eyeWhiteGeom, eyeWhiteMat);
      eyeWhite.position.set(offsetX * scale, legHeight + 0.98 * scale, 0.15 * scale);
      eyeWhite.scale.set(1, 0.6, 0.6);
      group.add(eyeWhite);
      
      // Iris
      const iris = new THREE.Mesh(irisGeom, irisMat);
      iris.position.set(offsetX * scale, legHeight + 0.98 * scale, 0.17 * scale);
      group.add(iris);
      
      // Pupil
      const pupil = new THREE.Mesh(pupilGeom, pupilMat);
      pupil.position.set(offsetX * scale, legHeight + 0.98 * scale, 0.175 * scale);
      group.add(pupil);
    });
    
    // Angry eyebrows (thick, furrowed)
    const browGeom = new THREE.BoxGeometry(0.08 * scale, 0.025 * scale, 0.03 * scale);
    const browMat = new THREE.MeshStandardMaterial({ color: type.hairColor });
    [-0.06, 0.06].forEach((offsetX, i) => {
      const brow = new THREE.Mesh(browGeom, browMat);
      brow.position.set(offsetX * scale, legHeight + 1.03 * scale, 0.14 * scale);
      brow.rotation.z = (i === 0 ? 0.35 : -0.35);
      brow.rotation.x = -0.1;
      group.add(brow);
    });
    
    // Nose
    const noseGeom = new THREE.ConeGeometry(0.025 * scale, 0.06 * scale, 8);
    const nose = new THREE.Mesh(noseGeom, skinMat);
    nose.position.set(0, legHeight + 0.93 * scale, 0.17 * scale);
    nose.rotation.x = -Math.PI / 2 + 0.3;
    group.add(nose);
    
    // Nostrils
    const nostrilGeom = new THREE.SphereGeometry(0.01 * scale, 8, 6);
    const nostrilMat = new THREE.MeshStandardMaterial({ color: 0x4a3030 });
    [-0.015, 0.015].forEach(offsetX => {
      const nostril = new THREE.Mesh(nostrilGeom, nostrilMat);
      nostril.position.set(offsetX * scale, legHeight + 0.91 * scale, 0.18 * scale);
      group.add(nostril);
    });
    
    // === MOUTH (shouting, showing teeth) ===
    // Open mouth
    const mouthGeom = new THREE.SphereGeometry(0.05 * scale, 16, 12, 0, Math.PI * 2, 0, Math.PI);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a0a0a });
    const mouth = new THREE.Mesh(mouthGeom, mouthMat);
    mouth.position.set(0, legHeight + 0.86 * scale, 0.15 * scale);
    mouth.scale.set(1.2, 0.8, 0.6);
    mouth.rotation.x = Math.PI;
    group.add(mouth);
    
    // Lips
    const upperLipGeom = new THREE.TorusGeometry(0.04 * scale, 0.012 * scale, 8, 16, Math.PI);
    const lipMat = new THREE.MeshStandardMaterial({ color: 0xcc4466 });
    const upperLip = new THREE.Mesh(upperLipGeom, lipMat);
    upperLip.position.set(0, legHeight + 0.89 * scale, 0.155 * scale);
    upperLip.rotation.x = Math.PI / 2;
    upperLip.rotation.z = Math.PI;
    group.add(upperLip);
    
    const lowerLip = new THREE.Mesh(upperLipGeom, lipMat);
    lowerLip.position.set(0, legHeight + 0.84 * scale, 0.155 * scale);
    lowerLip.rotation.x = Math.PI / 2;
    group.add(lowerLip);
    
    // Sharp teeth (Karen's defining feature!)
    const teethMat = new THREE.MeshStandardMaterial({ color: 0xfffef0 });
    for (let i = 0; i < 8; i++) {
      const isSharp = type.isBoss || i % 2 === 0;
      const toothGeom = isSharp 
        ? new THREE.ConeGeometry(0.008 * scale, 0.025 * scale, 4)
        : new THREE.BoxGeometry(0.012 * scale, 0.018 * scale, 0.008 * scale);
      const tooth = new THREE.Mesh(toothGeom, teethMat);
      const x = (i - 3.5) * 0.012 * scale;
      tooth.position.set(x, legHeight + 0.875 * scale, 0.16 * scale);
      if (isSharp) tooth.rotation.x = Math.PI;
      group.add(tooth);
    }
    
    // Bottom teeth
    for (let i = 0; i < 6; i++) {
      const toothGeom = type.isBoss 
        ? new THREE.ConeGeometry(0.007 * scale, 0.02 * scale, 4)
        : new THREE.BoxGeometry(0.01 * scale, 0.012 * scale, 0.006 * scale);
      const tooth = new THREE.Mesh(toothGeom, teethMat);
      const x = (i - 2.5) * 0.014 * scale;
      tooth.position.set(x, legHeight + 0.845 * scale, 0.155 * scale);
      group.add(tooth);
    }
    
    // Earrings
    const earringGeom = new THREE.SphereGeometry(0.02 * scale, 12, 8);
    const earringMat = new THREE.MeshStandardMaterial({ 
      color: 0xFFD700, 
      metalness: 0.9, 
      roughness: 0.1 
    });
    [-0.17, 0.17].forEach(offsetX => {
      const earring = new THREE.Mesh(earringGeom, earringMat);
      earring.position.set(offsetX * scale, legHeight + 0.9 * scale, 0);
      group.add(earring);
    });
    
    // Sunglasses on head (Karen signature)
    const glassesGroup = new THREE.Group();
    const frameGeom = new THREE.TorusGeometry(0.04 * scale, 0.008 * scale, 8, 24);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.3 });
    const leftFrame = new THREE.Mesh(frameGeom, frameMat);
    leftFrame.position.set(-0.055 * scale, 0.22 * scale, 0.08 * scale);
    leftFrame.rotation.x = Math.PI / 2 - 0.2;
    glassesGroup.add(leftFrame);
    const rightFrame = new THREE.Mesh(frameGeom, frameMat);
    rightFrame.position.set(0.055 * scale, 0.22 * scale, 0.08 * scale);
    rightFrame.rotation.x = Math.PI / 2 - 0.2;
    glassesGroup.add(rightFrame);
    const bridgeGeom = new THREE.CylinderGeometry(0.006 * scale, 0.006 * scale, 0.03 * scale, 8);
    const bridge = new THREE.Mesh(bridgeGeom, frameMat);
    bridge.position.set(0, 0.22 * scale, 0.1 * scale);
    bridge.rotation.z = Math.PI / 2;
    glassesGroup.add(bridge);
    glassesGroup.position.y = legHeight + 0.78 * scale;
    group.add(glassesGroup);
    
    // Handbag (on arm)
    const bagGeom = new THREE.BoxGeometry(0.12 * scale, 0.1 * scale, 0.05 * scale);
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.3 });
    const bag = new THREE.Mesh(bagGeom, bagMat);
    bag.position.set(0.4 * scale, legHeight + 0.4 * scale, 0);
    bag.rotation.z = Math.PI / 6;
    group.add(bag);
    
    group.position.copy(position);
    
    // Create chat bubble sprite
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    
    const insult = type.isBoss 
      ? BOSS_INSULTS[Math.floor(Math.random() * BOSS_INSULTS.length)]
      : KAREN_INSULTS[Math.floor(Math.random() * KAREN_INSULTS.length)];
    
    // Draw bubble background with shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    
    ctx.fillStyle = type.isBoss ? '#ff2020' : '#ffffff';
    ctx.beginPath();
    ctx.roundRect(15, 15, 482, 105, 20);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    
    ctx.strokeStyle = type.isBoss ? '#aa0000' : '#333333';
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // Draw pointer triangle
    ctx.fillStyle = type.isBoss ? '#ff2020' : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(220, 120);
    ctx.lineTo(256, 155);
    ctx.lineTo(292, 120);
    ctx.fill();
    ctx.stroke();
    
    // Draw text
    ctx.fillStyle = type.isBoss ? '#ffffff' : '#1a1a1a';
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Word wrap
    const words = insult.split(' ');
    let line = '';
    let lines: string[] = [];
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > 450) {
        lines.push(line.trim());
        line = word + ' ';
      } else {
        line = test;
      }
    }
    lines.push(line.trim());
    
    const lineHeight = 30;
    const startY = 70 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => {
      ctx.fillText(l, 256, startY + i * lineHeight);
    });
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ 
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.5 * scale, 0.8 * scale, 1);
    sprite.position.y = legHeight + 1.4 * scale;
    group.add(sprite);
    
    return {
      id: nextIdRef.current++,
      mesh: group,
      position: position.clone(),
      health: type.isBoss ? 300 : 100,
      typeIndex,
      speed: type.isBoss ? 1.2 : 2.2 + Math.random() * 0.8,
      dying: false,
      deathTime: 0,
      insult,
      chatBubble: sprite,
      animPhase: Math.random() * Math.PI * 2,
    };
  }, []);

  // Create realistic meatball with sauce detail
  const createMeatball = useCallback((scene: THREE.Scene, pos: THREE.Vector3, dir: THREE.Vector3): Meatball => {
    const group = new THREE.Group();
    
    // Main meatball
    const geometry = new THREE.SphereGeometry(0.12, 32, 24);
    
    // Add surface bumps for texture
    const positionAttr = geometry.attributes.position;
    for (let i = 0; i < positionAttr.count; i++) {
      const x = positionAttr.getX(i);
      const y = positionAttr.getY(i);
      const z = positionAttr.getZ(i);
      const noise = (Math.random() - 0.5) * 0.015;
      positionAttr.setXYZ(i, x + noise, y + noise, z + noise);
    }
    geometry.computeVertexNormals();
    
    const material = new THREE.MeshStandardMaterial({
      color: 0x7a4522,
      roughness: 0.75,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    
    // Add sauce drizzle
    const sauceGeom = new THREE.TorusGeometry(0.08, 0.02, 8, 16, Math.PI * 1.5);
    const sauceMat = new THREE.MeshStandardMaterial({ color: 0xcc2211, roughness: 0.4 });
    const sauce = new THREE.Mesh(sauceGeom, sauceMat);
    sauce.rotation.x = Math.PI / 2;
    sauce.position.y = 0.02;
    mesh.add(sauce);
    
    mesh.position.copy(pos);
    scene.add(mesh);
    
    // Trail particles
    const trailGeom = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(30 * 3);
    trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.PointsMaterial({ 
      color: 0xff4400, 
      size: 0.08, 
      transparent: true, 
      opacity: 0.7 
    });
    const trail = new THREE.Points(trailGeom, trailMat);
    scene.add(trail);
    
    return {
      id: nextIdRef.current++,
      mesh,
      velocity: dir.clone().multiplyScalar(22),
      trail,
    };
  }, []);

  // Create muzzle flash effect
  const createMuzzleFlash = useCallback((scene: THREE.Scene, camera: THREE.Camera) => {
    // Create multiple flash particles
    for (let i = 0; i < 12; i++) {
      const size = 0.02 + Math.random() * 0.04;
      const geom = new THREE.SphereGeometry(size, 6, 4);
      const mat = new THREE.MeshBasicMaterial({ 
        color: i < 4 ? 0xffff00 : i < 8 ? 0xff8800 : 0xff4400,
        transparent: true,
        opacity: 0.9
      });
      const flash = new THREE.Mesh(geom, mat);
      
      // Position in front of camera
      const dir = new THREE.Vector3(0, 0, -1);
      dir.applyQuaternion(camera.quaternion);
      
      flash.position.copy(camera.position);
      flash.position.add(dir.multiplyScalar(0.6));
      flash.position.x += (Math.random() - 0.5) * 0.15;
      flash.position.y += (Math.random() - 0.5) * 0.15 - 0.1;
      
      scene.add(flash);
      
      // Animate and remove
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 3,
        -2 - Math.random() * 3
      ).applyQuaternion(camera.quaternion);
      
      particlesRef.current.push({
        mesh: flash,
        velocity,
        life: 0.15 + Math.random() * 0.1,
        rotationSpeed: new THREE.Vector3(0, 0, 0),
      });
    }
    
    // Smoke puff
    for (let i = 0; i < 6; i++) {
      const size = 0.05 + Math.random() * 0.08;
      const geom = new THREE.SphereGeometry(size, 6, 4);
      const mat = new THREE.MeshBasicMaterial({ 
        color: 0x666666,
        transparent: true,
        opacity: 0.4
      });
      const smoke = new THREE.Mesh(geom, mat);
      
      const dir = new THREE.Vector3(0, 0, -1);
      dir.applyQuaternion(camera.quaternion);
      
      smoke.position.copy(camera.position);
      smoke.position.add(dir.multiplyScalar(0.7));
      smoke.position.x += (Math.random() - 0.5) * 0.1;
      smoke.position.y += (Math.random() - 0.5) * 0.1 - 0.1;
      
      scene.add(smoke);
      
      particlesRef.current.push({
        mesh: smoke,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          0.5 + Math.random() * 0.5,
          (Math.random() - 0.5) * 0.5
        ),
        life: 0.5 + Math.random() * 0.3,
        rotationSpeed: new THREE.Vector3(0, 0, 0),
      });
    }
  }, []);

  // Create blood/sauce splatter on Karen hit
  const createHitEffect = useCallback((scene: THREE.Scene, position: THREE.Vector3, isFatal: boolean) => {
    const particleCount = isFatal ? 40 : 15;
    const colors = [0xff0000, 0xcc0000, 0x990000, 0xff3333, 0xcc2211]; // Blood/sauce colors
    
    for (let i = 0; i < particleCount; i++) {
      const size = 0.02 + Math.random() * (isFatal ? 0.08 : 0.05);
      const geom = new THREE.SphereGeometry(size, 6, 4);
      const mat = new THREE.MeshBasicMaterial({ 
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true,
        opacity: 0.9
      });
      const blood = new THREE.Mesh(geom, mat);
      blood.position.copy(position);
      blood.position.y += 0.8 + Math.random() * 0.6;
      scene.add(blood);
      
      const speed = isFatal ? 4 + Math.random() * 6 : 2 + Math.random() * 3;
      const angle = Math.random() * Math.PI * 2;
      const upAngle = Math.random() * Math.PI * 0.5 + 0.2;
      
      particlesRef.current.push({
        mesh: blood,
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(upAngle) * speed,
          Math.sin(upAngle) * speed,
          Math.sin(angle) * Math.cos(upAngle) * speed
        ),
        life: 0.8 + Math.random() * 0.5,
        rotationSpeed: new THREE.Vector3(0, 0, 0),
      });
    }
    
    // Flash light on hit
    const hitLight = new THREE.PointLight(0xff2200, isFatal ? 6 : 3, isFatal ? 6 : 4);
    hitLight.position.copy(position);
    hitLight.position.y += 1;
    scene.add(hitLight);
    setTimeout(() => scene.remove(hitLight), isFatal ? 150 : 80);
  }, []);

  // Trigger screen shake
  const triggerScreenShake = useCallback((intensity: number, duration: number) => {
    screenShakeRef.current = { intensity, duration };
  }, []);

  // Play Karen scream sound
  const playKarenScream = useCallback(() => {
    // Use the existing sounds system - we'll add a scream via the hurt sound
    sounds.hurt();
  }, [sounds]);

  // Create detailed gore explosion with body parts
  const createGoreExplosion = useCallback((scene: THREE.Scene, position: THREE.Vector3, type: typeof KAREN_TYPES[0]) => {
    const colors = [0x8b0000, 0xdc143c, 0xb22222, 0xff4040, type.hairColor, type.skinTone, type.outfit, 0xff6347];
    
    // Trigger big screen shake on explosion
    triggerScreenShake(0.15, 0.3);
    
    // Gore chunks
    for (let i = 0; i < 50; i++) {
      const size = 0.03 + Math.random() * 0.12;
      const geomType = Math.random();
      let geom: THREE.BufferGeometry;
      
      if (geomType < 0.3) {
        geom = new THREE.SphereGeometry(size, 8, 6);
      } else if (geomType < 0.6) {
        geom = new THREE.BoxGeometry(size, size * 0.6, size * 0.8);
      } else {
        geom = new THREE.ConeGeometry(size * 0.5, size * 1.5, 6);
      }
      
      const mat = new THREE.MeshStandardMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        roughness: 0.8,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(position);
      mesh.position.y += 0.8 + Math.random() * 0.4;
      mesh.castShadow = true;
      scene.add(mesh);
      
      const speed = 6 + Math.random() * 8;
      const angle = Math.random() * Math.PI * 2;
      const upAngle = Math.random() * Math.PI * 0.4 + 0.2;
      
      particlesRef.current.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(upAngle) * speed,
          Math.sin(upAngle) * speed,
          Math.sin(angle) * Math.cos(upAngle) * speed
        ),
        life: 2 + Math.random(),
        rotationSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10
        ),
      });
    }
    
    // Blood splatter sprites
    for (let i = 0; i < 20; i++) {
      const splatGeom = new THREE.SphereGeometry(0.15 + Math.random() * 0.2, 8, 6);
      splatGeom.scale(1, 0.1, 1);
      const splatMat = new THREE.MeshStandardMaterial({ 
        color: 0x8b0000, 
        transparent: true,
        opacity: 0.8 
      });
      const splat = new THREE.Mesh(splatGeom, splatMat);
      
      const splatAngle = Math.random() * Math.PI * 2;
      const dist = 1 + Math.random() * 3;
      splat.position.set(
        position.x + Math.cos(splatAngle) * dist,
        0.01,
        position.z + Math.sin(splatAngle) * dist
      );
      splat.rotation.y = Math.random() * Math.PI * 2;
      scene.add(splat);
      
      // Fade out and remove
      setTimeout(() => {
        scene.remove(splat);
      }, 5000);
    }
    
    // Explosion light
    const light = new THREE.PointLight(0xff2200, 8, 8);
    light.position.copy(position);
    light.position.y += 1;
    scene.add(light);
    
    setTimeout(() => scene.remove(light), 150);
  }, [triggerScreenShake]);

  // Initialize Three.js scene with enhanced graphics
  const initScene = useCallback(() => {
    if (!containerRef.current) return;
    
    // Scene - gritty dungeon atmosphere
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0608);
    // Thick volumetric-style fog for dungeon atmosphere
    scene.fog = new THREE.FogExp2(0x1a0a0a, 0.025);
    sceneRef.current = scene;
    
    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    cameraRef.current = camera;
    
    // Enhanced Renderer with dramatic tone mapping
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      powerPreference: 'high-performance' 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    // Dim ambient for gritty feel - shadows matter
    const ambient = new THREE.AmbientLight(0x331111, 0.4);
    scene.add(ambient);
    
    // Hemisphere light - red from below (hell vibe), dim white from above
    const hemiLight = new THREE.HemisphereLight(0x444444, 0x220000, 0.5);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);
    
    // Main directional light - harsh overhead
    const dirLight = new THREE.DirectionalLight(0xff8866, 1.2);
    dirLight.position.set(5, 25, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 60;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);
    
    // ============ NEON "KAREN DUNGEON 3D" SIGN ============
    const signGroup = new THREE.Group();
    
    // Sign backing (dark metal)
    const signBackGeom = new THREE.BoxGeometry(8, 1.5, 0.2);
    const signBackMat = new THREE.MeshStandardMaterial({ 
      color: 0x1a1a1a, 
      roughness: 0.3, 
      metalness: 0.8 
    });
    const signBack = new THREE.Mesh(signBackGeom, signBackMat);
    signGroup.add(signBack);
    
    // Neon tubes - "KAREN DUNGEON 3D" letters approximation
    const neonMat = new THREE.MeshBasicMaterial({ 
      color: 0xff0033,
      transparent: true,
      opacity: 1
    });
    const neonGlowMat = new THREE.MeshBasicMaterial({ 
      color: 0xff0044,
      transparent: true,
      opacity: 0.3
    });
    
    // Create neon letter tubes (simplified geometric letters)
    const createNeonLetter = (char: string, xPos: number) => {
      const letterGroup = new THREE.Group();
      const tubeRadius = 0.03;
      const height = 0.6;
      const width = 0.35;
      
      // Simplified letter shapes using cylinders and boxes
      if ('KARNDUGE3'.includes(char)) {
        // Vertical bar
        const vBar = new THREE.Mesh(
          new THREE.CylinderGeometry(tubeRadius, tubeRadius, height, 8),
          neonMat
        );
        letterGroup.add(vBar);
        
        // Horizontal bars for letters like K, A, E, etc
        if ('AE3'.includes(char)) {
          const hBar = new THREE.Mesh(
            new THREE.CylinderGeometry(tubeRadius, tubeRadius, width * 0.6, 8),
            neonMat
          );
          hBar.rotation.z = Math.PI / 2;
          hBar.position.set(width * 0.2, 0, 0);
          letterGroup.add(hBar);
        }
        
        // Top bar for letters
        if ('EKRD3'.includes(char)) {
          const topBar = new THREE.Mesh(
            new THREE.CylinderGeometry(tubeRadius, tubeRadius, width * 0.5, 8),
            neonMat
          );
          topBar.rotation.z = Math.PI / 2;
          topBar.position.set(width * 0.15, height * 0.4, 0);
          letterGroup.add(topBar);
        }
        
        // Bottom bar
        if ('EL3'.includes(char)) {
          const botBar = new THREE.Mesh(
            new THREE.CylinderGeometry(tubeRadius, tubeRadius, width * 0.5, 8),
            neonMat
          );
          botBar.rotation.z = Math.PI / 2;
          botBar.position.set(width * 0.15, -height * 0.4, 0);
          letterGroup.add(botBar);
        }
      }
      
      // Add glow sphere around each letter
      const glowSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 8),
        neonGlowMat
      );
      letterGroup.add(glowSphere);
      
      letterGroup.position.x = xPos;
      return letterGroup;
    };
    
    // Create the sign text
    const text = "KARENDUNGEON3D";
    const letterSpacing = 0.5;
    const startX = -(text.length * letterSpacing) / 2;
    
    text.split('').forEach((char, i) => {
      const letter = createNeonLetter(char, startX + i * letterSpacing);
      signGroup.add(letter);
    });
    
    // Neon glow lights behind sign
    const signGlow1 = new THREE.PointLight(0xff0033, 15, 12);
    signGlow1.position.set(0, 0, 0.5);
    signGroup.add(signGlow1);
    
    const signGlow2 = new THREE.PointLight(0xff2244, 8, 8);
    signGlow2.position.set(-2, 0, 0.3);
    signGroup.add(signGlow2);
    
    const signGlow3 = new THREE.PointLight(0xff2244, 8, 8);
    signGlow3.position.set(2, 0, 0.3);
    signGroup.add(signGlow3);
    
    // Position sign above spawn area
    signGroup.position.set(0, 4, -6);
    signGroup.rotation.x = -0.15;
    scene.add(signGroup);
    
    // ============ DRAMATIC SPOTLIGHTS ============
    // Player rim light (follows camera) - dramatic backlight
    const rimLight = new THREE.SpotLight(0xff4422, 3, 15, Math.PI / 6, 0.5, 1);
    rimLight.position.set(0, 3, 2);
    rimLight.target.position.set(0, 0, -1);
    camera.add(rimLight);
    camera.add(rimLight.target);
    
    // Player flashlight - bright white cone
    const flashlight = new THREE.SpotLight(0xffffee, 6, 35, Math.PI / 4, 0.4, 1);
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.width = 1024;
    flashlight.shadow.mapSize.height = 1024;
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera);
    
    // Dramatic colored spotlights in arena corners
    const spotConfigs = [
      { pos: [12, 8, 12], target: [0, 0, 0], color: 0xff2200, intensity: 4 },
      { pos: [-12, 8, 12], target: [0, 0, 0], color: 0xff0044, intensity: 4 },
      { pos: [12, 8, -12], target: [0, 0, 0], color: 0xff4400, intensity: 4 },
      { pos: [-12, 8, -12], target: [0, 0, 0], color: 0xff0022, intensity: 4 },
    ];
    
    spotConfigs.forEach(config => {
      const spot = new THREE.SpotLight(config.color, config.intensity, 30, Math.PI / 5, 0.6, 1);
      spot.position.set(config.pos[0], config.pos[1], config.pos[2]);
      spot.target.position.set(config.target[0], config.target[1], config.target[2]);
      scene.add(spot);
      scene.add(spot.target);
    });
    
    // ============ VOLUMETRIC FOG BEAMS (simulated with cone meshes) ============
    const fogBeamMat = new THREE.MeshBasicMaterial({
      color: 0xff4422,
      transparent: true,
      opacity: 0.04,
      side: THREE.DoubleSide
    });
    
    const beamPositions = [
      { x: 8, z: 8, rot: 0.2 },
      { x: -8, z: 8, rot: -0.2 },
      { x: 8, z: -8, rot: 0.15 },
      { x: -8, z: -8, rot: -0.15 },
    ];
    
    beamPositions.forEach(bp => {
      const beamGeom = new THREE.ConeGeometry(4, 12, 16, 1, true);
      const beam = new THREE.Mesh(beamGeom, fogBeamMat);
      beam.position.set(bp.x, 6, bp.z);
      beam.rotation.x = Math.PI;
      beam.rotation.z = bp.rot;
      scene.add(beam);
    });
    
    // ============ AMBIENT OCCLUSION SHADOWS (ground darkening) ============
    // Dark vignette on floor edges for AO effect
    const aoRingGeom = new THREE.RingGeometry(15, 50, 32);
    const aoMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    });
    const aoRing = new THREE.Mesh(aoRingGeom, aoMat);
    aoRing.rotation.x = -Math.PI / 2;
    aoRing.position.y = 0.01;
    scene.add(aoRing);
    
    // Wall/corner darkening planes
    const cornerDarkMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });
    
    // Red accent lights at floor level for drama
    const floorLightPositions = [
      [6, 0, 0], [-6, 0, 0], [0, 0, 6], [0, 0, -6],
      [10, 0, 10], [-10, 0, 10], [10, 0, -10], [-10, 0, -10]
    ];
    
    floorLightPositions.forEach(([x, y, z]) => {
      const floorGlow = new THREE.PointLight(0xff1100, 1.5, 8);
      floorGlow.position.set(x, 0.2, z);
      scene.add(floorGlow);
      
      // Glowing floor plate
      const plateGeom = new THREE.CircleGeometry(0.5, 16);
      const plateMat = new THREE.MeshBasicMaterial({ 
        color: 0xff2200, 
        transparent: true, 
        opacity: 0.6 
      });
      const plate = new THREE.Mesh(plateGeom, plateMat);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(x, 0.02, z);
      scene.add(plate);
    });
    
    // Enhanced Floor with texture-like pattern
    const floorSize = 100;
    const floorGeom = new THREE.PlaneGeometry(floorSize, floorSize, 50, 50);
    
    // Add slight height variation for depth
    const floorPositions = floorGeom.attributes.position;
    for (let i = 0; i < floorPositions.count; i++) {
      const y = (Math.random() - 0.5) * 0.02;
      floorPositions.setZ(i, y);
    }
    floorGeom.computeVertexNormals();
    
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a15,
      roughness: 0.92,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Generate dungeon rooms with more detail
    const rooms = [
      { x: 0, z: 0, width: 14, depth: 14, theme: 4 },
      { x: 20, z: 0, width: 12, depth: 12, theme: 0 },
      { x: -20, z: 0, width: 12, depth: 12, theme: 1 },
      { x: 0, z: 20, width: 12, depth: 12, theme: 2 },
      { x: 0, z: -20, width: 12, depth: 12, theme: 3 },
      { x: 22, z: 20, width: 10, depth: 10, theme: 0 },
      { x: -22, z: 20, width: 10, depth: 10, theme: 1 },
      { x: 22, z: -20, width: 10, depth: 10, theme: 2 },
      { x: -22, z: -20, width: 10, depth: 10, theme: 3 },
    ];
    
    rooms.forEach(room => {
      const theme = ROOM_THEMES[room.theme];
      const wallHeight = 4.5;
      const wallThickness = 0.4;
      
      // Wall material with subtle variation
      const wallMat = new THREE.MeshStandardMaterial({
        color: theme.wallColor,
        roughness: 0.85,
        metalness: 0.05,
      });
      
      // Create textured walls
      const createWall = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
        const geom = new THREE.BoxGeometry(width, height, depth, 4, 4, 1);
        const mesh = new THREE.Mesh(geom, wallMat);
        mesh.position.set(room.x + x, y, room.z + z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        
        // Add wall trim
        const trimGeom = new THREE.BoxGeometry(width + 0.05, 0.1, depth + 0.05);
        const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.7 });
        const topTrim = new THREE.Mesh(trimGeom, trimMat);
        topTrim.position.set(room.x + x, height - 0.05, room.z + z);
        scene.add(topTrim);
        const bottomTrim = new THREE.Mesh(trimGeom, trimMat);
        bottomTrim.position.set(room.x + x, 0.05, room.z + z);
        scene.add(bottomTrim);
      };
      
      createWall(room.width, wallHeight, wallThickness, 0, wallHeight / 2, -room.depth / 2);
      createWall(room.width, wallHeight, wallThickness, 0, wallHeight / 2, room.depth / 2);
      createWall(wallThickness, wallHeight, room.depth, room.width / 2, wallHeight / 2, 0);
      createWall(wallThickness, wallHeight, room.depth, -room.width / 2, wallHeight / 2, 0);
      
      // Ceiling with detail
      const ceilGeom = new THREE.PlaneGeometry(room.width, room.depth);
      const ceilMat = new THREE.MeshStandardMaterial({ color: 0x1a0c0c, roughness: 0.95 });
      const ceiling = new THREE.Mesh(ceilGeom, ceilMat);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set(room.x, wallHeight, room.z);
      ceiling.receiveShadow = true;
      scene.add(ceiling);
      
      // Room floor
      const roomFloorGeom = new THREE.PlaneGeometry(room.width - 0.3, room.depth - 0.3);
      const roomFloorMat = new THREE.MeshStandardMaterial({
        color: theme.floorColor,
        roughness: 0.8,
        metalness: 0.08,
      });
      const roomFloor = new THREE.Mesh(roomFloorGeom, roomFloorMat);
      roomFloor.rotation.x = -Math.PI / 2;
      roomFloor.position.set(room.x, 0.02, room.z);
      roomFloor.receiveShadow = true;
      scene.add(roomFloor);
      
      // Torches with animated flames
      const torchPositions = [
        [room.width / 2 - 0.6, 2.8, room.depth / 2 - 0.6],
        [-room.width / 2 + 0.6, 2.8, room.depth / 2 - 0.6],
        [room.width / 2 - 0.6, 2.8, -room.depth / 2 + 0.6],
        [-room.width / 2 + 0.6, 2.8, -room.depth / 2 + 0.6],
      ];
      
      torchPositions.forEach(([x, y, z]) => {
        // Torch light (no shadows - keeps mobile GPUs from blowing the shader limit)
        const torchLight = new THREE.PointLight(0xff6622, 1.8, 10, 1.5);
        torchLight.position.set(room.x + x, y, room.z + z);
        // IMPORTANT: do not castShadow here; too many shadow maps can break rendering on mobile/low-end GPUs
        torchLight.castShadow = false;
        scene.add(torchLight);
        
        // Torch bracket
        const bracketGeom = new THREE.BoxGeometry(0.08, 0.15, 0.15);
        const bracketMat = new THREE.MeshStandardMaterial({ color: 0x2a2020, metalness: 0.7 });
        const bracket = new THREE.Mesh(bracketGeom, bracketMat);
        bracket.position.set(room.x + x, y - 0.25, room.z + z);
        scene.add(bracket);
        
        // Torch handle
        const torchGeom = new THREE.CylinderGeometry(0.04, 0.06, 0.5, 8);
        const torchMat = new THREE.MeshStandardMaterial({ color: 0x4a3525 });
        const torch = new THREE.Mesh(torchGeom, torchMat);
        torch.position.set(room.x + x, y - 0.1, room.z + z);
        scene.add(torch);
        
        // Flame (multiple layers for depth)
        for (let f = 0; f < 3; f++) {
          const flameGeom = new THREE.ConeGeometry(0.06 - f * 0.015, 0.15 - f * 0.03, 8);
          const flameMat = new THREE.MeshBasicMaterial({ 
            color: f === 0 ? 0xff4400 : f === 1 ? 0xff8800 : 0xffcc00,
            transparent: true,
            opacity: 0.9 - f * 0.2
          });
          const flame = new THREE.Mesh(flameGeom, flameMat);
          flame.position.set(room.x + x, y + 0.2 + f * 0.02, room.z + z);
          scene.add(flame);
        }
      });
      
      // Spawn ammo crates
      if (room.theme !== 4 && Math.random() > 0.25) {
        const crateGroup = new THREE.Group();
        
        // Crate body
        const crateGeom = new THREE.BoxGeometry(0.5, 0.35, 0.5);
        const crateMat = new THREE.MeshStandardMaterial({ color: 0x3a5a3a, roughness: 0.8 });
        const crate = new THREE.Mesh(crateGeom, crateMat);
        crate.castShadow = true;
        crateGroup.add(crate);
        
        // Crate bands
        const bandGeom = new THREE.BoxGeometry(0.52, 0.04, 0.52);
        const bandMat = new THREE.MeshStandardMaterial({ color: 0x2a3a2a, metalness: 0.5 });
        [-0.12, 0.12].forEach(y => {
          const band = new THREE.Mesh(bandGeom, bandMat);
          band.position.y = y;
          crateGroup.add(band);
        });
        
        // Ammo label
        const labelGeom = new THREE.PlaneGeometry(0.25, 0.15);
        const labelMat = new THREE.MeshStandardMaterial({ color: 0xccaa44 });
        const label = new THREE.Mesh(labelGeom, labelMat);
        label.position.set(0, 0, 0.26);
        crateGroup.add(label);
        
        crateGroup.position.set(
          room.x + (Math.random() - 0.5) * room.width * 0.6,
          0.175,
          room.z + (Math.random() - 0.5) * room.depth * 0.6
        );
        scene.add(crateGroup);
        
        ammoPickupsRef.current.push({
          id: nextIdRef.current++,
          mesh: crateGroup,
          collected: false,
        });
      }
    });
    
    // Create detailed meatball cannon
    const cannonGroup = new THREE.Group();
    
    // Cannon barrel (detailed)
    const barrelGeom = new THREE.CylinderGeometry(0.06, 0.1, 0.6, 24);
    const barrelMat = new THREE.MeshStandardMaterial({ 
      color: 0x404040, 
      roughness: 0.25, 
      metalness: 0.85 
    });
    const barrel = new THREE.Mesh(barrelGeom, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.35;
    cannonGroup.add(barrel);
    
    // Barrel rings
    for (let i = 0; i < 3; i++) {
      const ringGeom = new THREE.TorusGeometry(0.08 - i * 0.01, 0.015, 8, 24);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.9 });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.z = -0.15 - i * 0.18;
      cannonGroup.add(ring);
    }
    
    // Cannon body
    const bodyGeom = new THREE.BoxGeometry(0.18, 0.14, 0.25);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.3 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.set(0, -0.02, -0.05);
    cannonGroup.add(body);
    
    // Handle grip
    const gripGeom = new THREE.CylinderGeometry(0.035, 0.04, 0.12, 12);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.9 });
    const grip = new THREE.Mesh(gripGeom, gripMat);
    grip.position.set(0, -0.12, 0.02);
    cannonGroup.add(grip);
    
    // Loaded meatball visible in chamber
    const loadedMeatGeom = new THREE.SphereGeometry(0.05, 16, 12);
    const loadedMeatMat = new THREE.MeshStandardMaterial({ color: 0x7a4522 });
    const loadedMeat = new THREE.Mesh(loadedMeatGeom, loadedMeatMat);
    loadedMeat.position.z = -0.52;
    cannonGroup.add(loadedMeat);
    
    cannonGroup.position.set(0.22, -0.18, -0.45);
    cannonGroup.rotation.x = 0.08;
    camera.add(cannonGroup);
    cannonRef.current = cannonGroup;
    
    // Spawn initial Karens
    const spawnPositions = [
      new THREE.Vector3(17, 0, 0),
      new THREE.Vector3(-17, 0, 0),
      new THREE.Vector3(0, 0, 17),
      new THREE.Vector3(0, 0, -17),
      new THREE.Vector3(20, 0, 17),
    ];
    
    spawnPositions.forEach(pos => {
      const typeIndex = Math.floor(Math.random() * 8);
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
    
    karensRef.current.forEach(k => sceneRef.current?.remove(k.mesh));
    karensRef.current = [];
    meatballsRef.current.forEach(m => {
      sceneRef.current?.remove(m.mesh);
      sceneRef.current?.remove(m.trail);
    });
    meatballsRef.current = [];
    particlesRef.current.forEach(p => sceneRef.current?.remove(p.mesh));
    particlesRef.current = [];
    
    ammoPickupsRef.current.forEach(a => {
      a.collected = false;
      if (a.mesh) a.mesh.visible = true;
    });
    
    if (sceneRef.current) {
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const dist = 14 + Math.random() * 8;
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
      cannonRef.current.rotation.x = 0.15; // Kick up
      setTimeout(() => {
        if (cannonRef.current) {
          cannonRef.current.position.z = -0.45;
          cannonRef.current.rotation.x = 0.08;
        }
      }, 100);
    }
    
    // Get camera direction for shooting
    const camera = cameraRef.current;
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camera.quaternion);
    
    // Calculate spawn position in front of camera/player
    const spawnPos = playerPosRef.current.clone();
    spawnPos.add(dir.clone().multiplyScalar(0.8));
    
    const meatball = createMeatball(sceneRef.current, spawnPos, dir);
    meatballsRef.current.push(meatball);
    
    // Create muzzle flash particles
    createMuzzleFlash(sceneRef.current, camera);
    
    // Small screen shake on shoot
    triggerScreenShake(0.02, 0.1);
    
    // Bright muzzle flash light
    const flash = new THREE.PointLight(0xff8800, 8, 6);
    flash.position.copy(playerPosRef.current);
    flash.position.add(dir.clone().multiplyScalar(0.5));
    sceneRef.current.add(flash);
    setTimeout(() => sceneRef.current?.remove(flash), 60);
  }, [sounds, createMeatball, createMuzzleFlash, triggerScreenShake]);

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
      
      const moveSpeed = 6.0 * delta;
      const turnSpeed = 3.5 * delta;
      
      // Left stick - movement only (relative to current facing direction)
      if (thumbpadRef.current.active) {
        const dx = thumbpadRef.current.currentX - thumbpadRef.current.startX;
        const dy = thumbpadRef.current.currentY - thumbpadRef.current.startY;
        const maxDist = 50;
        
        const moveX = Math.max(-1, Math.min(1, dx / maxDist));
        const moveY = Math.max(-1, Math.min(1, dy / maxDist));
        
        // Forward/backward movement
        playerPosRef.current.x += Math.sin(playerRotRef.current) * -moveY * moveSpeed;
        playerPosRef.current.z += Math.cos(playerRotRef.current) * -moveY * moveSpeed;
        // Strafe left/right
        playerPosRef.current.x += Math.sin(playerRotRef.current + Math.PI / 2) * moveX * moveSpeed;
        playerPosRef.current.z += Math.cos(playerRotRef.current + Math.PI / 2) * moveX * moveSpeed;
      }
      
      // Right stick - aiming (rotation on both axes)
      if (lookpadRef.current.active) {
        const dx = lookpadRef.current.currentX - lookpadRef.current.startX;
        const maxDist = 40;
        const turn = Math.max(-1, Math.min(1, dx / maxDist));
        playerRotRef.current -= turn * turnSpeed;
        
        // Reset start position for continuous aiming feel
        lookpadRef.current.startX = lookpadRef.current.currentX * 0.1 + lookpadRef.current.startX * 0.9;
      }
      
      // Apply screen shake
      if (screenShakeRef.current.duration > 0) {
        screenShakeRef.current.duration -= delta;
        const shakeAmount = screenShakeRef.current.intensity * (screenShakeRef.current.duration / 0.3);
        camera.position.x = playerPosRef.current.x + (Math.random() - 0.5) * shakeAmount;
        camera.position.y = playerPosRef.current.y + (Math.random() - 0.5) * shakeAmount;
        camera.position.z = playerPosRef.current.z + (Math.random() - 0.5) * shakeAmount;
      } else {
        camera.position.copy(playerPosRef.current);
      }
      camera.rotation.y = playerRotRef.current;
      
      // Update meatballs
      meatballsRef.current = meatballsRef.current.filter(mb => {
        mb.mesh.position.add(mb.velocity.clone().multiplyScalar(delta));
        mb.mesh.rotation.x += delta * 5;
        mb.mesh.rotation.z += delta * 3;
        
        const dist = mb.mesh.position.distanceTo(playerPosRef.current);
        if (dist > 50) {
          scene.remove(mb.mesh);
          scene.remove(mb.trail);
          return false;
        }
        
        for (const karen of karensRef.current) {
          if (karen.dying) continue;
          
          const karenDist = mb.mesh.position.distanceTo(karen.position);
          if (karenDist < 1.2) {
            karen.health -= 65;
            sounds.splat();
            
            // Create hit effect (blood/sauce splatter)
            const isFatal = karen.health <= 0;
            createHitEffect(scene, karen.position, isFatal);
            
            // Screen shake on hit
            triggerScreenShake(isFatal ? 0.1 : 0.04, isFatal ? 0.25 : 0.1);
            
            // Karen scream on hit
            if (isFatal) {
              playKarenScream();
            }
            
            if (isFatal) {
              karen.dying = true;
              karen.deathTime = 0;
              createGoreExplosion(scene, karen.position, KAREN_TYPES[karen.typeIndex]);
              sounds.explosion();
              
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
      
      // Update particles with rotation
      particlesRef.current = particlesRef.current.filter(p => {
        p.mesh.position.add(p.velocity.clone().multiplyScalar(delta));
        p.velocity.y -= 12 * delta;
        p.life -= delta;
        
        if (p.rotationSpeed) {
          p.mesh.rotation.x += p.rotationSpeed.x * delta;
          p.mesh.rotation.y += p.rotationSpeed.y * delta;
          p.mesh.rotation.z += p.rotationSpeed.z * delta;
        }
        
        if (p.life <= 0 || p.mesh.position.y < -0.1) {
          scene.remove(p.mesh);
          return false;
        }
        
        p.mesh.scale.setScalar(Math.max(0.1, p.life * 0.5));
        return true;
      });
      
      // Update Karens with walking animation
      karensRef.current = karensRef.current.filter(karen => {
        if (karen.dying) {
          karen.deathTime += delta;
          karen.mesh.scale.setScalar(1 - karen.deathTime * 0.6);
          karen.mesh.rotation.y += delta * 12;
          karen.mesh.position.y -= delta * 2;
          
          if (karen.deathTime > 1.2) {
            scene.remove(karen.mesh);
            return false;
          }
          return true;
        }
        
        const dir = new THREE.Vector3()
          .subVectors(playerPosRef.current, karen.position)
          .normalize();
        
        karen.position.add(dir.multiplyScalar(karen.speed * delta));
        karen.mesh.position.copy(karen.position);
        karen.mesh.lookAt(playerPosRef.current.x, karen.position.y, playerPosRef.current.z);
        
        // Walking bob animation
        karen.animPhase += delta * 8;
        karen.mesh.position.y = Math.abs(Math.sin(karen.animPhase)) * 0.08;
        
        // Slight body sway
        karen.mesh.rotation.z = Math.sin(karen.animPhase * 0.5) * 0.05;
        
        if (karen.chatBubble) {
          karen.chatBubble.quaternion.copy(camera.quaternion);
        }
        
        const playerDist = karen.position.distanceTo(playerPosRef.current);
        if (playerDist < 1.3) {
          healthRef.current -= 25;
          setHealth(healthRef.current);
          comboRef.current = 0;
          setCombo(0);
          setMultiplier(1);
          sounds.hurt();
          
          karen.position.add(dir.multiplyScalar(-3.5));
          
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
        if (dist < 1.8) {
          pickup.collected = true;
          pickup.mesh.visible = false;
          ammoRef.current = Math.min(50, ammoRef.current + 12);
          setAmmo(ammoRef.current);
          sounds.pickup();
        }
        
        pickup.mesh.position.y = 0.175 + Math.sin(Date.now() * 0.003) * 0.05;
        pickup.mesh.rotation.y += delta * 0.5;
      });
      
      // Spawn more Karens
      spawnTimerRef.current += delta;
      if (spawnTimerRef.current > 2.8) {
        spawnTimerRef.current = 0;
        
        const angle = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 10;
        const pos = new THREE.Vector3(
          playerPosRef.current.x + Math.cos(angle) * dist,
          0,
          playerPosRef.current.z + Math.sin(angle) * dist
        );
        
        const typeIndex = Math.random() < 0.12 
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
  }, [gameState, initScene, sounds, createKaren, createGoreExplosion, createHitEffect, triggerScreenShake, playKarenScream, saveScore]);

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
            <div className="bg-orange-900/80 backdrop-blur-sm rounded-lg px-3 py-1 border border-orange-500/50 animate-pulse">
              <div className="text-sm font-bold text-orange-300">
                {combo}x COMBO! ({multiplier}x)
              </div>
            </div>
          )}
        </div>
        
        <div className="flex flex-col gap-1 items-end">
          <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-red-900/50 w-32">
            <div className="text-xs text-red-400 mb-1">HEALTH</div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-300"
                style={{ width: `${health}%` }}
              />
            </div>
          </div>
          
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
          {/* Left Stick - Movement */}
          <div
            className="absolute left-4 bottom-4 w-36 h-36 rounded-full bg-blue-900/30 border-2 border-blue-400/50 flex items-center justify-center z-20"
            onTouchStart={handleLeftTouchStart}
            onTouchMove={handleLeftTouchMove}
            onTouchEnd={handleLeftTouchEnd}
          >
            <div className="w-14 h-14 rounded-full bg-blue-500/40 border-2 border-blue-300/60 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-blue-200 text-xs font-bold">MOVE</span>
            </div>
          </div>
          
          {/* Right Stick - Aiming */}
          <div
            className="absolute right-40 bottom-4 w-36 h-36 rounded-full bg-orange-900/30 border-2 border-orange-400/50 flex items-center justify-center z-20"
            onTouchStart={handleRightTouchStart}
            onTouchMove={handleRightTouchMove}
            onTouchEnd={handleRightTouchEnd}
          >
            <div className="w-14 h-14 rounded-full bg-orange-500/40 border-2 border-orange-300/60 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <span className="text-orange-200 text-xs font-bold">AIM</span>
            </div>
          </div>
          
          {/* Fire Button */}
          <button
            className="absolute right-4 bottom-4 w-32 h-32 rounded-full bg-gradient-to-br from-red-600 to-red-800 border-4 border-red-400 flex items-center justify-center z-20 active:scale-95 active:from-red-500 active:to-red-700 shadow-lg shadow-red-500/40"
            onTouchStart={(e) => { e.preventDefault(); shootMeatball(); }}
          >
            <span className="text-white font-bold text-xl drop-shadow-lg">FIRE</span>
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
