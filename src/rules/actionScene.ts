/**
 * Koreografi adegan aksi (murni, tanpa Three.js/DOM): memilih batu pelindung untuk bersembunyi saat hujan meteor,
 * badai debu, atau badai matahari, langkah lari menuju tempat berlindung, dan sudut kamera aksi per adegan.
 */
import type { EventSceneKind } from './eventScene';

export type ActionPose = 'none' | 'cover' | 'brace' | 'inspect' | 'comms';

export interface CoverObstacle {
  x: number;
  z: number;
  r: number;
  kind?: 'rock' | 'hub';
}

export interface SurfaceActionPlan {
  pose: ActionPose;
  coverX: number;
  coverZ: number;
  peekYaw: number;
  hazardX: number;
  hazardZ: number;
  camOffset: { x: number; y: number; z: number };
  camLookOffset: { x: number; y: number; z: number };
  sprint: boolean;
}

const COVER_STANDOFF_M = 0.95;
const MAX_COVER_SEARCH_M = 28;
const MIN_COVER_ROCK_R = 0.65;
const ARRIVE_DIST_M = 0.25;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function norm2d(x: number, z: number, fallbackX = 0, fallbackZ = 1): { x: number; z: number } {
  const len = Math.hypot(x, z);
  if (len > 1e-5) return { x: x / len, z: z / len };
  const fl = Math.hypot(fallbackX, fallbackZ) || 1;
  return { x: fallbackX / fl, z: fallbackZ / fl };
}

/**
 * Pilih batu terbaik di dekat pemain yang paling aman sebagai tempat bersembunyi di sisi berlawanan dari arah bahaya.
 * Jika tidak ada batu besar di dekat pemain, mundur memakai `hub` / rintangan terdekat sebagai pelindung.
 */
export function findBestCover(
  player: { x: number; z: number },
  obstacles: readonly CoverObstacle[],
  hazard: { x: number; z: number },
  maxDistM = MAX_COVER_SEARCH_M,
): CoverObstacle | null {
  let best: CoverObstacle | null = null;
  let bestScore = Infinity;
  for (const ob of obstacles) {
    const isRock = ob.kind !== 'hub';
    if (isRock && ob.r < MIN_COVER_ROCK_R) continue;
    const dist = Math.hypot(ob.x - player.x, ob.z - player.z);
    if (dist > maxDistM) continue;
    // Utamakan batu besar yang dekat agar pemain cepat berlari dan tidak perlu lari menembus arah bahaya.
    const hx = hazard.x - player.x, hz = hazard.z - player.z;
    const hLen = Math.hypot(hx, hz) || 1;
    const towardHazard = Math.max(0, ((ob.x - player.x) * hx + (ob.z - player.z) * hz) / (Math.max(1, dist) * hLen));
    const score = dist + towardHazard * 2.5 - ob.r * 2.2 + (isRock ? 0 : 8);
    if (score < bestScore) {
      bestScore = score;
      best = ob;
    }
  }
  return best;
}

/**
 * Rencanakan adegan aksi di permukaan sesuai jenis event krisis:
 * - Hujan meteor / badai / flare: lari bersembunyi di balik batu sisi berlawanan dari bahaya sambil menunduk melindungi visor.
 * - Debu di panel surya: berlari mendekati wahana sambil memeriksa panel.
 * - Konjungsi matahari: sikap siaga memegang komunikasi helm memindai cakrawala.
 */
export function planSurfaceAction(
  kind: EventSceneKind,
  player: { x: number; z: number },
  obstacles: readonly CoverObstacle[],
  hazard: { x: number; z: number },
  facingYaw = 0,
): SurfaceActionPlan {
  if (kind === 'dustPanels') {
    const dir = norm2d(player.x, player.z, Math.sin(facingYaw), Math.cos(facingYaw));
    const coverX = dir.x * 5.6;
    const coverZ = dir.z * 5.6;
    const peekYaw = Math.atan2(-coverX, -coverZ);
    const side = norm2d(-dir.z, dir.x);
    return {
      pose: 'inspect',
      coverX,
      coverZ,
      peekYaw,
      hazardX: 0,
      hazardZ: 0,
      camOffset: { x: dir.x * 3.4 + side.x * 2.2, y: 1.5, z: dir.z * 3.4 + side.z * 2.2 },
      camLookOffset: { x: -dir.x * 1.4, y: 1.0, z: -dir.z * 1.4 },
      sprint: true,
    };
  }

  if (kind === 'conjunction') {
    const fx = Math.sin(facingYaw), fz = Math.cos(facingYaw);
    const side = norm2d(-fz, fx);
    return {
      pose: 'comms',
      coverX: player.x,
      coverZ: player.z,
      peekYaw: facingYaw,
      hazardX: player.x + fx * 20,
      hazardZ: player.z + fz * 20,
      camOffset: { x: fx * 2.1 + side.x * 2.4, y: 0.9, z: fz * 2.1 + side.z * 2.4 },
      camLookOffset: { x: 0, y: 1.35, z: 0 },
      sprint: false,
    };
  }

  const cover = findBestCover(player, obstacles, hazard);
  const pose: ActionPose = kind === 'storm' || kind === 'devil' ? 'brace' : 'cover';
  if (!cover) {
    const toHaz = norm2d(hazard.x - player.x, hazard.z - player.z, Math.sin(facingYaw), Math.cos(facingYaw));
    const side = norm2d(-toHaz.z, toHaz.x);
    return {
      pose,
      coverX: player.x,
      coverZ: player.z,
      peekYaw: Math.atan2(toHaz.x, toHaz.z),
      hazardX: hazard.x,
      hazardZ: hazard.z,
      camOffset: { x: -toHaz.x * 3.8 + side.x * 1.8, y: 1.35, z: -toHaz.z * 3.8 + side.z * 1.8 },
      camLookOffset: { x: toHaz.x * 3, y: 0.95, z: toHaz.z * 3 },
      sprint: false,
    };
  }

  // Titik berlindung berada tepat di balik batu: searah dari bahaya melewati pusat batu.
  const away = norm2d(cover.x - hazard.x, cover.z - hazard.z, player.x - cover.x, player.z - cover.z);
  const coverDist = cover.r + COVER_STANDOFF_M;
  const coverX = cover.x + away.x * coverDist;
  const coverZ = cover.z + away.z * coverDist;
  const toHaz = norm2d(hazard.x - coverX, hazard.z - coverZ);
  const side = norm2d(-away.z, away.x);
  return {
    pose,
    coverX,
    coverZ,
    peekYaw: Math.atan2(toHaz.x, toHaz.z),
    hazardX: hazard.x,
    hazardZ: hazard.z,
    // Kamera aksi rendah dari belakang-samping batu: menampilkan astronot merunduk di balik batu dan bahaya di depan.
    camOffset: { x: away.x * 3.5 + side.x * 2.2, y: 1.4, z: away.z * 3.5 + side.z * 2.2 },
    camLookOffset: { x: -away.x * 2.2, y: 0.85, z: -away.z * 2.2 },
    sprint: true,
  };
}

/** Gerakkan pemain deterministik menuju titik berlindung saat adegan aksi berlangsung. */
export function stepSprintToCover(
  cur: { x: number; z: number; yaw: number },
  target: { x: number; z: number; peekYaw: number },
  speedMs: number,
  dt: number,
): { x: number; z: number; yaw: number; speed01: number; arrived: boolean } {
  const dx = target.x - cur.x;
  const dz = target.z - cur.z;
  const dist = Math.hypot(dx, dz);
  const step = dt > 0 ? speedMs * dt : 0;
  if (dist - step <= ARRIVE_DIST_M || dt <= 0) {
    return { x: target.x, z: target.z, yaw: target.peekYaw, speed01: 0, arrived: true };
  }
  const nx = dx / dist, nz = dz / dist;
  return {
    x: cur.x + nx * step,
    z: cur.z + nz * step,
    yaw: Math.atan2(nx, nz),
    speed01: 1,
    arrived: false,
  };
}

/** Cek apakah pemain sedang berada cukup dekat di balik sebuah batu untuk berlindung manual. */
export function nearCoverRock(
  player: { x: number; z: number },
  obstacles: readonly CoverObstacle[],
  marginM = 1.6,
): CoverObstacle | null {
  let best: CoverObstacle | null = null;
  let bestGap = Infinity;
  for (const ob of obstacles) {
    if (ob.kind === 'hub' || ob.r < MIN_COVER_ROCK_R) continue;
    const gap = Math.hypot(player.x - ob.x, player.z - ob.z) - ob.r;
    if (gap <= marginM && gap < bestGap) {
      bestGap = gap;
      best = ob;
    }
  }
  return best;
}

/** Gerak kamera sinematik saat adegan aksi penerbangan (`flyby`, `engine`, `clamp`, `flare`). */
export function flightActionCameraOffset(
  kind: EventSceneKind,
  t: number,
  durSec: number,
): { dx: number; dy: number; dz: number; rollRad: number; zoomScale: number } {
  if (durSec <= 0 || t <= 0 || t >= durSec) return { dx: 0, dy: 0, dz: 0, rollRad: 0, zoomScale: 1 };
  const u = clamp01(t / durSec);
  // Kurva naik-turun halus sepanjang adegan
  const env = Math.sin(Math.PI * u);
  if (kind === 'flyby') {
    return {
      dx: Math.sin(u * Math.PI * 1.4) * 5.5 * env,
      dy: (1.8 - u * 3.2) * env,
      dz: -4.5 * env,
      rollRad: 0.085 * env * Math.sin(u * Math.PI * 2),
      zoomScale: 1 - 0.18 * env,
    };
  }
  if (kind === 'engine' || kind === 'clamp') {
    return {
      dx: Math.cos(u * Math.PI * 3) * 1.4 * env,
      dy: -2.6 * env,
      dz: -3.2 * env,
      rollRad: 0.06 * Math.sin(u * Math.PI * 4) * env,
      zoomScale: 1 - 0.14 * env,
    };
  }
  return {
    dx: Math.sin(u * Math.PI) * 3.0 * env,
    dy: 1.5 * env,
    dz: -2.8 * env,
    rollRad: 0.04 * env,
    zoomScale: 1 - 0.1 * env,
  };
}
