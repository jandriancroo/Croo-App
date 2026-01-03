import * as THREE from 'three';
import { createSkinTexture, createFabricTexture } from './proceduralTextures';

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
 * Creates a realistic Karen 3D model inspired by Quaternius-style characters.
 * Smooth, humanoid proportions with detailed features - NOT low-poly lego style.
 */
export function createKarenModel(type: KarenType): THREE.Group {
  const group = new THREE.Group();
  const scale = type.size;
  
  // High-quality materials with textures
  const skinTex = createSkinTexture(type.skinTone, type.skinTone);
  const skinMat = new THREE.MeshStandardMaterial({
    color: type.skinTone,
    map: skinTex,
    roughness: 0.55,
    metalness: 0,
  });
  
  const fabricTex = createFabricTexture(type.outfit, type.outfit);
  const outfitMat = new THREE.MeshStandardMaterial({
    color: type.outfit,
    map: fabricTex,
    roughness: 0.65,
    metalness: 0.05,
  });
  
  const hairMat = new THREE.MeshStandardMaterial({
    color: type.hairColor,
    roughness: 0.75,
    metalness: 0.15,
  });
  
  // Body proportions (more realistic, Quaternius-style)
  const bodyHeight = 1.8 * scale;
  const headSize = 0.22 * scale;
  const torsoHeight = 0.5 * scale;
  const legHeight = 0.75 * scale;
  const armLength = 0.55 * scale;
  
  // === LEGS (smooth, realistic proportions) ===
  const hipWidth = 0.2 * scale;
  const thighRadius = 0.07 * scale;
  const calfRadius = 0.055 * scale;
  
  // Thighs
  const thighGeom = new THREE.CapsuleGeometry(thighRadius, legHeight * 0.45, 12, 24);
  [-1, 1].forEach(side => {
    const thigh = new THREE.Mesh(thighGeom, outfitMat);
    thigh.position.set(side * hipWidth * 0.5, legHeight * 0.55, 0);
    thigh.castShadow = true;
    group.add(thigh);
  });
  
  // Calves
  const calfGeom = new THREE.CapsuleGeometry(calfRadius, legHeight * 0.4, 12, 24);
  [-1, 1].forEach(side => {
    const calf = new THREE.Mesh(calfGeom, skinMat);
    calf.position.set(side * hipWidth * 0.5, legHeight * 0.2, 0);
    calf.castShadow = true;
    group.add(calf);
  });
  
  // Feet
  const footGeom = new THREE.BoxGeometry(0.08 * scale, 0.04 * scale, 0.14 * scale);
  footGeom.translate(0, 0, 0.02 * scale);
  const shoeMat = new THREE.MeshStandardMaterial({ 
    color: 0x1a1a1a, 
    roughness: 0.4,
    metalness: 0.1
  });
  [-1, 1].forEach(side => {
    const foot = new THREE.Mesh(footGeom, shoeMat);
    foot.position.set(side * hipWidth * 0.5, 0.02 * scale, 0);
    foot.castShadow = true;
    group.add(foot);
  });
  
  // === PELVIS / HIPS (smooth transition) ===
  const pelvisGeom = new THREE.SphereGeometry(0.18 * scale, 32, 24);
  const pelvis = new THREE.Mesh(pelvisGeom, outfitMat);
  pelvis.position.y = legHeight + 0.05 * scale;
  pelvis.scale.set(1.1, 0.6, 0.9);
  pelvis.castShadow = true;
  group.add(pelvis);
  
  // === TORSO (smooth, feminine shape) ===
  // Lower torso (waist)
  const waistGeom = new THREE.CylinderGeometry(
    0.12 * scale, // top
    0.15 * scale, // bottom
    0.2 * scale,
    32
  );
  const waist = new THREE.Mesh(waistGeom, outfitMat);
  waist.position.y = legHeight + 0.2 * scale;
  waist.castShadow = true;
  group.add(waist);
  
  // Upper torso (chest area)
  const chestGeom = new THREE.CylinderGeometry(
    0.14 * scale, // top (shoulders)
    0.12 * scale, // bottom (waist)
    0.35 * scale,
    32
  );
  const chest = new THREE.Mesh(chestGeom, outfitMat);
  chest.position.y = legHeight + torsoHeight * 0.6;
  chest.castShadow = true;
  group.add(chest);
  
  // Shoulders (smooth spheres)
  const shoulderGeom = new THREE.SphereGeometry(0.06 * scale, 24, 16);
  const shoulderY = legHeight + torsoHeight * 0.85;
  [-1, 1].forEach(side => {
    const shoulder = new THREE.Mesh(shoulderGeom, outfitMat);
    shoulder.position.set(side * 0.18 * scale, shoulderY, 0);
    shoulder.castShadow = true;
    group.add(shoulder);
  });
  
  // === ARMS (smooth, natural pose) ===
  const upperArmGeom = new THREE.CapsuleGeometry(0.04 * scale, armLength * 0.45, 12, 24);
  const forearmGeom = new THREE.CapsuleGeometry(0.035 * scale, armLength * 0.4, 12, 24);
  const handGeom = new THREE.SphereGeometry(0.035 * scale, 16, 12);
  
  // Left arm (pointing accusingly)
  const leftUpperArm = new THREE.Mesh(upperArmGeom, skinMat);
  leftUpperArm.position.set(-0.22 * scale, shoulderY - 0.12 * scale, 0.05 * scale);
  leftUpperArm.rotation.set(Math.PI / 6, 0, -Math.PI / 4);
  leftUpperArm.castShadow = true;
  group.add(leftUpperArm);
  
  const leftForearm = new THREE.Mesh(forearmGeom, skinMat);
  leftForearm.position.set(-0.35 * scale, shoulderY - 0.25 * scale, 0.15 * scale);
  leftForearm.rotation.set(Math.PI / 4, 0, -Math.PI / 3);
  leftForearm.castShadow = true;
  group.add(leftForearm);
  
  const leftHand = new THREE.Mesh(handGeom, skinMat);
  leftHand.position.set(-0.45 * scale, shoulderY - 0.35 * scale, 0.25 * scale);
  leftHand.castShadow = true;
  group.add(leftHand);
  
  // Pointing finger
  const fingerGeom = new THREE.CapsuleGeometry(0.012 * scale, 0.06 * scale, 8, 12);
  const pointingFinger = new THREE.Mesh(fingerGeom, skinMat);
  pointingFinger.position.set(-0.49 * scale, shoulderY - 0.37 * scale, 0.32 * scale);
  pointingFinger.rotation.set(Math.PI / 3, 0, -Math.PI / 6);
  group.add(pointingFinger);
  
  // Right arm (on hip)
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
  
  // === NECK ===
  const neckGeom = new THREE.CylinderGeometry(0.045 * scale, 0.055 * scale, 0.1 * scale, 24);
  const neck = new THREE.Mesh(neckGeom, skinMat);
  neck.position.y = shoulderY + 0.08 * scale;
  neck.castShadow = true;
  group.add(neck);
  
  // === HEAD (smooth, realistic) ===
  const headY = shoulderY + 0.22 * scale;
  
  // Main head sphere
  const headGeom = new THREE.SphereGeometry(headSize, 48, 32);
  const head = new THREE.Mesh(headGeom, skinMat);
  head.position.y = headY;
  head.scale.set(1, 1.1, 1);
  head.castShadow = true;
  group.add(head);
  
  // Jaw/chin (subtle)
  const jawGeom = new THREE.SphereGeometry(headSize * 0.7, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const jaw = new THREE.Mesh(jawGeom, skinMat);
  jaw.position.set(0, headY - headSize * 0.4, headSize * 0.2);
  jaw.scale.set(0.9, 0.5, 0.7);
  group.add(jaw);
  
  // === KAREN HAIRCUT (The Manager Special) ===
  const hairGroup = new THREE.Group();
  
  // Main hair volume (smooth bob shape)
  const hairBase = new THREE.SphereGeometry(headSize * 1.08, 48, 32);
  const mainHair = new THREE.Mesh(hairBase, hairMat);
  mainHair.position.set(0, headSize * 0.1, -headSize * 0.1);
  mainHair.scale.set(1.05, 0.9, 1);
  hairGroup.add(mainHair);
  
  // Layered top volume
  const topHairGeom = new THREE.SphereGeometry(headSize * 0.8, 32, 24);
  const topHair = new THREE.Mesh(topHairGeom, hairMat);
  topHair.position.set(0, headSize * 0.5, 0);
  topHair.scale.set(1.2, 0.6, 1);
  hairGroup.add(topHair);
  
  // Asymmetric side layers
  const sideLayerGeom = new THREE.SphereGeometry(headSize * 0.4, 24, 16);
  [-1, 1].forEach((side, i) => {
    const sideLayer = new THREE.Mesh(sideLayerGeom, hairMat);
    sideLayer.position.set(
      side * headSize * 0.9,
      headSize * (i === 0 ? 0.1 : -0.1), // Asymmetric
      -headSize * 0.2
    );
    sideLayer.scale.set(0.5, 0.8, 0.6);
    hairGroup.add(sideLayer);
  });
  
  // Swept bangs
  const bangsGeom = new THREE.SphereGeometry(headSize * 0.5, 24, 16);
  const bangs = new THREE.Mesh(bangsGeom, hairMat);
  bangs.position.set(-headSize * 0.3, headSize * 0.35, headSize * 0.6);
  bangs.scale.set(0.8, 0.3, 0.4);
  bangs.rotation.z = 0.3;
  hairGroup.add(bangs);
  
  // Boss gets extra dramatic hair
  if (type.isBoss) {
    const spikyMat = new THREE.MeshStandardMaterial({
      color: type.hairColor,
      roughness: 0.6,
      emissive: type.hairColor,
      emissiveIntensity: 0.15
    });
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(headSize * 0.12, headSize * 0.4, 8),
        spikyMat
      );
      spike.position.set(
        Math.cos(angle) * headSize * 0.7,
        headSize * 0.4,
        Math.sin(angle) * headSize * 0.7
      );
      spike.rotation.x = Math.cos(angle) * 0.5;
      spike.rotation.z = -Math.sin(angle) * 0.5;
      hairGroup.add(spike);
    }
  }
  
  hairGroup.position.y = headY;
  group.add(hairGroup);
  
  // === FACE FEATURES ===
  
  // Eyes (realistic with depth)
  const eyeSocketGeom = new THREE.SphereGeometry(headSize * 0.12, 24, 16);
  const eyeWhiteGeom = new THREE.SphereGeometry(headSize * 0.1, 24, 16);
  const irisGeom = new THREE.SphereGeometry(headSize * 0.06, 16, 12);
  const pupilGeom = new THREE.SphereGeometry(headSize * 0.035, 12, 8);
  
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ 
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0
  });
  const irisMat = new THREE.MeshStandardMaterial({ 
    color: type.isBoss ? 0xff0000 : 0x4a8c4e,
    roughness: 0.2
  });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a });
  
  [-1, 1].forEach(side => {
    const eyeX = side * headSize * 0.35;
    const eyeY = headY + headSize * 0.1;
    const eyeZ = headSize * 0.85;
    
    // Eye white
    const eyeWhite = new THREE.Mesh(eyeWhiteGeom, eyeWhiteMat);
    eyeWhite.position.set(eyeX, eyeY, eyeZ);
    eyeWhite.scale.set(1, 0.65, 0.5);
    group.add(eyeWhite);
    
    // Iris
    const iris = new THREE.Mesh(irisGeom, irisMat);
    iris.position.set(eyeX, eyeY, eyeZ + headSize * 0.05);
    group.add(iris);
    
    // Pupil
    const pupil = new THREE.Mesh(pupilGeom, pupilMat);
    pupil.position.set(eyeX, eyeY, eyeZ + headSize * 0.08);
    group.add(pupil);
    
    // Angry eyebrows
    const browGeom = new THREE.CapsuleGeometry(headSize * 0.04, headSize * 0.12, 8, 12);
    const brow = new THREE.Mesh(browGeom, hairMat);
    brow.position.set(eyeX, eyeY + headSize * 0.18, eyeZ - headSize * 0.1);
    brow.rotation.z = Math.PI / 2 + (side * 0.4);
    brow.rotation.x = -0.2;
    group.add(brow);
  });
  
  // Nose (subtle, realistic)
  const noseGeom = new THREE.CapsuleGeometry(headSize * 0.06, headSize * 0.1, 12, 12);
  const nose = new THREE.Mesh(noseGeom, skinMat);
  nose.position.set(0, headY - headSize * 0.05, headSize * 0.9);
  nose.rotation.x = -Math.PI / 2 + 0.4;
  group.add(nose);
  
  // === MOUTH (open, angry) ===
  const mouthGeom = new THREE.SphereGeometry(headSize * 0.15, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x2a0505 });
  const mouth = new THREE.Mesh(mouthGeom, mouthMat);
  mouth.position.set(0, headY - headSize * 0.4, headSize * 0.7);
  mouth.rotation.x = Math.PI;
  mouth.scale.set(1.2, 0.6, 0.5);
  group.add(mouth);
  
  // Lips
  const lipGeom = new THREE.TorusGeometry(headSize * 0.12, headSize * 0.025, 12, 24, Math.PI);
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xcc4466, roughness: 0.4 });
  
  const upperLip = new THREE.Mesh(lipGeom, lipMat);
  upperLip.position.set(0, headY - headSize * 0.28, headSize * 0.82);
  upperLip.rotation.x = Math.PI / 2;
  upperLip.rotation.z = Math.PI;
  group.add(upperLip);
  
  const lowerLip = new THREE.Mesh(lipGeom, lipMat);
  lowerLip.position.set(0, headY - headSize * 0.48, headSize * 0.78);
  lowerLip.rotation.x = Math.PI / 2;
  group.add(lowerLip);
  
  // TEETH (sharp and menacing)
  const teethMat = new THREE.MeshStandardMaterial({ color: 0xfffef5, roughness: 0.2 });
  
  // Upper teeth
  for (let i = 0; i < 8; i++) {
    const isCanine = i === 2 || i === 5;
    const toothH = isCanine ? headSize * 0.08 : headSize * 0.05;
    const toothGeom = type.isBoss || isCanine
      ? new THREE.ConeGeometry(headSize * 0.025, toothH, 6)
      : new THREE.BoxGeometry(headSize * 0.04, toothH, headSize * 0.02);
    
    const tooth = new THREE.Mesh(toothGeom, teethMat);
    const x = (i - 3.5) * headSize * 0.04;
    tooth.position.set(x, headY - headSize * 0.32, headSize * 0.78);
    if (type.isBoss || isCanine) tooth.rotation.x = Math.PI;
    group.add(tooth);
  }
  
  // Lower teeth
  for (let i = 0; i < 6; i++) {
    const toothGeom = type.isBoss
      ? new THREE.ConeGeometry(headSize * 0.02, headSize * 0.04, 5)
      : new THREE.BoxGeometry(headSize * 0.03, headSize * 0.03, headSize * 0.015);
    const tooth = new THREE.Mesh(toothGeom, teethMat);
    tooth.position.set((i - 2.5) * headSize * 0.05, headY - headSize * 0.46, headSize * 0.76);
    group.add(tooth);
  }
  
  // Earrings
  const earringGeom = new THREE.SphereGeometry(headSize * 0.08, 16, 12);
  const earringMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    metalness: 0.95,
    roughness: 0.1
  });
  [-1, 1].forEach(side => {
    const earring = new THREE.Mesh(earringGeom, earringMat);
    earring.position.set(side * headSize * 1.05, headY - headSize * 0.3, 0);
    group.add(earring);
  });
  
  // Phone in hand (for bosses)
  if (type.isBoss) {
    const phoneGeom = new THREE.BoxGeometry(0.06 * scale, 0.12 * scale, 0.01 * scale);
    const phoneMat = new THREE.MeshStandardMaterial({ 
      color: 0x1a1a1a, 
      metalness: 0.8,
      roughness: 0.2 
    });
    const phone = new THREE.Mesh(phoneGeom, phoneMat);
    phone.position.set(0.28 * scale, shoulderY - 0.52 * scale, -0.02 * scale);
    phone.rotation.x = 0.3;
    group.add(phone);
    
    // Phone screen glow
    const screenGeom = new THREE.PlaneGeometry(0.05 * scale, 0.1 * scale);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
    const screen = new THREE.Mesh(screenGeom, screenMat);
    screen.position.set(0.28 * scale, shoulderY - 0.52 * scale, -0.013 * scale);
    screen.rotation.x = 0.3;
    group.add(screen);
  }
  
  return group;
}
