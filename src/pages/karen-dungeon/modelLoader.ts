import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Cache for loaded models
const modelCache = new Map<string, THREE.Group>();
const textureLoader = new THREE.TextureLoader();

// PBR texture URLs from free sources (CC0)
const PBR_TEXTURES = {
  brick: {
    diffuse: 'https://cdn.polyhaven.com/asset_img/thumbs/brick_wall_001.png?width=512',
    normal: 'https://cdn.polyhaven.com/asset_img/thumbs/brick_wall_001.png?width=512',
  },
  metal: {
    diffuse: 'https://cdn.polyhaven.com/asset_img/thumbs/painted_metal_02.png?width=512',
  },
  fabric: {
    diffuse: 'https://cdn.polyhaven.com/asset_img/thumbs/fabric_pattern_07.png?width=512',
  },
};

/**
 * Creates a high-quality PBR material with procedural textures
 */
export function createPBRMaterial(options: {
  color: number;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  bumpScale?: number;
  type?: 'skin' | 'fabric' | 'metal' | 'leather' | 'hair';
}): THREE.MeshStandardMaterial {
  const {
    color,
    roughness = 0.5,
    metalness = 0,
    emissive = 0x000000,
    emissiveIntensity = 0,
    bumpScale = 0.02,
    type = 'fabric'
  } = options;

  // Create procedural normal map
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = 256;
  normalCanvas.height = 256;
  const nCtx = normalCanvas.getContext('2d')!;

  // Base normal color (pointing up)
  nCtx.fillStyle = '#8080ff';
  nCtx.fillRect(0, 0, 256, 256);

  // Add noise for surface detail based on type
  const imageData = nCtx.getImageData(0, 0, 256, 256);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % 256;
    const y = Math.floor((i / 4) / 256);
    
    let nx = 0, ny = 0;
    
    if (type === 'skin') {
      // Subtle pore-like bumps
      nx = (Math.random() - 0.5) * 10;
      ny = (Math.random() - 0.5) * 10;
      if (Math.random() < 0.02) {
        nx += (Math.random() - 0.5) * 30;
        ny += (Math.random() - 0.5) * 30;
      }
    } else if (type === 'fabric') {
      // Woven pattern
      const weaveX = Math.sin(x * 0.3) * 20;
      const weaveY = Math.sin(y * 0.3) * 20;
      nx = weaveX + (Math.random() - 0.5) * 8;
      ny = weaveY + (Math.random() - 0.5) * 8;
    } else if (type === 'metal') {
      // Scratches and brushed look
      if (Math.random() < 0.1) {
        nx = (Math.random() - 0.5) * 60;
        ny = (Math.random() - 0.5) * 15;
      }
    } else if (type === 'leather') {
      // Leather grain
      const grain = Math.sin(x * 0.1) * Math.cos(y * 0.12) * 30;
      nx = grain + (Math.random() - 0.5) * 15;
      ny = grain + (Math.random() - 0.5) * 15;
    } else if (type === 'hair') {
      // Hair strand direction
      nx = Math.sin(y * 0.2) * 40;
      ny = (Math.random() - 0.5) * 10;
    }

    data[i] = Math.max(0, Math.min(255, 128 + nx));
    data[i + 1] = Math.max(0, Math.min(255, 128 + ny));
    data[i + 2] = 255;
    data[i + 3] = 255;
  }

  nCtx.putImageData(imageData, 0, 0);
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;

  // Create roughness map with variation
  const roughnessCanvas = document.createElement('canvas');
  roughnessCanvas.width = 128;
  roughnessCanvas.height = 128;
  const rCtx = roughnessCanvas.getContext('2d')!;
  
  const baseGray = Math.floor(roughness * 255);
  rCtx.fillStyle = `rgb(${baseGray}, ${baseGray}, ${baseGray})`;
  rCtx.fillRect(0, 0, 128, 128);

  const roughnessData = rCtx.getImageData(0, 0, 128, 128);
  const rData = roughnessData.data;
  for (let i = 0; i < rData.length; i += 4) {
    const variation = (Math.random() - 0.5) * 30;
    const val = Math.max(0, Math.min(255, baseGray + variation));
    rData[i] = rData[i + 1] = rData[i + 2] = val;
  }
  rCtx.putImageData(roughnessData, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(roughnessCanvas);

  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
    normalMap,
    normalScale: new THREE.Vector2(bumpScale, bumpScale),
    roughnessMap,
  });
}

/**
 * Creates a detailed gun metal material with scratches
 */
export function createGunMetalMaterial(color: number = 0x2a2a2a): THREE.MeshStandardMaterial {
  return createPBRMaterial({
    color,
    roughness: 0.25,
    metalness: 0.9,
    type: 'metal',
    bumpScale: 0.03,
  });
}

/**
 * Creates realistic skin material
 */
export function createSkinMaterial(skinTone: number): THREE.MeshStandardMaterial {
  const mat = createPBRMaterial({
    color: skinTone,
    roughness: 0.6,
    metalness: 0,
    type: 'skin',
    bumpScale: 0.015,
  });
  
  // Add subsurface scattering simulation via emissive
  const r = ((skinTone >> 16) & 255) / 255;
  const g = ((skinTone >> 8) & 255) / 255;
  const b = (skinTone & 255) / 255;
  mat.emissive = new THREE.Color(r * 0.1, g * 0.05, b * 0.02);
  mat.emissiveIntensity = 0.15;
  
  return mat;
}

/**
 * Creates fabric/clothing material
 */
export function createFabricMaterial(color: number): THREE.MeshStandardMaterial {
  return createPBRMaterial({
    color,
    roughness: 0.7,
    metalness: 0.02,
    type: 'fabric',
    bumpScale: 0.02,
  });
}

/**
 * Creates shiny leather material
 */
export function createLeatherMaterial(color: number): THREE.MeshStandardMaterial {
  return createPBRMaterial({
    color,
    roughness: 0.45,
    metalness: 0.05,
    type: 'leather',
    bumpScale: 0.025,
  });
}

/**
 * Creates hair material with anisotropic-like highlight
 */
export function createHairMaterial(color: number): THREE.MeshStandardMaterial {
  const mat = createPBRMaterial({
    color,
    roughness: 0.6,
    metalness: 0.2,
    type: 'hair',
    bumpScale: 0.03,
  });
  return mat;
}

/**
 * Loads a GLTF model from URL with caching
 */
export async function loadGLTFModel(url: string): Promise<THREE.Group | null> {
  if (modelCache.has(url)) {
    return modelCache.get(url)!.clone();
  }

  const loader = new GLTFLoader();
  
  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        
        // Apply PBR enhancements
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            // Enhance materials
            if (child.material instanceof THREE.MeshStandardMaterial) {
              child.material.envMapIntensity = 0.8;
            }
          }
        });
        
        modelCache.set(url, model);
        resolve(model.clone());
      },
      undefined,
      (error) => {
        console.warn('Failed to load model:', url, error);
        resolve(null);
      }
    );
  });
}

/**
 * Creates grimy dungeon wall texture with PBR
 */
export function createDungeonWallMaterial(): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Dark stone base
  ctx.fillStyle = '#2a2520';
  ctx.fillRect(0, 0, 512, 512);

  // Stone blocks pattern
  const blockWidth = 64;
  const blockHeight = 32;
  
  for (let y = 0; y < 512; y += blockHeight) {
    const offset = (Math.floor(y / blockHeight) % 2) * (blockWidth / 2);
    for (let x = -blockWidth; x < 512 + blockWidth; x += blockWidth) {
      const bx = x + offset;
      
      // Vary block color
      const shade = 30 + Math.random() * 25;
      ctx.fillStyle = `rgb(${shade + 10}, ${shade + 5}, ${shade})`;
      ctx.fillRect(bx + 2, y + 2, blockWidth - 4, blockHeight - 4);
      
      // Grime spots
      for (let i = 0; i < 5; i++) {
        const gx = bx + Math.random() * blockWidth;
        const gy = y + Math.random() * blockHeight;
        const gr = 2 + Math.random() * 8;
        const alpha = 0.1 + Math.random() * 0.3;
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '20, 15, 10' : '60, 50, 40'}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Mortar lines (darker)
  ctx.strokeStyle = '#1a1510';
  ctx.lineWidth = 3;
  for (let y = 0; y <= 512; y += blockHeight) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  // Dripping stains
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * 512;
    const startY = Math.random() * 100;
    const length = 50 + Math.random() * 200;
    const gradient = ctx.createLinearGradient(x, startY, x, startY + length);
    gradient.addColorStop(0, 'rgba(40, 30, 20, 0.5)');
    gradient.addColorStop(1, 'rgba(40, 30, 20, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - 3, startY, 6, length);
  }

  const diffuseMap = new THREE.CanvasTexture(canvas);
  diffuseMap.wrapS = THREE.RepeatWrapping;
  diffuseMap.wrapT = THREE.RepeatWrapping;

  // Create normal map for depth
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = 512;
  normalCanvas.height = 512;
  const nCtx = normalCanvas.getContext('2d')!;
  nCtx.fillStyle = '#8080ff';
  nCtx.fillRect(0, 0, 512, 512);

  // Add block edge normals
  for (let y = 0; y < 512; y += blockHeight) {
    const offset = (Math.floor(y / blockHeight) % 2) * (blockWidth / 2);
    for (let x = -blockWidth; x < 512 + blockWidth; x += blockWidth) {
      const bx = x + offset;
      
      // Top edge (pointing down)
      nCtx.fillStyle = '#8060ff';
      nCtx.fillRect(bx + 4, y + 2, blockWidth - 8, 3);
      
      // Bottom edge (pointing up)
      nCtx.fillStyle = '#80a0ff';
      nCtx.fillRect(bx + 4, y + blockHeight - 5, blockWidth - 8, 3);
      
      // Left edge
      nCtx.fillStyle = '#6080ff';
      nCtx.fillRect(bx + 2, y + 4, 3, blockHeight - 8);
      
      // Right edge
      nCtx.fillStyle = '#a080ff';
      nCtx.fillRect(bx + blockWidth - 5, y + 4, 3, blockHeight - 8);
    }
  }

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;

  return new THREE.MeshStandardMaterial({
    map: diffuseMap,
    normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.85,
    metalness: 0.05,
  });
}

/**
 * Creates grimy dirt floor material
 */
export function createDirtFloorMaterial(): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Dark dirt base
  ctx.fillStyle = '#1a1612';
  ctx.fillRect(0, 0, 512, 512);

  // Layered dirt texture
  for (let layer = 0; layer < 5; layer++) {
    const particleCount = 500 + layer * 200;
    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 1 + Math.random() * (8 - layer);
      const shade = 20 + Math.random() * 40;
      ctx.fillStyle = `rgba(${shade + 15}, ${shade + 10}, ${shade}, ${0.2 + Math.random() * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cracks
  ctx.strokeStyle = '#0a0805';
  ctx.lineWidth = 2;
  for (let i = 0; i < 15; i++) {
    ctx.beginPath();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Blood/sauce stains
  for (let i = 0; i < 5; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 15 + Math.random() * 30;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(60, 10, 5, 0.6)');
    gradient.addColorStop(0.5, 'rgba(40, 8, 3, 0.3)');
    gradient.addColorStop(1, 'rgba(30, 5, 2, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const diffuseMap = new THREE.CanvasTexture(canvas);
  diffuseMap.wrapS = THREE.RepeatWrapping;
  diffuseMap.wrapT = THREE.RepeatWrapping;

  return new THREE.MeshStandardMaterial({
    map: diffuseMap,
    roughness: 0.95,
    metalness: 0,
    bumpMap: diffuseMap,
    bumpScale: 0.03,
  });
}
