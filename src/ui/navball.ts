import type { NavballVectors, Quat, Vec3 } from '../rules/orbital';
import { lvlhBasis, projectNavballVector, worldToBody } from '../rules/orbital';

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Navball 3D prosedural berbasis HTML5 Canvas 2D:
 * Menampilkan bola sikap LVLH (langit biru / tanah cokelat, cincin pitch, kompas N/E/S/W)
 * beserta 7 penanda vektor orbit: Prograde, Retrograde, Normal, Anti-Normal, Radial Out/In, dan Maneuver.
 */
export class NavballWidget {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sizePx: number;

  constructor(sizePx = 136) {
    this.sizePx = sizePx;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'navball-canvas';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = sizePx * dpr;
    this.canvas.height = sizePx * dpr;
    this.canvas.style.width = `${sizePx}px`;
    this.canvas.style.height = `${sizePx}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable for Navball');
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);
  }

  render(r: Vec3, att: Quat, navball: NavballVectors, showManeuver = true): void {
    const ctx = this.ctx;
    const s = this.sizePx;
    const cx = s * 0.5;
    const cy = s * 0.5;
    const rad = s * 0.45;

    ctx.clearRect(0, 0, s, s);
    ctx.save();

    // Klip lingkaran bola Navball
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TWO_PI);
    ctx.clip();

    // Isi dasar belahan tanah
    ctx.fillStyle = '#5a3d24';
    ctx.fillRect(0, 0, s, s);

    // Hitung vektor zenith lokal (Up) di kerangka bodi wahana
    const { up, east, north } = lvlhBasis(r);
    const uBody = worldToBody(att, up);
    // Di kanvas 2D: +X ke kanan (bx), +Y ke bawah (-by), +Z ke luar layar (bz)
    const uCanvasX = uBody.x;
    const uCanvasY = -uBody.y;
    const rollAngle = Math.atan2(uCanvasX, -uCanvasY);
    const uz = uBody.z; // sin(pitch): +1 jika menghadap lurus ke atas (zenit)

    // Gambar belahan langit (u . p >= 0) secara eksak
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rollAngle);
    ctx.beginPath();
    ctx.arc(0, 0, rad, Math.PI, 0, false); // tepi busur atas (-rad .. +rad)
    const horizonRy = Math.abs(uz) * rad;
    if (horizonRy < 0.5) {
      ctx.lineTo(-rad, 0);
    } else if (uz >= 0) {
      // Zenit di depan: langit menjorok ke bawah melintasi ekuator (+y')
      ctx.ellipse(0, 0, rad, horizonRy, 0, 0, Math.PI, false);
    } else {
      // Zenit di belakang: langit hanya menyisakan topi di atas (-y')
      ctx.ellipse(0, 0, rad, horizonRy, 0, 0, Math.PI, true);
    }
    ctx.closePath();
    ctx.fillStyle = '#1e6ca8';
    ctx.fill();
    ctx.restore();

    // Gambar grid pitch (-60°, -30°, 0°, +30°, +60°) & garis bujur kompas
    this.drawSphereGrid(cx, cy, rad, att, up, east, north);

    // Gambar 7 penanda vektor Navball
    this.drawMarker(cx, cy, rad, att, navball.prograde, 'prograde');
    this.drawMarker(cx, cy, rad, att, navball.retrograde, 'retrograde');
    this.drawMarker(cx, cy, rad, att, navball.normal, 'normal');
    this.drawMarker(cx, cy, rad, att, navball.antiNormal, 'antiNormal');
    this.drawMarker(cx, cy, rad, att, navball.radialOut, 'radialOut');
    this.drawMarker(cx, cy, rad, att, navball.radialIn, 'radialIn');
    if (showManeuver) {
      this.drawMarker(cx, cy, rad, att, navball.maneuver, 'maneuver');
    }

    ctx.restore();

    // Bingkai luar Navball + tanda sayap pusat (- v -)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TWO_PI);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.stroke();

    // Penunjuk arah hidung wahana tetap di tengah
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.lineTo(cx, cy + 5);
    ctx.lineTo(cx + 5, cy);
    ctx.lineTo(cx + 14, cy);
    ctx.stroke();
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.8, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  private drawSphereGrid(
    cx: number,
    cy: number,
    rad: number,
    att: Quat,
    up: Vec3,
    east: Vec3,
    north: Vec3,
  ): void {
    const ctx = this.ctx;
    const dirAt = (elevDeg: number, azDeg: number): Vec3 => {
      const elRad = elevDeg * DEG;
      const azRad = azDeg * DEG;
      const ce = Math.cos(elRad);
      const se = Math.sin(elRad);
      const cn = Math.cos(azRad);
      const sn = Math.sin(azRad);
      return {
        x: up.x * se + (north.x * cn + east.x * sn) * ce,
        y: up.y * se + (north.y * cn + east.y * sn) * ce,
        z: up.z * se + (north.z * cn + east.z * sn) * ce,
      };
    };

    // Cincin lintang (pitch)
    for (const elev of [-60, -30, 0, 30, 60]) {
      ctx.beginPath();
      let started = false;
      for (let az = 0; az <= 360; az += 10) {
        const p = projectNavballVector(att, dirAt(elev, az));
        if (p.front) {
          const px = cx + p.bx * rad;
          const py = cy - p.by * rad;
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        } else {
          started = false;
        }
      }
      ctx.strokeStyle = elev === 0 ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.24)';
      ctx.lineWidth = elev === 0 ? 1.6 : 0.9;
      ctx.stroke();
    }

    // Garis bujur utama setiap 90 derajat (U, T, S, B)
    for (let az = 0; az < 360; az += 90) {
      ctx.beginPath();
      let started = false;
      for (let elev = -80; elev <= 80; elev += 10) {
        const p = projectNavballVector(att, dirAt(elev, az));
        if (p.front) {
          const px = cx + p.bx * rad;
          const py = cy - p.by * rad;
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        } else {
          started = false;
        }
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Label arah mata angin di cakrawala (N=0, E=90, S=180, W=270)
    const cardinals: [number, string][] = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']];
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [az, label] of cardinals) {
      const p = projectNavballVector(att, dirAt(3, az));
      if (!p.front) continue;
      ctx.fillStyle = label === 'N' ? '#f87171' : '#e2e8f0';
      ctx.fillText(label, cx + p.bx * rad, cy - p.by * rad);
    }
  }

  private drawMarker(
    cx: number,
    cy: number,
    rad: number,
    att: Quat,
    worldDir: Vec3,
    kind: 'prograde' | 'retrograde' | 'normal' | 'antiNormal' | 'radialOut' | 'radialIn' | 'maneuver',
  ): void {
    const ctx = this.ctx;
    const p = projectNavballVector(att, worldDir);
    let dx = p.bx;
    let dy = -p.by;
    const onRim = !p.front;
    const len = Math.hypot(dx, dy);
    if (onRim) {
      if (len > 1e-6) {
        dx = (dx / len) * 0.84;
        dy = (dy / len) * 0.84;
      } else {
        dx = 0.84;
        dy = 0;
      }
    } else if (len > 0.84) {
      dx = (dx / len) * 0.84;
      dy = (dy / len) * 0.84;
    }
    const mx = cx + dx * rad;
    const my = cy + dy * rad;

    ctx.save();
    ctx.translate(mx, my);
    ctx.globalAlpha = onRim ? 0.42 : 0.96;
    ctx.lineWidth = 1.6;

    if (kind === 'prograde' || kind === 'retrograde') {
      ctx.strokeStyle = '#a3e635';
      ctx.beginPath();
      ctx.arc(0, 0, 5.2, 0, TWO_PI);
      ctx.moveTo(0, -5.2);
      ctx.lineTo(0, -9);
      ctx.moveTo(-5.2, 0);
      ctx.lineTo(-9, 0);
      ctx.moveTo(5.2, 0);
      ctx.lineTo(9, 0);
      ctx.stroke();
      if (kind === 'retrograde') {
        ctx.beginPath();
        ctx.moveTo(-3.5, -3.5);
        ctx.lineTo(3.5, 3.5);
        ctx.moveTo(3.5, -3.5);
        ctx.lineTo(-3.5, 3.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#a3e635';
        ctx.beginPath();
        ctx.arc(0, 0, 1.5, 0, TWO_PI);
        ctx.fill();
      }
    } else if (kind === 'normal' || kind === 'antiNormal') {
      ctx.strokeStyle = '#e879f9';
      const dir = kind === 'normal' ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(0, -6 * dir);
      ctx.lineTo(5.5, 4.5 * dir);
      ctx.lineTo(-5.5, 4.5 * dir);
      ctx.closePath();
      ctx.stroke();
      if (kind === 'antiNormal') {
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.lineTo(0, 9);
        ctx.stroke();
      }
    } else if (kind === 'radialOut' || kind === 'radialIn') {
      ctx.strokeStyle = '#22d3ee';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, TWO_PI);
      ctx.stroke();
      for (const a of [45, 135, 225, 315]) {
        const ar = a * DEG;
        const r1 = kind === 'radialOut' ? 4.5 : 1.5;
        const r2 = kind === 'radialOut' ? 8.2 : 4.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ar) * r1, Math.sin(ar) * r1);
        ctx.lineTo(Math.cos(ar) * r2, Math.sin(ar) * r2);
        ctx.stroke();
      }
    } else {
      // Maneuver / Target Node
      ctx.strokeStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, TWO_PI);
      ctx.moveTo(-9, 0);
      ctx.lineTo(-4, 0);
      ctx.moveTo(4, 0);
      ctx.lineTo(9, 0);
      ctx.moveTo(0, -9);
      ctx.lineTo(0, -4);
      ctx.moveTo(0, 4);
      ctx.lineTo(0, 9);
      ctx.stroke();
    }
    ctx.restore();
  }
}
