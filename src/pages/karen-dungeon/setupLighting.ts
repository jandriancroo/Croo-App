import * as THREE from 'three';

/**
 * Sets up 2005-era graphics lighting (Doom 3 / Half-Life 2 inspired):
 * - Dynamic shadow mapping
 * - Specular highlights
 * - Colored point lights
 * - Atmospheric fog
 * - Bloom simulation via emissive
 */
export function setupLighting(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  isMobile: boolean
) {
  // === SCENE FOG (atmospheric depth) ===
  scene.fog = new THREE.FogExp2(0x110808, 0.025);

  // === AMBIENT (slightly warmer for 2005 look) ===
  const ambient = new THREE.AmbientLight(0x332222, 0.4);
  scene.add(ambient);

  // === HEMISPHERE (sky/ground bounce light) ===
  const hemi = new THREE.HemisphereLight(0x444455, 0x221100, 0.5);
  hemi.position.set(0, 10, 0);
  scene.add(hemi);

  // === MAIN DIRECTIONAL (warm key light with shadows) ===
  const shadowMapSize = isMobile ? 1024 : 2048;
  const dirLight = new THREE.DirectionalLight(0xffaa77, 1.2);
  dirLight.position.set(10, 25, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = shadowMapSize;
  dirLight.shadow.mapSize.height = shadowMapSize;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 60;
  dirLight.shadow.camera.left = -30;
  dirLight.shadow.camera.right = 30;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  dirLight.shadow.bias = -0.0003;
  dirLight.shadow.normalBias = 0.02;
  scene.add(dirLight);

  // === PLAYER FLASHLIGHT (stronger, more dramatic) ===
  const flashlight = new THREE.SpotLight(0xffeedd, 6, 35, Math.PI / 4.5, 0.3, 0.8);
  flashlight.position.set(0, -0.1, 0);
  flashlight.target.position.set(0, -0.1, -1);
  flashlight.castShadow = !isMobile;
  if (!isMobile) {
    flashlight.shadow.mapSize.width = 512;
    flashlight.shadow.mapSize.height = 512;
    flashlight.shadow.bias = -0.001;
  }
  camera.add(flashlight);
  camera.add(flashlight.target);

  // === SECONDARY FILL LIGHT (softer) ===
  const fillLight = new THREE.PointLight(0x667788, 0.8, 20);
  fillLight.position.set(0, 0, -2);
  camera.add(fillLight);

  // === RED/ORANGE ACCENT LIGHTS (pizza oven glow) ===
  const spotConfigs = [
    { pos: [12, 5, 12], color: 0xff4411, intensity: 4 },
    { pos: [-12, 5, 12], color: 0xff6622, intensity: 4 },
    { pos: [12, 5, -12], color: 0xff3300, intensity: 4 },
    { pos: [-12, 5, -12], color: 0xff5500, intensity: 4 },
    { pos: [0, 4, 0], color: 0xffaa44, intensity: 3 }, // Center warm light
  ];

  spotConfigs.forEach((cfg) => {
    const spot = new THREE.SpotLight(cfg.color, cfg.intensity, 30, Math.PI / 4, 0.5, 1);
    spot.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    spot.target.position.set(0, 0, 0);
    scene.add(spot);
    scene.add(spot.target);
  });

  // === NEON SIGN LIGHTS (pizza shop atmosphere) ===
  const neonPositions = [
    { x: 8, z: 0, color: 0xff0055 },
    { x: -8, z: 0, color: 0x00ff88 },
    { x: 0, z: 8, color: 0x0088ff },
    { x: 0, z: -8, color: 0xffff00 },
  ];

  neonPositions.forEach((np) => {
    const neon = new THREE.PointLight(np.color, 2.5, 10);
    neon.position.set(np.x, 2.5, np.z);
    scene.add(neon);

    // Glowing neon tube (simple cylinder)
    const tubeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8),
      new THREE.MeshBasicMaterial({
        color: np.color,
        transparent: true,
        opacity: 0.9,
      })
    );
    tubeMesh.position.set(np.x, 2.5, np.z);
    tubeMesh.rotation.z = Math.PI / 2;
    scene.add(tubeMesh);
  });

  // === FLOOR LAVA/DANGER ACCENTS ===
  const floorGlowPositions = [
    [6, 6], [-6, 6], [6, -6], [-6, -6],
    [0, 10], [0, -10], [10, 0], [-10, 0],
    [4, -4], [-4, 4],
  ];

  floorGlowPositions.forEach(([x, z]) => {
    const glow = new THREE.PointLight(0xff2200, 1.5, 5);
    glow.position.set(x, 0.4, z);
    scene.add(glow);

    // Glowing floor plate
    const plateMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 16),
      new THREE.MeshStandardMaterial({
        color: 0xff3300,
        emissive: 0xff2200,
        emissiveIntensity: 2,
        transparent: true,
        opacity: 0.8,
      })
    );
    plateMesh.rotation.x = -Math.PI / 2;
    plateMesh.position.set(x, 0.03, z);
    scene.add(plateMesh);
  });

  // === VOLUMETRIC LIGHT CONES (2005 style) ===
  const fogBeamMat = new THREE.MeshBasicMaterial({
    color: 0xffaa66,
    transparent: true,
    opacity: 0.04,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const beamPositions = [
    { x: 8, z: 8 },
    { x: -8, z: 8 },
    { x: 8, z: -8 },
    { x: -8, z: -8 },
  ];

  beamPositions.forEach((bp) => {
    const beamGeom = new THREE.ConeGeometry(2.5, 6, 16, 1, true);
    const beam = new THREE.Mesh(beamGeom, fogBeamMat);
    beam.position.set(bp.x, 3, bp.z);
    beam.rotation.x = Math.PI;
    scene.add(beam);
  });

  // === VIGNETTE DARKENING (edge of arena) ===
  const aoRing = new THREE.Mesh(
    new THREE.RingGeometry(15, 60, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  aoRing.rotation.x = -Math.PI / 2;
  aoRing.position.y = 0.02;
  scene.add(aoRing);

  // Make sure camera is added to scene for attached lights
  scene.add(camera);

  return { dirLight, flashlight };
}
