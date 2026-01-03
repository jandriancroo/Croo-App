import * as THREE from 'three';

/**
 * Creates Duke Nukem-style first-person arms holding a meatball cannon.
 * Positioned in camera space.
 */
export function createDukeArms(): THREE.Group {
  const armsGroup = new THREE.Group();

  // === MATERIALS ===
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe8c4a0,
    roughness: 0.7,
    metalness: 0,
  });

  const sleeveMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a, // Black tank top
    roughness: 0.8,
  });

  const gloveMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.6,
    metalness: 0.2,
  });

  const gunMetalMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.3,
    metalness: 0.85,
  });

  const redAccentMat = new THREE.MeshStandardMaterial({
    color: 0xcc2200,
    roughness: 0.5,
    metalness: 0.3,
    emissive: 0x440000,
    emissiveIntensity: 0.3,
  });

  // === RIGHT ARM (holding gun) ===
  const rightArm = new THREE.Group();

  // Upper arm (partially visible)
  const upperArmGeom = new THREE.CylinderGeometry(0.06, 0.07, 0.25, 12);
  const upperArm = new THREE.Mesh(upperArmGeom, skinMat);
  upperArm.rotation.x = Math.PI / 2.5;
  upperArm.position.set(0.12, -0.08, -0.15);
  rightArm.add(upperArm);

  // Sleeve cuff
  const sleeveCuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.068, 0.06, 12),
    sleeveMat
  );
  sleeveCuff.rotation.x = Math.PI / 2.5;
  sleeveCuff.position.set(0.12, -0.05, -0.08);
  rightArm.add(sleeveCuff);

  // Forearm
  const forearmGeom = new THREE.CylinderGeometry(0.05, 0.06, 0.3, 12);
  const forearm = new THREE.Mesh(forearmGeom, skinMat);
  forearm.rotation.x = Math.PI / 2.2;
  forearm.rotation.z = -0.1;
  forearm.position.set(0.14, -0.14, -0.32);
  forearm.castShadow = true;
  rightArm.add(forearm);

  // Wrist / glove
  const wrist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 0.08, 12),
    gloveMat
  );
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0.15, -0.18, -0.44);
  rightArm.add(wrist);

  // Hand (simplified block)
  const handGeom = new THREE.BoxGeometry(0.08, 0.06, 0.1);
  const hand = new THREE.Mesh(handGeom, gloveMat);
  hand.position.set(0.16, -0.2, -0.5);
  hand.rotation.x = 0.1;
  hand.castShadow = true;
  rightArm.add(hand);

  // Fingers gripping
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.01, 0.06, 6),
      gloveMat
    );
    finger.rotation.x = Math.PI / 2 + 0.2;
    finger.position.set(0.13 + i * 0.02, -0.22, -0.53);
    rightArm.add(finger);
  }

  armsGroup.add(rightArm);

  // === LEFT ARM (supporting gun) ===
  const leftArm = new THREE.Group();

  // Left forearm
  const leftForearm = new THREE.Mesh(forearmGeom, skinMat);
  leftForearm.rotation.x = Math.PI / 2.3;
  leftForearm.rotation.z = 0.15;
  leftForearm.position.set(-0.08, -0.16, -0.35);
  leftForearm.castShadow = true;
  leftArm.add(leftForearm);

  // Left wrist
  const leftWrist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.048, 0.07, 12),
    gloveMat
  );
  leftWrist.rotation.x = Math.PI / 2;
  leftWrist.position.set(-0.06, -0.19, -0.48);
  leftArm.add(leftWrist);

  // Left hand (open, supporting)
  const leftHand = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.04, 0.08),
    gloveMat
  );
  leftHand.position.set(-0.04, -0.21, -0.52);
  leftHand.rotation.y = 0.3;
  leftArm.add(leftHand);

  armsGroup.add(leftArm);

  // === MEATBALL CANNON ===
  const cannon = new THREE.Group();

  // Main barrel
  const barrelGeom = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 16);
  const barrel = new THREE.Mesh(barrelGeom, gunMetalMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.25;
  barrel.castShadow = true;
  cannon.add(barrel);

  // Barrel rings
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.06 + i * 0.008, 0.012, 8, 16),
      redAccentMat
    );
    ring.position.z = -0.1 - i * 0.12;
    cannon.add(ring);
  }

  // Muzzle flare (decorative)
  const muzzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.04, 0.08, 16),
    gunMetalMat
  );
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = -0.52;
  cannon.add(muzzle);

  // Body / receiver
  const bodyGeom = new THREE.BoxGeometry(0.12, 0.1, 0.2);
  const body = new THREE.Mesh(bodyGeom, gunMetalMat);
  body.position.set(0, -0.02, -0.05);
  body.castShadow = true;
  cannon.add(body);

  // Magazine / hopper (holds meatballs)
  const hopperGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12);
  const hopper = new THREE.Mesh(hopperGeom, gunMetalMat);
  hopper.position.set(0, 0.08, -0.05);
  hopper.castShadow = true;
  cannon.add(hopper);

  // Red LED indicator
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  led.position.set(0.06, 0.02, 0.05);
  cannon.add(led);

  // Grip
  const gripGeom = new THREE.CylinderGeometry(0.03, 0.035, 0.1, 10);
  const grip = new THREE.Mesh(
    gripGeom,
    new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 })
  );
  grip.position.set(0, -0.1, 0.02);
  grip.rotation.x = 0.2;
  cannon.add(grip);

  // Loaded meatball visible in chamber
  const loadedMeat = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 12, 10),
    new THREE.MeshStandardMaterial({
      color: 0x7a4522,
      roughness: 0.7,
      emissive: 0x220000,
      emissiveIntensity: 0.2,
    })
  );
  loadedMeat.position.z = -0.48;
  cannon.add(loadedMeat);

  cannon.position.set(0.06, -0.2, -0.4);
  cannon.rotation.x = 0.05;
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

  armsGroup.position.z = 0.08;
  armsGroup.rotation.x = 0.12;

  setTimeout(() => {
    armsGroup.position.z = originalZ;
    armsGroup.rotation.x = originalRotX;
  }, 80);
}
