import * as THREE from 'three';
import { createSkinMaterial, createFabricMaterial, createHairMaterial, createLeatherMaterial } from './modelLoader';

interface KarenType {
  name: string;
  size: number;
  health: number;
  speed: number;
  points: number;
  skinTone: number;
  hairColor: number;
  outfit: number;
  isBoss: boolean;
}

/**
 * Creates a high-quality Karen 3D model with PBR materials.
 * Inspired by Poly Pizza style characters but with better detail.
 */
export function createKarenModel(type: KarenType): THREE.Group {
  const group = new THREE.Group();
  const scale = type.size;
  
  // High-quality PBR materials
  const skinMat = createSkinMaterial(type.skinTone);
  const outfitMat = createFabricMaterial(type.outfit);
  const hairMat = createHairMaterial(type.hairColor);
  const shoeMat = createLeatherMaterial(0x1a1a1a);
  
  // Gold jewelry material
  const jewelryMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    metalness: 0.95,
    roughness: 0.15,
    emissive: 0x442200,
    emissiveIntensity: 0.1,
  });
  
  // Phone material
  const phoneMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    metalness: 0.85,
    roughness: 0.15,
  });
  
  // Body proportions (realistic humanoid)
  const bodyHeight = 1.8 * scale;
  const headSize = 0.22 * scale;
  const torsoHeight = 0.5 * scale;
  const legHeight = 0.75 * scale;
  const armLength = 0.55 * scale;
  const shoulderY = legHeight + torsoHeight * 0.85;
  
  // === LEGS (smooth, realistic) ===
  const hipWidth = 0.2 * scale;
  const thighRadius = 0.07 * scale;
  const calfRadius = 0.055 * scale;
  
  // Thighs (in dress/pants)
  const thighGeom = new THREE.CapsuleGeometry(thighRadius, legHeight * 0.45, 16, 32);
  [-1, 1].forEach(side => {
    const thigh = new THREE.Mesh(thighGeom, outfitMat);
    thigh.position.set(side * hipWidth * 0.5, legHeight * 0.55, 0);
    thigh.castShadow = true;
    thigh.receiveShadow = true;
    group.add(thigh);
  });
  
  // Calves (skin showing)
  const calfGeom = new THREE.CapsuleGeometry(calfRadius, legHeight * 0.4, 16, 32);
  [-1, 1].forEach(side => {
    const calf = new THREE.Mesh(calfGeom, skinMat);
    calf.position.set(side * hipWidth * 0.5, legHeight * 0.2, 0);
    calf.castShadow = true;
    calf.receiveShadow = true;
    group.add(calf);
  });
  
  // Shoes (detailed heels)
  const shoeGeom = new THREE.BoxGeometry(0.09 * scale, 0.05 * scale, 0.16 * scale);
  [-1, 1].forEach(side => {
    const shoe = new THREE.Mesh(shoeGeom, shoeMat);
    shoe.position.set(side * hipWidth * 0.5, 0.025 * scale, 0.02 * scale);
    shoe.castShadow = true;
    group.add(shoe);
    
    // Heel
    const heelGeom = new THREE.CylinderGeometry(0.015 * scale, 0.012 * scale, 0.04 * scale, 8);
    const heel = new THREE.Mesh(heelGeom, shoeMat);
    heel.position.set(side * hipWidth * 0.5, 0.02 * scale, -0.05 * scale);
    group.add(heel);
  });
  
  // === PELVIS / HIPS ===
  const pelvisGeom = new THREE.SphereGeometry(0.18 * scale, 48, 32);
  const pelvis = new THREE.Mesh(pelvisGeom, outfitMat);
  pelvis.position.y = legHeight + 0.05 * scale;
  pelvis.scale.set(1.1, 0.6, 0.9);
  pelvis.castShadow = true;
  group.add(pelvis);
  
  // === TORSO ===
  // Waist
  const waistGeom = new THREE.CylinderGeometry(0.12 * scale, 0.15 * scale, 0.2 * scale, 32);
  const waist = new THREE.Mesh(waistGeom, outfitMat);
  waist.position.y = legHeight + 0.2 * scale;
  waist.castShadow = true;
  group.add(waist);
  
  // Chest
  const chestGeom = new THREE.CylinderGeometry(0.14 * scale, 0.12 * scale, 0.35 * scale, 32);
  const chest = new THREE.Mesh(chestGeom, outfitMat);
  chest.position.y = legHeight + torsoHeight * 0.6;
  chest.castShadow = true;
  group.add(chest);
  
  // Shoulders
  const shoulderGeom = new THREE.SphereGeometry(0.06 * scale, 32, 24);
  [-1, 1].forEach(side => {
    const shoulder = new THREE.Mesh(shoulderGeom, outfitMat);
    shoulder.position.set(side * 0.18 * scale, shoulderY, 0);
    shoulder.castShadow = true;
    group.add(shoulder);
  });
  
  // === ARMS ===
  const upperArmGeom = new THREE.CapsuleGeometry(0.04 * scale, armLength * 0.45, 16, 32);
  const forearmGeom = new THREE.CapsuleGeometry(0.035 * scale, armLength * 0.4, 16, 32);
  const handGeom = new THREE.SphereGeometry(0.038 * scale, 24, 16);
  
  // Left arm (pointing accusingly)
  const leftUpperArm = new THREE.Mesh(upperArmGeom, skinMat);
  leftUpperArm.position.set(-0.22 * scale, shoulderY - 0.12 * scale, 0.08 * scale);
  leftUpperArm.rotation.set(Math.PI / 5, 0, -Math.PI / 4);
  leftUpperArm.castShadow = true;
  group.add(leftUpperArm);
  
  const leftForearm = new THREE.Mesh(forearmGeom, skinMat);
  leftForearm.position.set(-0.38 * scale, shoulderY - 0.25 * scale, 0.2 * scale);
  leftForearm.rotation.set(Math.PI / 4, 0, -Math.PI / 3);
  leftForearm.castShadow = true;
  group.add(leftForearm);
  
  const leftHand = new THREE.Mesh(handGeom, skinMat);
  leftHand.position.set(-0.48 * scale, shoulderY - 0.35 * scale, 0.3 * scale);
  leftHand.castShadow = true;
  group.add(leftHand);
  
  // Pointing finger (accusatory!)
  const fingerGeom = new THREE.CapsuleGeometry(0.015 * scale, 0.08 * scale, 12, 16);
  const pointingFinger = new THREE.Mesh(fingerGeom, skinMat);
  pointingFinger.position.set(-0.52 * scale, shoulderY - 0.38 * scale, 0.38 * scale);
  pointingFinger.rotation.set(Math.PI / 3, 0, -Math.PI / 6);
  group.add(pointingFinger);
  
  // Bracelet on left wrist
  const braceletGeom = new THREE.TorusGeometry(0.045 * scale, 0.008 * scale, 12, 24);
  const bracelet = new THREE.Mesh(braceletGeom, jewelryMat);
  bracelet.position.set(-0.42 * scale, shoulderY - 0.28 * scale, 0.22 * scale);
  bracelet.rotation.x = Math.PI / 2;
  group.add(bracelet);
  
  // Right arm (on hip or holding phone)
  const rightUpperArm = new THREE.Mesh(upperArmGeom, skinMat);
  rightUpperArm.position.set(0.22 * scale, shoulderY - 0.15 * scale, -0.03 * scale);
  rightUpperArm.rotation.set(-Math.PI / 8, 0, Math.PI / 3);
  rightUpperArm.castShadow = true;
  group.add(rightUpperArm);
  
  const rightForearm = new THREE.Mesh(forearmGeom, skinMat);
  rightForearm.position.set(0.3 * scale, shoulderY - 0.35 * scale, -0.08 * scale);
  rightForearm.rotation.set(0, 0, Math.PI / 2);
  rightForearm.castShadow = true;
  group.add(rightForearm);
  
  const rightHand = new THREE.Mesh(handGeom, skinMat);
  rightHand.position.set(0.28 * scale, shoulderY - 0.5 * scale, -0.05 * scale);
  rightHand.castShadow = true;
  group.add(rightHand);
  
  // Ring on right hand
  const ringGeom = new THREE.TorusGeometry(0.018 * scale, 0.004 * scale, 8, 16);
  const ring = new THREE.Mesh(ringGeom, jewelryMat);
  ring.position.set(0.26 * scale, shoulderY - 0.52 * scale, -0.03 * scale);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  
  // Phone (for bosses or random Karens)
  if (type.isBoss || Math.random() < 0.5) {
    const phoneBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.05 * scale, 0.1 * scale, 0.008 * scale),
      phoneMat
    );
    phoneBody.position.set(0.32 * scale, shoulderY - 0.55 * scale, -0.02 * scale);
    phoneBody.rotation.x = 0.3;
    group.add(phoneBody);
    
    // Screen glow
    const screenMat = new THREE.MeshBasicMaterial({ 
      color: type.isBoss ? 0xff4444 : 0x4488ff,
    });
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.04 * scale, 0.08 * scale),
      screenMat
    );
    screen.position.set(0.32 * scale, shoulderY - 0.55 * scale, -0.014 * scale);
    screen.rotation.x = 0.3;
    group.add(screen);
  }
  
  // Purse (hanging from shoulder)
  if (Math.random() < 0.7 || type.isBoss) {
    const purseBody = new THREE.BoxGeometry(0.15 * scale, 0.1 * scale, 0.05 * scale);
    const purseMat = createLeatherMaterial(type.isBoss ? 0x8B0000 : 0x654321);
    const purse = new THREE.Mesh(purseBody, purseMat);
    purse.position.set(0.15 * scale, legHeight + 0.15 * scale, 0.1 * scale);
    purse.rotation.z = -0.2;
    purse.castShadow = true;
    group.add(purse);
    
    // Strap
    const strapGeom = new THREE.CylinderGeometry(0.01 * scale, 0.01 * scale, 0.4 * scale, 8);
    const strap = new THREE.Mesh(strapGeom, purseMat);
    strap.position.set(0.12 * scale, shoulderY - 0.1 * scale, 0.08 * scale);
    strap.rotation.z = 0.5;
    group.add(strap);
  }
  
  // === NECK ===
  const neckGeom = new THREE.CylinderGeometry(0.045 * scale, 0.055 * scale, 0.1 * scale, 32);
  const neck = new THREE.Mesh(neckGeom, skinMat);
  neck.position.y = shoulderY + 0.08 * scale;
  neck.castShadow = true;
  group.add(neck);
  
  // Necklace
  const necklaceGeom = new THREE.TorusGeometry(0.06 * scale, 0.005 * scale, 12, 32);
  const necklace = new THREE.Mesh(necklaceGeom, jewelryMat);
  necklace.position.y = shoulderY + 0.04 * scale;
  necklace.rotation.x = Math.PI / 2;
  group.add(necklace);
  
  // === HEAD ===
  const headY = shoulderY + 0.22 * scale;
  
  // Main head
  const headGeom = new THREE.SphereGeometry(headSize, 64, 48);
  const head = new THREE.Mesh(headGeom, skinMat);
  head.position.y = headY;
  head.scale.set(1, 1.1, 1);
  head.castShadow = true;
  group.add(head);
  
  // Jaw
  const jawGeom = new THREE.SphereGeometry(headSize * 0.7, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const jaw = new THREE.Mesh(jawGeom, skinMat);
  jaw.position.set(0, headY - headSize * 0.4, headSize * 0.2);
  jaw.scale.set(0.9, 0.5, 0.7);
  group.add(jaw);
  
  // === THE KAREN HAIRCUT ===
  const hairGroup = new THREE.Group();
  
  // Main volume (asymmetric bob)
  const mainHairGeom = new THREE.SphereGeometry(headSize * 1.1, 64, 48);
  const mainHair = new THREE.Mesh(mainHairGeom, hairMat);
  mainHair.position.set(0, headSize * 0.12, -headSize * 0.1);
  mainHair.scale.set(1.08, 0.92, 1.02);
  hairGroup.add(mainHair);
  
  // Top volume (poofy)
  const topGeom = new THREE.SphereGeometry(headSize * 0.85, 48, 32);
  const topHair = new THREE.Mesh(topGeom, hairMat);
  topHair.position.set(0, headSize * 0.55, 0);
  topHair.scale.set(1.25, 0.65, 1.05);
  hairGroup.add(topHair);
  
  // Asymmetric sides (classic Karen style)
  const sideGeom = new THREE.SphereGeometry(headSize * 0.45, 32, 24);
  // Left side (shorter)
  const leftSide = new THREE.Mesh(sideGeom, hairMat);
  leftSide.position.set(-headSize * 0.95, headSize * 0.05, -headSize * 0.15);
  leftSide.scale.set(0.5, 0.85, 0.65);
  hairGroup.add(leftSide);
  
  // Right side (longer, swooping)
  const rightSide = new THREE.Mesh(sideGeom, hairMat);
  rightSide.position.set(headSize * 0.9, headSize * -0.1, -headSize * 0.1);
  rightSide.scale.set(0.55, 1.0, 0.7);
  hairGroup.add(rightSide);
  
  // Swept bangs
  const bangsGeom = new THREE.SphereGeometry(headSize * 0.55, 32, 24);
  const bangs = new THREE.Mesh(bangsGeom, hairMat);
  bangs.position.set(-headSize * 0.25, headSize * 0.38, headSize * 0.65);
  bangs.scale.set(0.9, 0.32, 0.45);
  bangs.rotation.z = 0.35;
  hairGroup.add(bangs);
  
  // Boss Karen gets dramatic spiky crown
  if (type.isBoss) {
    const spikeMat = hairMat.clone();
    spikeMat.emissive = new THREE.Color(type.hairColor);
    spikeMat.emissiveIntensity = 0.2;
    
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const spikeGeom = new THREE.ConeGeometry(headSize * 0.1, headSize * 0.5, 12);
      const spike = new THREE.Mesh(spikeGeom, spikeMat);
      spike.position.set(
        Math.cos(angle) * headSize * 0.75,
        headSize * 0.5,
        Math.sin(angle) * headSize * 0.75
      );
      spike.rotation.x = Math.cos(angle) * 0.6;
      spike.rotation.z = -Math.sin(angle) * 0.6;
      hairGroup.add(spike);
    }
  }
  
  hairGroup.position.y = headY;
  group.add(hairGroup);
  
  // === FACE ===
  
  // Eyes
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ 
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0
  });
  const irisMat = new THREE.MeshStandardMaterial({ 
    color: type.isBoss ? 0xff0000 : 0x4a6c4e,
    roughness: 0.2,
    emissive: type.isBoss ? 0xff0000 : 0x000000,
    emissiveIntensity: type.isBoss ? 0.5 : 0,
  });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x050505 });
  
  const eyeWhiteGeom = new THREE.SphereGeometry(headSize * 0.1, 32, 24);
  const irisGeom = new THREE.SphereGeometry(headSize * 0.065, 24, 16);
  const pupilGeom = new THREE.SphereGeometry(headSize * 0.04, 16, 12);
  
  [-1, 1].forEach(side => {
    const eyeX = side * headSize * 0.38;
    const eyeY = headY + headSize * 0.12;
    const eyeZ = headSize * 0.88;
    
    const eyeWhite = new THREE.Mesh(eyeWhiteGeom, eyeWhiteMat);
    eyeWhite.position.set(eyeX, eyeY, eyeZ);
    eyeWhite.scale.set(1, 0.7, 0.5);
    group.add(eyeWhite);
    
    const iris = new THREE.Mesh(irisGeom, irisMat);
    iris.position.set(eyeX, eyeY, eyeZ + headSize * 0.05);
    group.add(iris);
    
    const pupil = new THREE.Mesh(pupilGeom, pupilMat);
    pupil.position.set(eyeX, eyeY, eyeZ + headSize * 0.085);
    group.add(pupil);
    
    // Angry eyebrow
    const browGeom = new THREE.CapsuleGeometry(headSize * 0.045, headSize * 0.14, 12, 16);
    const brow = new THREE.Mesh(browGeom, hairMat);
    brow.position.set(eyeX, eyeY + headSize * 0.2, eyeZ - headSize * 0.08);
    brow.rotation.z = Math.PI / 2 + (side * 0.45);
    brow.rotation.x = -0.25;
    group.add(brow);
    
    // Eyelashes
    for (let i = 0; i < 5; i++) {
      const lashGeom = new THREE.CylinderGeometry(0.003 * scale, 0.001 * scale, 0.025 * scale, 4);
      const lash = new THREE.Mesh(lashGeom, new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
      const lashAngle = ((i - 2) / 4) * 0.8;
      lash.position.set(
        eyeX + Math.sin(lashAngle) * headSize * 0.08,
        eyeY + headSize * 0.06,
        eyeZ + Math.cos(lashAngle) * headSize * 0.02
      );
      lash.rotation.x = -0.4;
      lash.rotation.z = lashAngle * 0.3;
      group.add(lash);
    }
  });
  
  // Nose
  const noseGeom = new THREE.CapsuleGeometry(headSize * 0.055, headSize * 0.12, 16, 16);
  const nose = new THREE.Mesh(noseGeom, skinMat);
  nose.position.set(0, headY - headSize * 0.03, headSize * 0.95);
  nose.rotation.x = -Math.PI / 2 + 0.4;
  group.add(nose);
  
  // Nostrils
  const nostrilGeom = new THREE.SphereGeometry(headSize * 0.025, 12, 8);
  const nostrilMat = new THREE.MeshStandardMaterial({ color: 0x2a1a1a });
  [-1, 1].forEach(side => {
    const nostril = new THREE.Mesh(nostrilGeom, nostrilMat);
    nostril.position.set(side * headSize * 0.04, headY - headSize * 0.12, headSize * 0.9);
    group.add(nostril);
  });
  
  // === ANGRY OPEN MOUTH ===
  const mouthGeom = new THREE.SphereGeometry(headSize * 0.16, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x200505 });
  const mouth = new THREE.Mesh(mouthGeom, mouthMat);
  mouth.position.set(0, headY - headSize * 0.42, headSize * 0.72);
  mouth.rotation.x = Math.PI;
  mouth.scale.set(1.25, 0.65, 0.55);
  group.add(mouth);
  
  // Lips
  const lipMat = new THREE.MeshStandardMaterial({ 
    color: 0xcc4466, 
    roughness: 0.35,
    metalness: 0.1
  });
  const lipGeom = new THREE.TorusGeometry(headSize * 0.13, headSize * 0.028, 16, 32, Math.PI);
  
  const upperLip = new THREE.Mesh(lipGeom, lipMat);
  upperLip.position.set(0, headY - headSize * 0.28, headSize * 0.85);
  upperLip.rotation.x = Math.PI / 2;
  upperLip.rotation.z = Math.PI;
  group.add(upperLip);
  
  const lowerLip = new THREE.Mesh(lipGeom, lipMat);
  lowerLip.position.set(0, headY - headSize * 0.52, headSize * 0.8);
  lowerLip.rotation.x = Math.PI / 2;
  group.add(lowerLip);
  
  // Teeth
  const teethMat = new THREE.MeshStandardMaterial({ 
    color: 0xfffef8, 
    roughness: 0.15,
    metalness: 0
  });
  
  // Upper teeth
  for (let i = 0; i < 8; i++) {
    const isCanine = i === 2 || i === 5;
    const toothH = isCanine ? headSize * 0.085 : headSize * 0.055;
    const toothGeom = (type.isBoss || isCanine)
      ? new THREE.ConeGeometry(headSize * 0.028, toothH, 8)
      : new THREE.BoxGeometry(headSize * 0.042, toothH, headSize * 0.022);
    
    const tooth = new THREE.Mesh(toothGeom, teethMat);
    const x = (i - 3.5) * headSize * 0.042;
    tooth.position.set(x, headY - headSize * 0.32, headSize * 0.78);
    if (type.isBoss || isCanine) tooth.rotation.x = Math.PI;
    group.add(tooth);
  }
  
  // Lower teeth
  for (let i = 0; i < 6; i++) {
    const toothGeom = type.isBoss
      ? new THREE.ConeGeometry(headSize * 0.022, headSize * 0.045, 6)
      : new THREE.BoxGeometry(headSize * 0.032, headSize * 0.035, headSize * 0.018);
    const tooth = new THREE.Mesh(toothGeom, teethMat);
    tooth.position.set((i - 2.5) * headSize * 0.052, headY - headSize * 0.48, headSize * 0.76);
    group.add(tooth);
  }
  
  // Earrings
  const earringGeom = new THREE.SphereGeometry(headSize * 0.085, 24, 16);
  [-1, 1].forEach(side => {
    const earring = new THREE.Mesh(earringGeom, jewelryMat);
    earring.position.set(side * headSize * 1.08, headY - headSize * 0.32, 0);
    group.add(earring);
  });
  
  // Sunglasses on head (random chance or boss)
  if (type.isBoss || Math.random() < 0.3) {
    const glassesMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.1,
      metalness: 0.5,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: type.isBoss ? 0x8B0000 : 0xffd700,
      metalness: 0.8,
      roughness: 0.2,
    });
    
    // Lenses
    const lensGeom = new THREE.SphereGeometry(headSize * 0.18, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    [-1, 1].forEach(side => {
      const lens = new THREE.Mesh(lensGeom, glassesMat);
      lens.position.set(side * headSize * 0.45, headY + headSize * 0.65, headSize * 0.3);
      lens.rotation.x = Math.PI / 2 + 0.3;
      lens.scale.set(1, 1, 0.3);
      group.add(lens);
    });
    
    // Bridge
    const bridgeGeom = new THREE.CylinderGeometry(0.008 * scale, 0.008 * scale, headSize * 0.4, 8);
    const bridge = new THREE.Mesh(bridgeGeom, frameMat);
    bridge.position.set(0, headY + headSize * 0.65, headSize * 0.35);
    bridge.rotation.z = Math.PI / 2;
    group.add(bridge);
    
    // Arms
    const armGeom = new THREE.CylinderGeometry(0.006 * scale, 0.006 * scale, headSize * 0.6, 6);
    [-1, 1].forEach(side => {
      const arm = new THREE.Mesh(armGeom, frameMat);
      arm.position.set(side * headSize * 0.7, headY + headSize * 0.6, -headSize * 0.1);
      arm.rotation.x = Math.PI / 2;
      arm.rotation.z = side * 0.15;
      group.add(arm);
    });
  }
  
  return group;
}
