import * as THREE from 'three';

/**
 * Sets up dramatic Duke Nukem / Narrow One style lighting:
 * - Red neon accent lights
 * - Harsh directional shadows
 * - Ambient occlusion-style darkening
 * - Spotlight drama
 */
export function setupLighting(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  isMobile: boolean
) {
  // === AMBIENT (very dim for contrast) ===
  const ambient = new THREE.AmbientLight(0x221111, 0.3);
  scene.add(ambient);

  // === HEMISPHERE (hell red from below) ===
  const hemi = new THREE.HemisphereLight(0x333333, 0x220000, 0.4);
  hemi.position.set(0, 10, 0);
  scene.add(hemi);

  // === MAIN DIRECTIONAL (harsh overhead) ===
  const shadowMapSize = isMobile ? 1024 : 2048;
  const dirLight = new THREE.DirectionalLight(0xff9966, 1.0);
  dirLight.position.set(8, 20, 8);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = shadowMapSize;
  dirLight.shadow.mapSize.height = shadowMapSize;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -25;
  dirLight.shadow.camera.right = 25;
  dirLight.shadow.camera.top = 25;
  dirLight.shadow.camera.bottom = -25;
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);

  // === PLAYER FLASHLIGHT ===
  const flashlight = new THREE.SpotLight(0xffffee, 4, 30, Math.PI / 5, 0.4, 1);
  flashlight.position.set(0, 0, 0);
  flashlight.target.position.set(0, 0, -1);
  flashlight.castShadow = !isMobile;
  if (!isMobile) {
    flashlight.shadow.mapSize.width = 512;
    flashlight.shadow.mapSize.height = 512;
  }
  camera.add(flashlight);
  camera.add(flashlight.target);

  // === RIM LIGHT (dramatic backlight) ===
  const rimLight = new THREE.SpotLight(0xff4422, 2, 12, Math.PI / 6, 0.5, 1);
  rimLight.position.set(0, 2, 1);
  rimLight.target.position.set(0, 0, -1);
  camera.add(rimLight);
  camera.add(rimLight.target);

  // === RED NEON ACCENT SPOTS (arena corners) ===
  const spotConfigs = [
    { pos: [10, 6, 10], color: 0xff2200 },
    { pos: [-10, 6, 10], color: 0xff0044 },
    { pos: [10, 6, -10], color: 0xff4400 },
    { pos: [-10, 6, -10], color: 0xff0022 },
  ];

  spotConfigs.forEach((cfg) => {
    const spot = new THREE.SpotLight(cfg.color, 3, 25, Math.PI / 5, 0.6, 1);
    spot.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    spot.target.position.set(0, 0, 0);
    scene.add(spot);
    scene.add(spot.target);
  });

  // === FLOOR GLOW ACCENTS (red lava vibe) ===
  const floorGlowPositions = [
    [5, 5],
    [-5, 5],
    [5, -5],
    [-5, -5],
    [0, 8],
    [0, -8],
    [8, 0],
    [-8, 0],
  ];

  floorGlowPositions.forEach(([x, z]) => {
    const glow = new THREE.PointLight(0xff1100, 1, 6);
    glow.position.set(x, 0.3, z);
    scene.add(glow);

    // Glowing plate mesh
    const plateMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 12),
      new THREE.MeshBasicMaterial({
        color: 0xff2200,
        transparent: true,
        opacity: 0.5,
      })
    );
    plateMesh.rotation.x = -Math.PI / 2;
    plateMesh.position.set(x, 0.02, z);
    scene.add(plateMesh);
  });

  // === VOLUMETRIC FOG BEAMS (simulated) ===
  const fogBeamMat = new THREE.MeshBasicMaterial({
    color: 0xff3322,
    transparent: true,
    opacity: 0.03,
    side: THREE.DoubleSide,
  });

  const beamPositions = [
    { x: 6, z: 6 },
    { x: -6, z: 6 },
    { x: 6, z: -6 },
    { x: -6, z: -6 },
  ];

  beamPositions.forEach((bp) => {
    const beamGeom = new THREE.ConeGeometry(3, 8, 12, 1, true);
    const beam = new THREE.Mesh(beamGeom, fogBeamMat);
    beam.position.set(bp.x, 4, bp.z);
    beam.rotation.x = Math.PI;
    scene.add(beam);
  });

  // === AO DARKENING RING (edge vignette) ===
  const aoRing = new THREE.Mesh(
    new THREE.RingGeometry(12, 50, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    })
  );
  aoRing.rotation.x = -Math.PI / 2;
  aoRing.position.y = 0.01;
  scene.add(aoRing);

  // Make sure camera is added to scene for lights to work
  scene.add(camera);

  return { dirLight, flashlight };
}
