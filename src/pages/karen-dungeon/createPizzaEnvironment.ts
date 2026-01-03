import * as THREE from 'three';
import { createDungeonTexture } from './proceduralTextures';

/**
 * Creates a pizza shop dungeon environment with:
 * - Pizza ovens with glowing interiors
 * - Countertops with prep stations
 * - Neon signs
 * - Checkered floor tiles
 * - Brick walls
 */
export function createPizzaEnvironment(scene: THREE.Scene, isMobile: boolean) {
  const wallTex = createDungeonTexture('wall', 9999);
  wallTex.repeat.set(4, 2);

  const floorTex = createDungeonTexture('floor', 8888);
  floorTex.repeat.set(40, 40);

  // === MAIN FLOOR ===
  const floorGeom = new THREE.PlaneGeometry(100, 100, 20, 20);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x1a1210,
    roughness: 0.85,
    metalness: 0.05,
    map: floorTex,
  });
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Checkered tile overlay in main arena
  createCheckeredFloor(scene, 0, 0, 16, 16);

  // === PIZZA OVENS (multiple) ===
  const ovenPositions = [
    { x: -8, z: -12 },
    { x: -4, z: -12 },
    { x: 4, z: -12 },
    { x: 8, z: -12 },
  ];

  ovenPositions.forEach((pos, i) => {
    createPizzaOven(scene, pos.x, pos.z, i);
  });

  // === PREP COUNTERS ===
  const counterPositions = [
    { x: -12, z: 0, rot: 0 },
    { x: 12, z: 0, rot: Math.PI },
    { x: 0, z: 12, rot: Math.PI / 2 },
  ];

  counterPositions.forEach((pos) => {
    createPrepCounter(scene, pos.x, pos.z, pos.rot);
  });

  // === NEON SIGNS ===
  createNeonSign(scene, 0, 3.5, -14, 'PIZZA', 0xff2200);
  createNeonSign(scene, -10, 3, 8, 'HOT', 0xff6600);
  createNeonSign(scene, 10, 3, 8, 'FRESH', 0x00ff66);

  // === DUNGEON WALLS (outer perimeter) ===
  const wallHeight = 5;
  const arenaSize = 16;
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x3a2218,
    roughness: 0.9,
    metalness: 0.02,
    map: wallTex,
  });

  // Back wall with opening
  createWallWithOpening(scene, wallMat, wallHeight, arenaSize, 'back');
  createWallWithOpening(scene, wallMat, wallHeight, arenaSize, 'left');
  createWallWithOpening(scene, wallMat, wallHeight, arenaSize, 'right');
  createWallWithOpening(scene, wallMat, wallHeight, arenaSize, 'front');

  // === ADDITIONAL ROOMS / HALLWAYS ===
  const roomConfigs = [
    { x: 0, z: -25, w: 14, d: 10, theme: 'kitchen' },
    { x: -25, z: 0, w: 10, d: 14, theme: 'storage' },
    { x: 25, z: 0, w: 10, d: 14, theme: 'dining' },
    { x: 0, z: 25, w: 14, d: 10, theme: 'lobby' },
  ];

  roomConfigs.forEach((r) => {
    createRoom(scene, r.x, r.z, r.w, r.d, r.theme, wallMat, floorTex);
  });

  // === CEILING ===
  const ceilGeom = new THREE.PlaneGeometry(100, 100);
  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0x0a0505,
    roughness: 0.98,
  });
  const ceiling = new THREE.Mesh(ceilGeom, ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = wallHeight;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // === AMBIENT DETAIL: Hanging lamps ===
  const lampPositions = [
    [0, 0],
    [-6, -6],
    [6, -6],
    [-6, 6],
    [6, 6],
  ];

  lampPositions.forEach(([x, z]) => {
    createHangingLamp(scene, x, wallHeight - 0.5, z);
  });

  return { floorTex, wallTex };
}

function createCheckeredFloor(
  scene: THREE.Scene,
  cx: number,
  cz: number,
  w: number,
  d: number
) {
  const tileSize = 1;
  const tilesX = Math.floor(w / tileSize);
  const tilesZ = Math.floor(d / tileSize);

  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
  });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0x2a2222,
    roughness: 0.75,
  });

  const tileGeom = new THREE.PlaneGeometry(tileSize * 0.95, tileSize * 0.95);

  for (let i = 0; i < tilesX; i++) {
    for (let j = 0; j < tilesZ; j++) {
      const isLight = (i + j) % 2 === 0;
      const tile = new THREE.Mesh(tileGeom, isLight ? lightMat : darkMat);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(
        cx - w / 2 + i * tileSize + tileSize / 2,
        0.005,
        cz - d / 2 + j * tileSize + tileSize / 2
      );
      tile.receiveShadow = true;
      scene.add(tile);
    }
  }
}

function createPizzaOven(
  scene: THREE.Scene,
  x: number,
  z: number,
  _index: number
) {
  const group = new THREE.Group();

  // Body (brick-like)
  const bodyGeom = new THREE.BoxGeometry(2.5, 2, 2);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    roughness: 0.95,
    metalness: 0.02,
  });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 1;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Opening (dark with glow)
  const openingGeom = new THREE.BoxGeometry(1.4, 0.9, 0.2);
  const openingMat = new THREE.MeshBasicMaterial({ color: 0x110000 });
  const opening = new THREE.Mesh(openingGeom, openingMat);
  opening.position.set(0, 0.9, 1.05);
  group.add(opening);

  // Fire glow inside
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 0.8,
  });
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.7),
    glowMat
  );
  glow.position.set(0, 0.9, 0.9);
  group.add(glow);

  // Point light for fire
  const fireLight = new THREE.PointLight(0xff4400, 2, 5);
  fireLight.position.set(0, 1, 0.5);
  group.add(fireLight);

  // Chimney
  const chimneyGeom = new THREE.CylinderGeometry(0.25, 0.35, 1.5, 8);
  const chimney = new THREE.Mesh(chimneyGeom, bodyMat);
  chimney.position.set(0, 2.75, -0.5);
  chimney.castShadow = true;
  group.add(chimney);

  group.position.set(x, 0, z);
  scene.add(group);
}

function createPrepCounter(
  scene: THREE.Scene,
  x: number,
  z: number,
  rot: number
) {
  const group = new THREE.Group();

  // Counter base
  const baseGeom = new THREE.BoxGeometry(4, 0.9, 1.2);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x404040,
    roughness: 0.6,
    metalness: 0.3,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.45;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // Stainless steel top
  const topGeom = new THREE.BoxGeometry(4.1, 0.08, 1.3);
  const topMat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.3,
    metalness: 0.8,
  });
  const top = new THREE.Mesh(topGeom, topMat);
  top.position.y = 0.94;
  top.receiveShadow = true;
  group.add(top);

  // Pizza dough balls
  const doughMat = new THREE.MeshStandardMaterial({
    color: 0xf5deb3,
    roughness: 0.9,
  });
  for (let i = 0; i < 3; i++) {
    const dough = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 8),
      doughMat
    );
    dough.position.set(-1 + i * 0.8, 1.1, 0);
    dough.scale.y = 0.6;
    dough.castShadow = true;
    group.add(dough);
  }

  group.rotation.y = rot;
  group.position.set(x, 0, z);
  scene.add(group);
}

function createNeonSign(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  _text: string,
  color: number
) {
  const group = new THREE.Group();

  // Backing plate
  const plateGeom = new THREE.BoxGeometry(3, 0.8, 0.1);
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.5,
    metalness: 0.7,
  });
  const plate = new THREE.Mesh(plateGeom, plateMat);
  group.add(plate);

  // Neon tubes (simplified geometric)
  const tubeMat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < 4; i++) {
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8),
      tubeMat
    );
    tube.rotation.z = Math.PI / 2;
    tube.position.x = -0.9 + i * 0.6;
    tube.position.z = 0.08;
    group.add(tube);
  }

  // Glow light
  const neonLight = new THREE.PointLight(color, 3, 8);
  neonLight.position.z = 0.5;
  group.add(neonLight);

  // Bloom-like glow sphere (additive)
  const glowSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 8, 8),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.15,
    })
  );
  glowSphere.position.z = 0.3;
  group.add(glowSphere);

  group.position.set(x, y, z);
  group.lookAt(0, y, 0);
  scene.add(group);
}

function createWallWithOpening(
  scene: THREE.Scene,
  mat: THREE.Material,
  height: number,
  arenaSize: number,
  side: 'back' | 'left' | 'right' | 'front'
) {
  const thickness = 0.5;
  const openingWidth = 4;
  const sideLen = arenaSize;
  const sideWidth = (sideLen - openingWidth) / 2;

  const createWallPiece = (w: number, h: number, d: number) =>
    new THREE.BoxGeometry(w, h, d);

  let pos1: THREE.Vector3, pos2: THREE.Vector3, posTop: THREE.Vector3;
  let rot = 0;

  switch (side) {
    case 'back':
      pos1 = new THREE.Vector3(-sideLen / 2 + sideWidth / 2, height / 2, -arenaSize / 2);
      pos2 = new THREE.Vector3(sideLen / 2 - sideWidth / 2, height / 2, -arenaSize / 2);
      posTop = new THREE.Vector3(0, height - 0.5, -arenaSize / 2);
      break;
    case 'front':
      pos1 = new THREE.Vector3(-sideLen / 2 + sideWidth / 2, height / 2, arenaSize / 2);
      pos2 = new THREE.Vector3(sideLen / 2 - sideWidth / 2, height / 2, arenaSize / 2);
      posTop = new THREE.Vector3(0, height - 0.5, arenaSize / 2);
      break;
    case 'left':
      pos1 = new THREE.Vector3(-arenaSize / 2, height / 2, -sideLen / 2 + sideWidth / 2);
      pos2 = new THREE.Vector3(-arenaSize / 2, height / 2, sideLen / 2 - sideWidth / 2);
      posTop = new THREE.Vector3(-arenaSize / 2, height - 0.5, 0);
      rot = Math.PI / 2;
      break;
    case 'right':
      pos1 = new THREE.Vector3(arenaSize / 2, height / 2, -sideLen / 2 + sideWidth / 2);
      pos2 = new THREE.Vector3(arenaSize / 2, height / 2, sideLen / 2 - sideWidth / 2);
      posTop = new THREE.Vector3(arenaSize / 2, height - 0.5, 0);
      rot = Math.PI / 2;
      break;
  }

  const isHorizontal = side === 'back' || side === 'front';
  const wallGeom1 = createWallPiece(
    isHorizontal ? sideWidth : thickness,
    height,
    isHorizontal ? thickness : sideWidth
  );
  const wallGeom2 = createWallPiece(
    isHorizontal ? sideWidth : thickness,
    height,
    isHorizontal ? thickness : sideWidth
  );
  const topGeom = createWallPiece(
    isHorizontal ? openingWidth : thickness,
    1,
    isHorizontal ? thickness : openingWidth
  );

  const wall1 = new THREE.Mesh(wallGeom1, mat);
  wall1.position.copy(pos1);
  wall1.castShadow = true;
  wall1.receiveShadow = true;
  scene.add(wall1);

  const wall2 = new THREE.Mesh(wallGeom2, mat);
  wall2.position.copy(pos2);
  wall2.castShadow = true;
  wall2.receiveShadow = true;
  scene.add(wall2);

  const topPiece = new THREE.Mesh(topGeom, mat);
  topPiece.position.copy(posTop);
  topPiece.castShadow = true;
  scene.add(topPiece);
}

function createRoom(
  scene: THREE.Scene,
  x: number,
  z: number,
  w: number,
  d: number,
  _theme: string,
  wallMat: THREE.Material,
  floorTex: THREE.Texture
) {
  const height = 4;

  // Floor
  const floorGeom = new THREE.PlaneGeometry(w, d);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x1a1515,
    roughness: 0.88,
    map: floorTex,
  });
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0.01, z);
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  const ceil = new THREE.Mesh(
    floorGeom,
    new THREE.MeshStandardMaterial({ color: 0x0a0505, roughness: 0.95 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(x, height, z);
  scene.add(ceil);

  // Simple bounding walls (no openings for simplicity)
  const wallGeom = new THREE.BoxGeometry(w, height, 0.4);
  const sideWallGeom = new THREE.BoxGeometry(0.4, height, d);

  const backWall = new THREE.Mesh(wallGeom, wallMat);
  backWall.position.set(x, height / 2, z - d / 2);
  backWall.castShadow = true;
  scene.add(backWall);

  const frontWall = new THREE.Mesh(wallGeom, wallMat);
  frontWall.position.set(x, height / 2, z + d / 2);
  frontWall.castShadow = true;
  scene.add(frontWall);

  const leftWall = new THREE.Mesh(sideWallGeom, wallMat);
  leftWall.position.set(x - w / 2, height / 2, z);
  leftWall.castShadow = true;
  scene.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeom, wallMat);
  rightWall.position.set(x + w / 2, height / 2, z);
  rightWall.castShadow = true;
  scene.add(rightWall);

  // Room light
  const roomLight = new THREE.PointLight(0xff6633, 1.5, 15);
  roomLight.position.set(x, height - 1, z);
  scene.add(roomLight);
}

function createHangingLamp(scene: THREE.Scene, x: number, y: number, z: number) {
  const group = new THREE.Group();

  // Chain
  const chainMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    metalness: 0.8,
    roughness: 0.4,
  });
  const chain = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6),
    chainMat
  );
  chain.position.y = 0.75;
  group.add(chain);

  // Lamp shade
  const shadeGeom = new THREE.ConeGeometry(0.4, 0.3, 12, 1, true);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0x2a1a1a,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const shade = new THREE.Mesh(shadeGeom, shadeMat);
  shade.rotation.x = Math.PI;
  shade.castShadow = true;
  group.add(shade);

  // Bulb glow
  const bulbMat = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.9,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), bulbMat);
  bulb.position.y = -0.1;
  group.add(bulb);

  // Light
  const light = new THREE.PointLight(0xffaa44, 2, 12);
  light.position.y = -0.2;
  group.add(light);

  group.position.set(x, y, z);
  scene.add(group);
}
