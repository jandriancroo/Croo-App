import * as THREE from 'three';
import { createGunMetalMaterial, createSkinMaterial, createLeatherMaterial, createPBRMaterial } from './modelLoader';

/**
 * Creates Duke Nukem-style first-person arms holding a meatball cannon.
 * Now with PBR materials for realistic look.
 */
export function createDukeArms(): THREE.Group {
  const armsGroup = new THREE.Group();

  // === PBR MATERIALS ===
  const skinMat = createSkinMaterial(0xe8c4a0);
  
  const tankTopMat = createPBRMaterial({
    color: 0x1a1a1a,
    roughness: 0.75,
    metalness: 0.02,
    type: 'fabric',
  });

  const gloveMat = createLeatherMaterial(0x2a2218);
  
  const gunMetalMat = createGunMetalMaterial(0x3a3a3a);
  
  const gunMetalDarkMat = createGunMetalMaterial(0x252525);
  
  const redAccentMat = createPBRMaterial({
    color: 0xcc2200,
    roughness: 0.35,
    metalness: 0.4,
    emissive: 0x660000,
    emissiveIntensity: 0.4,
    type: 'metal',
  });

  const brassAccentMat = new THREE.MeshStandardMaterial({
    color: 0xb5a642,
    metalness: 0.9,
    roughness: 0.25,
  });

  // === RIGHT ARM (holding gun) ===
  const rightArm = new THREE.Group();

  // Upper arm (muscular)
  const upperArmGeom = new THREE.CylinderGeometry(0.055, 0.075, 0.28, 16);
  const upperArm = new THREE.Mesh(upperArmGeom, skinMat);
  upperArm.rotation.x = Math.PI / 2.5;
  upperArm.position.set(0.13, -0.06, -0.12);
  upperArm.castShadow = true;
  rightArm.add(upperArm);

  // Bicep bulge
  const bicepGeom = new THREE.SphereGeometry(0.05, 16, 12);
  const bicep = new THREE.Mesh(bicepGeom, skinMat);
  bicep.position.set(0.11, -0.04, -0.08);
  bicep.scale.set(1.2, 0.8, 1);
  rightArm.add(bicep);

  // Tank top sleeve edge
  const sleeveCuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.068, 0.04, 16),
    tankTopMat
  );
  sleeveCuff.rotation.x = Math.PI / 2.5;
  sleeveCuff.position.set(0.12, -0.04, -0.06);
  rightArm.add(sleeveCuff);

  // Forearm (beefy)
  const forearmGeom = new THREE.CylinderGeometry(0.045, 0.058, 0.32, 16);
  const forearm = new THREE.Mesh(forearmGeom, skinMat);
  forearm.rotation.x = Math.PI / 2.2;
  forearm.rotation.z = -0.1;
  forearm.position.set(0.15, -0.13, -0.32);
  forearm.castShadow = true;
  rightArm.add(forearm);

  // Forearm muscle definition
  const forearmMuscle = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.025, 0.15, 8, 12),
    skinMat
  );
  forearmMuscle.position.set(0.17, -0.1, -0.28);
  forearmMuscle.rotation.x = Math.PI / 2.3;
  rightArm.add(forearmMuscle);

  // Wrist / glove
  const wristGeom = new THREE.CylinderGeometry(0.042, 0.05, 0.1, 16);
  const wrist = new THREE.Mesh(wristGeom, gloveMat);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0.16, -0.17, -0.46);
  wrist.castShadow = true;
  rightArm.add(wrist);

  // Glove strap detail
  const strapGeom = new THREE.TorusGeometry(0.045, 0.008, 8, 24);
  const strap = new THREE.Mesh(strapGeom, new THREE.MeshStandardMaterial({
    color: 0x1a1510,
    roughness: 0.7,
  }));
  strap.position.set(0.16, -0.17, -0.42);
  strap.rotation.y = Math.PI / 2;
  rightArm.add(strap);

  // Hand (detailed grip)
  const handGeom = new THREE.BoxGeometry(0.09, 0.055, 0.11);
  const hand = new THREE.Mesh(handGeom, gloveMat);
  hand.position.set(0.17, -0.2, -0.52);
  hand.rotation.x = 0.15;
  hand.castShadow = true;
  rightArm.add(hand);

  // Fingers gripping the gun
  for (let i = 0; i < 4; i++) {
    // First knuckle
    const knuckle1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.012, 0.04, 8),
      gloveMat
    );
    knuckle1.rotation.x = Math.PI / 2 + 0.3;
    knuckle1.position.set(0.135 + i * 0.022, -0.22, -0.55);
    rightArm.add(knuckle1);
    
    // Second knuckle (curled)
    const knuckle2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.01, 0.03, 6),
      gloveMat
    );
    knuckle2.rotation.x = Math.PI / 2 + 0.8;
    knuckle2.position.set(0.135 + i * 0.022, -0.235, -0.57);
    rightArm.add(knuckle2);
  }

  // Thumb
  const thumb = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.012, 0.045, 8),
    gloveMat
  );
  thumb.rotation.z = Math.PI / 3;
  thumb.rotation.x = 0.3;
  thumb.position.set(0.2, -0.2, -0.5);
  rightArm.add(thumb);

  armsGroup.add(rightArm);

  // === LEFT ARM (supporting gun) ===
  const leftArm = new THREE.Group();

  // Left forearm
  const leftForearm = new THREE.Mesh(forearmGeom, skinMat);
  leftForearm.rotation.x = Math.PI / 2.3;
  leftForearm.rotation.z = 0.15;
  leftForearm.position.set(-0.08, -0.15, -0.38);
  leftForearm.castShadow = true;
  leftArm.add(leftForearm);

  // Left wrist / glove
  const leftWrist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.048, 0.08, 16),
    gloveMat
  );
  leftWrist.rotation.x = Math.PI / 2;
  leftWrist.position.set(-0.05, -0.18, -0.5);
  leftArm.add(leftWrist);

  // Left hand (open, supporting barrel)
  const leftHand = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.04, 0.1),
    gloveMat
  );
  leftHand.position.set(-0.03, -0.21, -0.54);
  leftHand.rotation.y = 0.25;
  leftHand.rotation.x = -0.1;
  leftArm.add(leftHand);

  // Left fingers (spread, supporting)
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.01, 0.05, 6),
      gloveMat
    );
    finger.rotation.x = Math.PI / 2 - 0.2;
    finger.rotation.z = (i - 1.5) * 0.08;
    finger.position.set(-0.06 + i * 0.025, -0.22, -0.57);
    leftArm.add(finger);
  }

  armsGroup.add(leftArm);

  // === MEATBALL CANNON (detailed PBR) ===
  const cannon = new THREE.Group();

  // Main barrel (multiple segments for detail)
  const barrelBase = new THREE.CylinderGeometry(0.065, 0.085, 0.18, 24);
  const barrelMid = new THREE.CylinderGeometry(0.055, 0.065, 0.2, 24);
  const barrelTip = new THREE.CylinderGeometry(0.045, 0.055, 0.15, 24);

  const barrel1 = new THREE.Mesh(barrelBase, gunMetalMat);
  barrel1.rotation.x = Math.PI / 2;
  barrel1.position.z = -0.1;
  barrel1.castShadow = true;
  cannon.add(barrel1);

  const barrel2 = new THREE.Mesh(barrelMid, gunMetalDarkMat);
  barrel2.rotation.x = Math.PI / 2;
  barrel2.position.z = -0.28;
  barrel2.castShadow = true;
  cannon.add(barrel2);

  const barrel3 = new THREE.Mesh(barrelTip, gunMetalMat);
  barrel3.rotation.x = Math.PI / 2;
  barrel3.position.z = -0.43;
  barrel3.castShadow = true;
  cannon.add(barrel3);

  // Barrel cooling vents
  for (let i = 0; i < 6; i++) {
    const ventGeom = new THREE.BoxGeometry(0.003, 0.015, 0.06);
    const vent = new THREE.Mesh(ventGeom, gunMetalDarkMat);
    const angle = (i / 6) * Math.PI * 2;
    vent.position.set(
      Math.cos(angle) * 0.055,
      Math.sin(angle) * 0.055,
      -0.28
    );
    vent.rotation.z = angle;
    cannon.add(vent);
  }

  // Decorative rings (brass)
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.058 + i * 0.005, 0.01, 12, 24),
      i % 2 === 0 ? brassAccentMat : redAccentMat
    );
    ring.position.z = -0.08 - i * 0.1;
    cannon.add(ring);
  }

  // Muzzle brake
  const muzzleGeom = new THREE.CylinderGeometry(0.05, 0.035, 0.08, 16);
  const muzzle = new THREE.Mesh(muzzleGeom, gunMetalMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = -0.54;
  cannon.add(muzzle);

  // Muzzle holes (vents)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
    );
    hole.rotation.x = Math.PI / 2;
    hole.position.set(
      Math.cos(angle) * 0.035,
      Math.sin(angle) * 0.035,
      -0.52
    );
    cannon.add(hole);
  }

  // Gun body / receiver
  const bodyGeom = new THREE.BoxGeometry(0.13, 0.11, 0.22);
  const body = new THREE.Mesh(bodyGeom, gunMetalMat);
  body.position.set(0, -0.02, -0.04);
  body.castShadow = true;
  cannon.add(body);

  // Side panel details
  [-1, 1].forEach(side => {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.08, 0.15),
      gunMetalDarkMat
    );
    panel.position.set(side * 0.068, -0.01, -0.04);
    cannon.add(panel);

    // Screws
    for (let i = 0; i < 3; i++) {
      const screw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.008, 8),
        brassAccentMat
      );
      screw.rotation.z = Math.PI / 2;
      screw.position.set(side * 0.07, 0.02, -0.1 + i * 0.06);
      cannon.add(screw);
    }
  });

  // Magazine / hopper (meatball container)
  const hopperGeom = new THREE.CylinderGeometry(0.055, 0.065, 0.14, 16);
  const hopper = new THREE.Mesh(hopperGeom, redAccentMat);
  hopper.position.set(0, 0.1, -0.05);
  hopper.castShadow = true;
  cannon.add(hopper);

  // Hopper glass window (to see meatballs)
  const windowGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.08, 12, 1, true);
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x443322,
    transparent: true,
    opacity: 0.6,
    roughness: 0.1,
    metalness: 0.2,
  });
  const hopperWindow = new THREE.Mesh(windowGeom, windowMat);
  hopperWindow.position.set(0, 0.1, -0.05);
  cannon.add(hopperWindow);

  // Visible meatballs in hopper
  for (let i = 0; i < 3; i++) {
    const meatballMat = new THREE.MeshStandardMaterial({
      color: 0x7a4522,
      roughness: 0.75,
      emissive: 0x220000,
      emissiveIntensity: 0.1,
    });
    const meatball = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 12, 10),
      meatballMat
    );
    meatball.position.set(
      (Math.random() - 0.5) * 0.04,
      0.08 + i * 0.03,
      -0.05 + (Math.random() - 0.5) * 0.03
    );
    cannon.add(meatball);
  }

  // LED ammo counter
  const ledPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.015, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  ledPanel.position.set(0.06, 0.02, 0.06);
  cannon.add(ledPanel);

  const led = new THREE.Mesh(
    new THREE.PlaneGeometry(0.03, 0.01),
    new THREE.MeshBasicMaterial({ 
      color: 0x00ff00,
    })
  );
  led.position.set(0.067, 0.02, 0.06);
  led.rotation.y = Math.PI / 2;
  cannon.add(led);

  // Trigger guard
  const guardGeom = new THREE.TorusGeometry(0.025, 0.006, 8, 16, Math.PI);
  const guard = new THREE.Mesh(guardGeom, gunMetalMat);
  guard.position.set(0, -0.08, 0.04);
  guard.rotation.x = Math.PI / 2;
  guard.rotation.z = Math.PI;
  cannon.add(guard);

  // Trigger
  const trigger = new THREE.Mesh(
    new THREE.BoxGeometry(0.008, 0.025, 0.015),
    gunMetalDarkMat
  );
  trigger.position.set(0, -0.07, 0.04);
  cannon.add(trigger);

  // Grip (textured)
  const gripMat = createLeatherMaterial(0x3a2a20);
  const gripGeom = new THREE.CylinderGeometry(0.028, 0.035, 0.11, 12);
  const grip = new THREE.Mesh(gripGeom, gripMat);
  grip.position.set(0, -0.11, 0.025);
  grip.rotation.x = 0.25;
  cannon.add(grip);

  // Grip texture lines
  for (let i = 0; i < 8; i++) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.002, 0.08, 0.003),
      new THREE.MeshStandardMaterial({ color: 0x2a1a10 })
    );
    const angle = (i / 8) * Math.PI * 2;
    line.position.set(
      Math.cos(angle) * 0.032,
      -0.11,
      0.025 + Math.sin(angle) * 0.032
    );
    line.rotation.y = angle;
    cannon.add(line);
  }

  // Loaded meatball in chamber
  const loadedMeat = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0x7a4522,
      roughness: 0.7,
      emissive: 0x330000,
      emissiveIntensity: 0.3,
    })
  );
  loadedMeat.position.z = -0.5;
  cannon.add(loadedMeat);

  // Sauce drip on barrel tip
  const sauceDrip = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xcc2211,
      roughness: 0.4,
      emissive: 0x440000,
      emissiveIntensity: 0.2,
    })
  );
  sauceDrip.position.set(0.02, -0.03, -0.56);
  sauceDrip.scale.set(1, 1.5, 1);
  cannon.add(sauceDrip);

  cannon.position.set(0.06, -0.2, -0.4);
  cannon.rotation.x = 0.06;
  armsGroup.add(cannon);

  // Position entire arms setup for first-person view
  armsGroup.position.set(0.1, -0.15, 0);

  return armsGroup;
}

/**
 * Animates recoil on the arms group
 */
export function animateRecoil(armsGroup: THREE.Group) {
  const originalZ = armsGroup.position.z;
  const originalRotX = armsGroup.rotation.x;

  armsGroup.position.z = 0.1;
  armsGroup.rotation.x = 0.15;

  setTimeout(() => {
    armsGroup.position.z = originalZ;
    armsGroup.rotation.x = originalRotX;
  }, 70);
}
