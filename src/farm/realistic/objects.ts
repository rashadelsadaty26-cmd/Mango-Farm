// ============================================================================
// Overhead (top-down) drawings of equipment: spray basin and landmark types.
// Pure canvas-2D helpers. Each draws around (0,0) in a local space of roughly
// +-12 units, after the caller has translated / scaled to the object's position.
// Sun comes from the upper left, so shadows fall to the lower right.
// ============================================================================

import type { Ctx } from './textures.ts';
import type { LandmarkShape } from './scene.ts';

const SHADOW = 'rgba(30,20,6,0.30)';

function softShadow(ctx: Ctx, rx: number, ry: number, dx = 3, dy = 4) {
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(dx, dy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string, stroke?: string, lw = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Concrete spray basin filling most of a tree cell, seen from above. (0,0) = cell centre. */
export function drawSprayBasin(ctx: Ctx, concrete: CanvasPattern | string, w: number, h: number, scale: number) {
  const x = -w / 2;
  const y = -h / 2;
  ctx.save();
  // cast shadow
  ctx.fillStyle = 'rgba(30,20,6,0.32)';
  rrect(ctx, x + 4, y + 5, w, h, 14);
  ctx.fill();
  // concrete rim
  rrect(ctx, x, y, w, h, 14);
  ctx.fillStyle = concrete;
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,90,86,0.85)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // inner lip
  const ix = x + 7; const iy = y + 7; const iw = w - 14; const ih = h - 14;
  rrect(ctx, ix, iy, iw, ih, 9);
  ctx.fillStyle = '#9aa3a0';
  ctx.fill();
  // water
  const wx = ix + 3; const wy = iy + 3; const ww = iw - 6; const wh = ih - 6;
  const g = ctx.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
  g.addColorStop(0, '#5cc0e0');
  g.addColorStop(1, '#1f7fae');
  rrect(ctx, wx, wy, ww, wh, 7);
  ctx.fillStyle = g;
  ctx.fill();
  // inner-wall shadow on the sun side, specular glint
  ctx.save();
  rrect(ctx, wx, wy, ww, wh, 7);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,40,70,0.28)';
  ctx.fillRect(wx, wy, ww, 4);
  ctx.fillRect(wx, wy, 4, wh);
  if (scale >= 0.45) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const yy = wy + wh * (0.25 + k * 0.17);
      ctx.beginPath();
      ctx.moveTo(wx + ww * 0.12, yy);
      ctx.quadraticCurveTo(wx + ww * 0.3, yy - 2.2, wx + ww * 0.48, yy);
      ctx.quadraticCurveTo(wx + ww * 0.66, yy + 2.2, wx + ww * 0.84, yy);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(wx + ww * 0.3, wy + wh * 0.22, ww * 0.12, wh * 0.06, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // supply pipe + nozzle (top right)
  ctx.fillStyle = '#6a7480';
  rrect(ctx, x + w - 17, y - 5, 7, 15, 2);
  ctx.fill();
  disc(ctx, x + w - 13.5, y + 9, 4.2, '#4b5560', '#2f3841', 0.8);
  ctx.restore();
}

/** Draws one landmark at (0,0). `shape` decides the overhead appearance. */
export function drawLandmarkShape(ctx: Ctx, shape: LandmarkShape) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (shape) {
    case 'tap': {
      // Wet patch under the tap, base plate, brass valve, pipe and red handle.
      ctx.fillStyle = 'rgba(35,62,82,0.32)';
      ctx.beginPath(); ctx.ellipse(2, 3, 15, 11, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(70,120,150,0.30)';
      ctx.beginPath(); ctx.ellipse(2, 3, 9, 6.5, 0.3, 0, Math.PI * 2); ctx.fill();
      softShadow(ctx, 7, 6, 2, 3);
      disc(ctx, 0, 0, 7, '#98a1aa', '#5b636b', 1);
      ctx.strokeStyle = '#6b7380'; ctx.lineWidth = 3.6;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, 1); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(1, -0.8); ctx.lineTo(11, 0.2); ctx.stroke();
      disc(ctx, 0, 0, 3.7, '#c9a04a', '#7d5e1c', 1);
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-5, -3); ctx.lineTo(5, 3); ctx.stroke();
      break;
    }
    case 'basin': {
      softShadow(ctx, 13, 10);
      rrect(ctx, -12, -9, 24, 18, 5); ctx.fillStyle = '#d3dad6'; ctx.fill(); ctx.strokeStyle = '#7d8b86'; ctx.lineWidth = 1.2; ctx.stroke();
      rrect(ctx, -9, -6, 18, 12, 3.5); ctx.fillStyle = '#3d9bc6'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-6, -1); ctx.quadraticCurveTo(-3, -3, 0, -1); ctx.quadraticCurveTo(3, 1, 6, -1); ctx.stroke();
      break;
    }
    case 'tank': {
      softShadow(ctx, 12, 11, 4, 5);
      disc(ctx, 0, 0, 11, '#a3adb5', '#6b767f', 1.2);
      ctx.strokeStyle = 'rgba(80,92,102,0.55)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
      disc(ctx, 0, 0, 2.6, '#66717a', '#3f484f', 0.8);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, 9.4, Math.PI * 1.05, Math.PI * 1.55); ctx.stroke();
      break;
    }
    case 'pole': {
      // Long cast shadow of the pole and lamp arm, then base, arm and lamp head with a soft glow.
      ctx.strokeStyle = SHADOW; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(15, 19); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(15, 19); ctx.lineTo(9, 24); ctx.stroke();
      disc(ctx, 0, 0, 4.6, '#7b838b', '#454c53', 1);
      disc(ctx, 0, 0, 2, '#3f464d');
      ctx.strokeStyle = '#59616a'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, -6); ctx.stroke();
      const glow = ctx.createRadialGradient(-8, -6, 1, -8, -6, 13);
      glow.addColorStop(0, 'rgba(255,236,150,0.42)'); glow.addColorStop(1, 'rgba(255,236,150,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(-8, -6, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f6e9a6'; ctx.strokeStyle = '#8d7f3c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(-8, -6, 4.8, 3.4, 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'electric': {
      softShadow(ctx, 9, 7, 3, 4);
      rrect(ctx, -8, -6, 16, 12, 1.6); ctx.fillStyle = '#8f98a0'; ctx.fill(); ctx.strokeStyle = '#555e66'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#aab3ba'; ctx.fillRect(-4.5, -4, 11.5, 8);
      ctx.fillStyle = '#e8b92a'; ctx.fillRect(-7.2, -5.2, 2.2, 10.4);
      ctx.fillStyle = '#2f353b';
      ctx.beginPath(); ctx.moveTo(1, -3); ctx.lineTo(-1.6, 0.6); ctx.lineTo(0.4, 0.6); ctx.lineTo(-0.8, 3.2); ctx.lineTo(2.6, -0.8); ctx.lineTo(0.6, -0.8); ctx.closePath(); ctx.fill();
      break;
    }
    case 'building': {
      ctx.fillStyle = SHADOW; ctx.fillRect(-11, -7, 26, 20);
      ctx.fillStyle = '#b8684c'; ctx.fillRect(-13, -9.5, 26, 19);
      ctx.strokeStyle = '#7c3f2c'; ctx.lineWidth = 1.2; ctx.strokeRect(-13, -9.5, 26, 19);
      ctx.strokeStyle = '#d28a6c'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.stroke();
      ctx.strokeStyle = 'rgba(80,36,22,0.35)'; ctx.lineWidth = 0.8;
      for (let k = -9; k <= 9; k += 4.5) { ctx.beginPath(); ctx.moveTo(k, -9.5); ctx.lineTo(k, 9.5); ctx.stroke(); }
      break;
    }
    case 'gate': {
      ctx.fillStyle = SHADOW; ctx.fillRect(-9, 2, 20, 4);
      ctx.fillStyle = '#6b5a3c'; ctx.fillRect(-11, -3, 5, 6); ctx.fillRect(6, -3, 5, 6);
      ctx.strokeStyle = '#9a8660'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.strokeStyle = '#5a4a30'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
      break;
    }
    case 'tools': {
      softShadow(ctx, 10, 8, 3, 4);
      rrect(ctx, -8, -6, 16, 12, 1.5); ctx.fillStyle = '#a66b3a'; ctx.fill(); ctx.strokeStyle = '#6e4220'; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = 'rgba(70,40,18,0.6)'; ctx.lineWidth = 0.9;
      for (const yy of [-2, 2]) { ctx.beginPath(); ctx.moveTo(-8, yy); ctx.lineTo(8, yy); ctx.stroke(); }
      break;
    }
    case 'fuel': {
      softShadow(ctx, 8, 7, 3, 4);
      disc(ctx, 0, 0, 6.5, '#c0392b', '#7b241c', 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, Math.PI * 2); ctx.stroke();
      disc(ctx, 0, 0, 1.7, '#e8d9a0', '#7b241c', 0.7);
      break;
    }
    case 'flag': {
      ctx.strokeStyle = SHADOW; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9, 11); ctx.stroke();
      ctx.fillStyle = 'rgba(30,20,6,0.25)'; ctx.beginPath(); ctx.moveTo(9, 11); ctx.lineTo(19, 9); ctx.lineTo(13, 15); ctx.closePath(); ctx.fill();
      disc(ctx, 0, 0, 2.2, '#4b5058');
      ctx.fillStyle = '#d6372b'; ctx.strokeStyle = '#8a1f17'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(11, -4); ctx.lineTo(1, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'plant': {
      softShadow(ctx, 10, 8, 3, 4);
      const blobs: Array<[number, number, number, string]> = [[-4, 2, 5.5, '#3f7a31'], [4, 2, 5.5, '#4a8736'], [0, -4, 6, '#5a9540'], [0, 2, 5, '#366b2b']];
      for (const [x, y, r, c] of blobs) disc(ctx, x, y, r, c);
      disc(ctx, -2, -4, 2.4, 'rgba(190,220,110,0.6)');
      break;
    }
    case 'marker':
    default: {
      softShadow(ctx, 8, 7, 2, 3);
      disc(ctx, 0, 0, 7, '#ef8a24', '#ffffff', 1.5);
      disc(ctx, 0, 0, 3.8, '#fff1dc');
      disc(ctx, 0, 0, 1.5, '#c2570c');
      break;
    }
  }
  ctx.restore();
}
