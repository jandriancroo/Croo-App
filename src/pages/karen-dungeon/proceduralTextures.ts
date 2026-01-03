import * as THREE from "three";

type DungeonTextureType = "floor" | "wall";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDungeonTexture(type: DungeonTextureType, seed = 1337) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  const rand = mulberry32(seed + (type === "floor" ? 11 : 22));

  // High-contrast 90s FPS vibes: chunky grid + grime + hazard accents
  const base = type === "floor" ? "#1a0f12" : "#2a171b";
  const grid = type === "floor" ? "rgba(255,40,40,0.20)" : "rgba(255,90,40,0.18)";
  const grime = "rgba(0,0,0,0.35)";
  const highlight = "rgba(255,220,120,0.10)";

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);

  // Big chunky tiles
  const tile = type === "floor" ? 32 : 48;
  ctx.lineWidth = type === "floor" ? 3 : 4;
  ctx.strokeStyle = grid;
  for (let x = 0; x <= 256; x += tile) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y <= 256; y += tile) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  // Grime splats
  for (let i = 0; i < (type === "floor" ? 220 : 140); i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const r = (type === "floor" ? 10 : 14) * (0.25 + rand());
    ctx.fillStyle = grime;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Specular-ish highlights
  for (let i = 0; i < 60; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const w = 18 + rand() * 60;
    const h = 2 + rand() * 6;
    ctx.fillStyle = highlight;
    ctx.fillRect(x, y, w, h);
  }

  // Occasional hazard stripes (very 90s)
  if (type === "floor") {
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(-0.35);
    ctx.translate(-128, -128);
    for (let i = -2; i < 10; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,170,0,0.22)" : "rgba(0,0,0,0.20)";
      ctx.fillRect(i * 40, 186, 22, 80);
    }
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
}
