import { describe, it, expect } from 'vitest';
import { roundedEdge, waveEdge } from './promoBorderGeometry';

describe('outer-edge border geometry', () => {
  it('follows the actual 220px photo boundary on phone and desktop', () => {
    for (const width of [310, 370, 1180]) {
      const edge = roundedEdge(width, 220);
      expect(edge[0]).toMatchObject({ x: 24, y: 0, nx: 0, ny: -1 });
      expect(Math.max(...edge.map(p => p.x))).toBe(width);
      expect(Math.max(...edge.map(p => p.y))).toBe(220);
    }
  });
  it('woven garland crosses in opposite phases and stays within 10px including stroke', () => {
    const edge = roundedEdge(370, 220);
    const a = waveEdge(edge, 6, 76).points;
    const b = waveEdge(edge, 6, 76, Math.PI).points;
    a.forEach((p, i) => {
      expect((p.x + b[i].x) / 2).toBeCloseTo(edge[i].x);
      expect((p.y + b[i].y) / 2).toBeCloseTo(edge[i].y);
      expect(Math.hypot(p.x - edge[i].x, p.y - edge[i].y) + 4).toBeLessThanOrEqual(10.00001);
    });
  });
  it('alternating light bulbs stay within about 10px of the edge', () => {
    const edge = roundedEdge(370, 220);
    const wave = waveEdge(edge, 4, 84).points;
    wave.filter((_, i) => i % 15 === 0).forEach((p, j) => {
      const side = j % 2 ? 3 : -3;
      const origin = edge[j * 15];
      expect(Math.hypot(p.x + p.nx * side - origin.x, p.y + p.ny * side - origin.y) + 3.1).toBeLessThanOrEqual(10.1);
    });
  });
});