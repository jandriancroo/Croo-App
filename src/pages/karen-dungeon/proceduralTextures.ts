import * as THREE from "three";

type DungeonTextureType = "floor" | "wall" | "dirt" | "brick" | "concrete";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Create high-res realistic brick wall texture (1024x1024)
export function createBrickTexture(seed = 1337): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(seed);
  
  // Dark mortar base
  ctx.fillStyle = "#1a1412";
  ctx.fillRect(0, 0, size, size);
  
  const brickW = 128;
  const brickH = 48;
  const mortarSize = 6;
  
  // Draw bricks with variation
  for (let row = 0; row < size / brickH; row++) {
    const offset = (row % 2) * (brickW / 2);
    for (let col = -1; col < size / brickW + 1; col++) {
      const x = col * brickW + offset;
      const y = row * brickH;
      
      // Random brick color (aged, varied)
      const baseR = 85 + rand() * 60;
      const baseG = 45 + rand() * 30;
      const baseB = 35 + rand() * 20;
      
      // Draw main brick body
      const gradient = ctx.createLinearGradient(x, y, x, y + brickH);
      gradient.addColorStop(0, `rgb(${baseR * 1.1}, ${baseG * 1.1}, ${baseB * 1.1})`);
      gradient.addColorStop(0.5, `rgb(${baseR}, ${baseG}, ${baseB})`);
      gradient.addColorStop(1, `rgb(${baseR * 0.7}, ${baseG * 0.7}, ${baseB * 0.7})`);
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x + mortarSize/2, y + mortarSize/2, brickW - mortarSize, brickH - mortarSize);
      
      // Brick texture/grain
      for (let i = 0; i < 40; i++) {
        const px = x + mortarSize + rand() * (brickW - mortarSize * 2);
        const py = y + mortarSize + rand() * (brickH - mortarSize * 2);
        const brightness = rand() > 0.5 ? 1.2 : 0.8;
        ctx.fillStyle = `rgba(${baseR * brightness}, ${baseG * brightness}, ${baseB * brightness}, ${0.3 + rand() * 0.3})`;
        ctx.fillRect(px, py, 2 + rand() * 4, 1 + rand() * 2);
      }
      
      // Random damage/chips
      if (rand() > 0.85) {
        const chipX = x + mortarSize + rand() * (brickW - mortarSize * 3);
        const chipY = y + mortarSize + rand() * (brickH - mortarSize * 3);
        ctx.fillStyle = "#1a1412";
        ctx.beginPath();
        ctx.arc(chipX, chipY, 3 + rand() * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Edge highlights (light from above)
      ctx.strokeStyle = `rgba(200, 180, 160, ${0.1 + rand() * 0.15})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + mortarSize/2, y + mortarSize/2);
      ctx.lineTo(x + brickW - mortarSize/2, y + mortarSize/2);
      ctx.stroke();
      
      // Bottom shadow
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.2 + rand() * 0.2})`;
      ctx.beginPath();
      ctx.moveTo(x + mortarSize/2, y + brickH - mortarSize/2);
      ctx.lineTo(x + brickW - mortarSize/2, y + brickH - mortarSize/2);
      ctx.stroke();
    }
  }
  
  // Add grime/stains
  for (let i = 0; i < 50; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, 30 + rand() * 60);
    grad.addColorStop(0, `rgba(10, 5, 0, ${0.15 + rand() * 0.2})`);
    grad.addColorStop(1, "rgba(10, 5, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - 60, y - 60, 120, 120);
  }
  
  // Water stains (vertical streaks)
  for (let i = 0; i < 15; i++) {
    const x = rand() * size;
    const startY = rand() * size * 0.3;
    const endY = startY + 200 + rand() * 400;
    const gradient = ctx.createLinearGradient(x, startY, x, endY);
    gradient.addColorStop(0, "rgba(30, 40, 35, 0)");
    gradient.addColorStop(0.3, `rgba(30, 40, 35, ${0.1 + rand() * 0.15})`);
    gradient.addColorStop(1, "rgba(30, 40, 35, 0)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 8 + rand() * 20;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x + (rand() - 0.5) * 20, endY);
    ctx.stroke();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Create high-res dirt floor texture (1024x1024)
export function createDirtFloorTexture(seed = 2468): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(seed);
  
  // Base dirt color with noise
  const baseR = 45, baseG = 35, baseB = 28;
  
  // Create gradient base
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      const variation = (rand() - 0.5) * 30;
      ctx.fillStyle = `rgb(${baseR + variation}, ${baseG + variation * 0.8}, ${baseB + variation * 0.6})`;
      ctx.fillRect(x, y, 4, 4);
    }
  }
  
  // Add fine grain noise
  for (let i = 0; i < 8000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const brightness = 0.7 + rand() * 0.6;
    ctx.fillStyle = `rgba(${baseR * brightness}, ${baseG * brightness}, ${baseB * brightness}, ${0.4 + rand() * 0.4})`;
    ctx.fillRect(x, y, 1 + rand() * 3, 1 + rand() * 3);
  }
  
  // Pebbles/stones
  for (let i = 0; i < 200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = 3 + rand() * 12;
    const stoneR = 60 + rand() * 40;
    const stoneG = 55 + rand() * 35;
    const stoneB = 50 + rand() * 30;
    
    // Stone shadow
    ctx.fillStyle = `rgba(0, 0, 0, 0.3)`;
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 2, radius, radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Stone body
    const stoneGrad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
    stoneGrad.addColorStop(0, `rgb(${stoneR * 1.3}, ${stoneG * 1.3}, ${stoneB * 1.3})`);
    stoneGrad.addColorStop(0.7, `rgb(${stoneR}, ${stoneG}, ${stoneB})`);
    stoneGrad.addColorStop(1, `rgb(${stoneR * 0.6}, ${stoneG * 0.6}, ${stoneB * 0.6})`);
    ctx.fillStyle = stoneGrad;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * 0.7, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Cracks
  for (let i = 0; i < 25; i++) {
    const startX = rand() * size;
    const startY = rand() * size;
    ctx.strokeStyle = `rgba(20, 15, 10, ${0.4 + rand() * 0.3})`;
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    
    let cx = startX, cy = startY;
    const segments = 5 + Math.floor(rand() * 8);
    for (let j = 0; j < segments; j++) {
      cx += (rand() - 0.5) * 60;
      cy += (rand() - 0.5) * 60;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  
  // Dark patches (wet spots/shadows)
  for (let i = 0; i < 30; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = 30 + rand() * 80;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgba(15, 10, 8, ${0.2 + rand() * 0.2})`);
    grad.addColorStop(1, "rgba(15, 10, 8, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Create stone/concrete texture
export function createStoneTexture(seed = 3579): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(seed);
  
  // Base gray stone
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(0, 0, size, size);
  
  // Large stone blocks
  const blockSize = 256;
  for (let by = 0; by < size; by += blockSize) {
    for (let bx = 0; bx < size; bx += blockSize) {
      const variance = 20 + rand() * 30;
      const r = 50 + variance, g = 48 + variance, b = 45 + variance;
      
      // Block fill with gradient
      const grad = ctx.createLinearGradient(bx, by, bx + blockSize, by + blockSize);
      grad.addColorStop(0, `rgb(${r * 1.1}, ${g * 1.1}, ${b * 1.1})`);
      grad.addColorStop(0.5, `rgb(${r}, ${g}, ${b})`);
      grad.addColorStop(1, `rgb(${r * 0.85}, ${g * 0.85}, ${b * 0.85})`);
      ctx.fillStyle = grad;
      ctx.fillRect(bx + 3, by + 3, blockSize - 6, blockSize - 6);
      
      // Surface texture
      for (let i = 0; i < 400; i++) {
        const x = bx + rand() * blockSize;
        const y = by + rand() * blockSize;
        const bright = rand() > 0.5 ? 1.15 : 0.85;
        ctx.fillStyle = `rgba(${r * bright}, ${g * bright}, ${b * bright}, ${0.3 + rand() * 0.4})`;
        ctx.fillRect(x, y, 2 + rand() * 6, 2 + rand() * 6);
      }
    }
  }
  
  // Grout lines
  ctx.strokeStyle = "#1a1a18";
  ctx.lineWidth = 6;
  for (let x = blockSize; x < size; x += blockSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = blockSize; y < size; y += blockSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  
  // Weathering/moss
  for (let i = 0; i < 40; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, 40 + rand() * 60);
    const isGreen = rand() > 0.7;
    if (isGreen) {
      grad.addColorStop(0, `rgba(35, 50, 30, ${0.15 + rand() * 0.15})`);
    } else {
      grad.addColorStop(0, `rgba(25, 20, 15, ${0.15 + rand() * 0.2})`);
    }
    grad.addColorStop(1, "rgba(25, 20, 15, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - 60, y - 60, 120, 120);
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Create skin-like texture for characters
export function createSkinTexture(baseColor: number, seed = 4567): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(seed);
  
  // Extract RGB from hex
  const r = (baseColor >> 16) & 0xff;
  const g = (baseColor >> 8) & 0xff;
  const b = baseColor & 0xff;
  
  // Base skin tone
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);
  
  // Subtle color variation (subsurface scattering simulation)
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const variation = (rand() - 0.5) * 15;
      const reddish = rand() * 8;
      ctx.fillStyle = `rgba(${r + variation + reddish}, ${g + variation}, ${b + variation}, 0.5)`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  
  // Pores/texture
  for (let i = 0; i < 3000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.fillStyle = `rgba(${r * 0.85}, ${g * 0.85}, ${b * 0.85}, ${0.1 + rand() * 0.15})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rand() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Create fabric texture for clothing
export function createFabricTexture(baseColor: number, seed = 5678): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(seed);
  
  const r = (baseColor >> 16) & 0xff;
  const g = (baseColor >> 8) & 0xff;
  const b = baseColor & 0xff;
  
  // Base color
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);
  
  // Weave pattern
  ctx.strokeStyle = `rgba(${r * 0.9}, ${g * 0.9}, ${b * 0.9}, 0.3)`;
  ctx.lineWidth = 1;
  for (let x = 0; x < size; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y < size; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  
  // Thread variation
  for (let i = 0; i < 2000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const bright = 0.9 + rand() * 0.2;
    ctx.fillStyle = `rgba(${r * bright}, ${g * bright}, ${b * bright}, 0.4)`;
    ctx.fillRect(x, y, 2, 1);
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Legacy function for backwards compatibility
export function createDungeonTexture(type: "floor" | "wall", seed = 1337): THREE.CanvasTexture {
  if (type === "floor") {
    return createDirtFloorTexture(seed);
  } else {
    return createBrickTexture(seed);
  }
}
