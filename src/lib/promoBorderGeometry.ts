export interface EdgePoint { x: number; y: number; nx: number; ny: number; distance: number }
/** Clockwise, arc-length sampled rounded edge; normals point outside the photo. */
export function roundedEdge(width: number, height: number, radius = 24, count = 480): EdgePoint[] {
  const r = Math.min(radius, width / 2, height / 2);
  const horizontal = width - 2 * r, vertical = height - 2 * r, arc = Math.PI * r / 2;
  const lengths = [horizontal, arc, vertical, arc, horizontal, arc, vertical, arc];
  const total = lengths.reduce((a, b) => a + b, 0);
  return Array.from({ length: count }, (_, i) => {
    const distance = i * total / count;
    let d = distance, segment = 0;
    while (segment < 7 && d >= lengths[segment]) { d -= lengths[segment]; segment++; }
    if (segment === 0) return { x: r + d, y: 0, nx: 0, ny: -1, distance };
    if (segment === 2) return { x: width, y: r + d, nx: 1, ny: 0, distance };
    if (segment === 4) return { x: width - r - d, y: height, nx: 0, ny: 1, distance };
    if (segment === 6) return { x: 0, y: height - r - d, nx: -1, ny: 0, distance };
    const angle = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][(segment - 1) / 2] + d / r;
    const cx = segment === 1 || segment === 3 ? width - r : r;
    const cy = segment === 1 || segment === 7 ? r : height - r;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), nx: Math.cos(angle), ny: Math.sin(angle), distance };
  });
}
export function waveEdge(edge: EdgePoint[], amplitude: number, wavelength: number, phase = 0) {
  const first = edge[0], last = edge[edge.length - 1];
  if (!first || !last) return { points: [], cycles: 0 };
  const total = last.distance + Math.hypot(first.x - last.x, first.y - last.y);
  const cycles = Math.max(1, Math.round(total / wavelength));
  return { cycles, points: edge.map(p => {
    const offset = amplitude * Math.sin(2 * Math.PI * cycles * p.distance / total + phase);
    return { ...p, x: p.x + p.nx * offset, y: p.y + p.ny * offset };
  }) };
}
export const edgePath = (points: EdgePoint[], closed = true) => points.length ? `M${points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L')}${closed ? ' Z' : ''}` : '';