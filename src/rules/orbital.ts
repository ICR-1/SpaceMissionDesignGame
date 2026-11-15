import { G0, ORBITAL } from '../core/constants';
import { clamp } from './margin';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type BodyId = 'earth' | 'moon' | 'mars';

export interface CelestialBodySpec {
  id: BodyId;
  name: string;
  mu: number;
  radiusM: number;
  seaLevelDensity: number;
  scaleHeightM: number;
  atmoTopM: number;
  rotOmegaRadS: number;
  /** Jarak orbit dari Bumi (m); 0 untuk Bumi. */
  distanceFromEarthM: number;
  /** Jari-jari Sphere of Influence (m). */
  soiRadiusM: number;
  parkOrbitAltM: number;
}

export const BODIES: Record<BodyId, CelestialBodySpec> = {
  earth: {
    id: 'earth',
    name: 'Bumi',
    mu: ORBITAL.earth.mu,
    radiusM: ORBITAL.earth.radiusM,
    seaLevelDensity: ORBITAL.earth.seaLevelDensity,
    scaleHeightM: ORBITAL.earth.scaleHeightM,
    atmoTopM: ORBITAL.earth.atmoTopM,
    rotOmegaRadS: ORBITAL.earth.rotOmegaRadS,
    distanceFromEarthM: 0,
    soiRadiusM: ORBITAL.earth.soiRadiusM,
    parkOrbitAltM: ORBITAL.earth.parkOrbitAltM,
  },
  moon: {
    id: 'moon',
    name: 'Bulan',
    mu: ORBITAL.moon.mu,
    radiusM: ORBITAL.moon.radiusM,
    seaLevelDensity: 0,
    scaleHeightM: 1,
    atmoTopM: 0,
    rotOmegaRadS: ORBITAL.moon.rotOmegaRadS,
    distanceFromEarthM: ORBITAL.moon.distanceM,
    soiRadiusM: ORBITAL.moon.soiRadiusM,
    parkOrbitAltM: ORBITAL.moon.captureOrbitAltM,
  },
  mars: {
    id: 'mars',
    name: 'Mars',
    mu: ORBITAL.mars.mu,
    radiusM: ORBITAL.mars.radiusM,
    seaLevelDensity: ORBITAL.mars.seaLevelDensity,
    scaleHeightM: ORBITAL.mars.scaleHeightM,
    atmoTopM: ORBITAL.mars.atmoTopM,
    rotOmegaRadS: ORBITAL.mars.rotOmegaRadS,
    distanceFromEarthM: ORBITAL.mars.transferDistanceM,
    soiRadiusM: ORBITAL.mars.soiRadiusM,
    parkOrbitAltM: ORBITAL.mars.captureOrbitAltM,
  },
};

export type SasMode = 'off' | 'stability' | 'ascent' | 'prograde' | 'retrograde' | 'normal' | 'antiNormal' | 'radialOut' | 'radialIn' | 'maneuver';

export interface KeplerianElements {
  radiusM: number;
  altitudeM: number;
  speedMs: number;
  circularSpeedMs: number;
  escapeSpeedMs: number;
  specificEnergyJkg: number;
  semiMajorAxisM: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  argPeriapsisDeg: number;
  trueAnomalyDeg: number;
  periapsisM: number;
  apoapsisM: number;
  periapsisAltM: number;
  apoapsisAltM: number;
  periodSec: number;
  timeToApoapsisSec: number;
  timeToPeriapsisSec: number;
  hyperbolic: boolean;
}

export interface NavballVectors {
  prograde: Vec3;
  retrograde: Vec3;
  normal: Vec3;
  antiNormal: Vec3;
  radialOut: Vec3;
  radialIn: Vec3;
  maneuver: Vec3;
}

export interface NavballProjection {
  /** Komponen di frame bodi (+x kanan, +y atas, +z depan hidung). */
  bx: number;
  by: number;
  bz: number;
  front: boolean;
}

export interface LvlhAttitude {
  /** Sudut hidung di atas cakrawala lokal (+90 = tegak ke zenit, 0 = cakrawala, -90 = nadir). */
  pitchDeg: number;
  /** Azimut kompas searah jarum jam dari Utara (0..360, 90 = Timur). */
  headingDeg: number;
  /** Kemiringan sayap terhadap cakrawala lokal (-180..180). */
  rollDeg: number;
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const EPS = 1e-12;

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const vecAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vecSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vecScale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vecDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vecCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vecLenSq = (a: Vec3): number => vecDot(a, a);
export const vecLen = (a: Vec3): number => Math.sqrt(vecLenSq(a));

export function vecNorm(a: Vec3, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 {
  const len = vecLen(a);
  return len > EPS ? { x: a.x / len, y: a.y / len, z: a.z / len } : { ...fallback };
}

export const quatIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export function quatNorm(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return l > EPS ? { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l } : quatIdentity();
}

export function quatConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const u = vecNorm(axis);
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return { x: u.x * s, y: u.y * s, z: u.z * s, w: Math.cos(half) };
}

export function quatRotateVec(q: Quat, v: Vec3): Vec3 {
  const qv = { x: v.x, y: v.y, z: v.z, w: 0 };
  const r = quatMul(quatMul(q, qv), quatConjugate(q));
  return { x: r.x, y: r.y, z: r.z };
}

/** Putar vektor dari kerangka inersia ke kerangka bodi wahana. */
export function worldToBody(att: Quat, v: Vec3): Vec3 {
  return quatRotateVec(quatConjugate(att), v);
}

/** Bangun kuaternion orientasi agar sumbu +Z bodi menunjuk ke `forward` dan +Y dekat `upHint`. */
export function quatFromForwardUp(forward: Vec3, upHint: Vec3): Quat {
  const f = vecNorm(forward);
  let r = vecCross(upHint, f);
  if (vecLenSq(r) < EPS) {
    const alt = Math.abs(f.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0);
    r = vecCross(alt, f);
  }
  r = vecNorm(r);
  const u = vecCross(f, r);
  // Matriks rotasi dengan kolom (r, u, f) -> kuaternion
  const m00 = r.x, m01 = u.x, m02 = f.x;
  const m10 = r.y, m11 = u.y, m12 = f.y;
  const m20 = r.z, m21 = u.z, m22 = f.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return quatNorm({ w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s });
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return quatNorm({ w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s });
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return quatNorm({ w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s });
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return quatNorm({ w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s });
}

export function quatFromTwoVectors(fromDir: Vec3, toDir: Vec3): Quat {
  const f = vecNorm(fromDir);
  const t = vecNorm(toDir);
  const d = clamp(vecDot(f, t), -1, 1);
  if (d > 1 - 1e-10) return quatIdentity();
  if (d < -1 + 1e-10) {
    const ortho = Math.abs(f.x) < 0.8 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    return quatFromAxisAngle(vecCross(f, ortho), Math.PI);
  }
  const c = vecCross(f, t);
  return quatNorm({ x: c.x, y: c.y, z: c.z, w: 1 + d });
}

/**
 * Putar orientasi wahana pada sumbu lokal bodi (+X kiri, +Y atas dorsal, +Z hidung depan):
 * - pitchRad > 0: hidung turun (+Z menuju -Y lokal, sesuai tombol Panah Bawah)
 * - yawRad > 0: hidung belok kanan (+Z menuju -X lokal, sesuai tombol Panah Kanan)
 * - rollRad > 0: sayap kanan turun (+Y menuju -X lokal, sesuai tombol D)
 */
export function rotateAttitudeLocal(att: Quat, pitchRad: number, yawRad: number, rollRad: number): Quat {
  const dqPitch = quatFromAxisAngle(vec3(1, 0, 0), pitchRad);
  const dqYaw = quatFromAxisAngle(vec3(0, 1, 0), -yawRad);
  const dqRoll = quatFromAxisAngle(vec3(0, 0, 1), rollRad);
  return quatNorm(quatMul(att, quatMul(dqYaw, quatMul(dqPitch, dqRoll))));
}

/** Orientasi tegak di landasan untuk vektor posisi `r` (mengikuti rotasi Bumi). */
export function uprightAttitudeAt(r: Vec3): Quat {
  const { up, east } = lvlhBasis(r);
  return quatFromForwardUp(up, vecScale(east, -1));
}

/** Kerangka LVLH lokal (Up, East, North) di posisi inersia `r`. */
export function lvlhBasis(r: Vec3): { up: Vec3; east: Vec3; north: Vec3 } {
  const up = vecNorm(r, vec3(1, 0, 0));
  const east = vecNorm(vecCross(vec3(0, 0, 1), up), vec3(0, 1, 0));
  const north = vecNorm(vecCross(up, east), vec3(0, 0, 1));
  return { up, east, north };
}

/** Hitung sudut pitch, heading, dan roll wahana terhadap cakrawala lokal (LVLH). */
export function attitudeToLvlh(att: Quat, r: Vec3): LvlhAttitude {
  const { up, east, north } = lvlhBasis(r);
  const nose = quatRotateVec(att, vec3(0, 0, 1));
  const dorsal = quatRotateVec(att, vec3(0, 1, 0));
  const right = quatRotateVec(att, vec3(1, 0, 0));
  const pitchDeg = Math.asin(clamp(vecDot(nose, up), -1, 1)) * RAD_TO_DEG;
  const eastComp = vecDot(nose, east);
  const northComp = vecDot(nose, north);
  const headingRaw = Math.atan2(eastComp, northComp) * RAD_TO_DEG;
  const headingDeg = (headingRaw + 360) % 360;
  const refRight = vecNorm(vecCross(nose, up), east);
  const refUp = vecCross(refRight, nose);
  const rollDeg = Math.atan2(vecDot(dorsal, refRight), vecDot(dorsal, refUp)) * RAD_TO_DEG;
  void right;
  return { pitchDeg, headingDeg, rollDeg };
}

/** Posisi & kecepatan awal roket di LC-39A (28.57° N) termasuk kecepatan rotasi permukaan Bumi. */
export function launchpadInitialState(body: CelestialBodySpec, latDeg = ORBITAL.launchLatitudeDeg): {
  r: Vec3;
  v: Vec3;
  att: Quat;
} {
  const lat = latDeg * DEG_TO_RAD;
  const r = vec3(body.radiusM * Math.cos(lat), 0, body.radiusM * Math.sin(lat));
  // v = omega x r; omega = (0, 0, rotOmegaRadS) -> vx = -omega*y, vy = omega*x, vz = 0
  const v = vec3(0, body.rotOmegaRadS * r.x, 0);
  const { up, east } = lvlhBasis(r);
  // Orientasi awal di pad: hidung (+Z bodi) menghadap Up (90° pitch), bagian atas bodi (+Y) ke arah Timur
  // sehingga menekan Panah Bawah (pitch > 0 -> +Z berputar menjauhi +Y) langsung memiringkan roket ke Timur!
  const att = quatFromForwardUp(up, vecScale(east, -1));
  return { r, v, att };
}

/** Kepadatan atmosfer eksponensial pada ketinggian `altM`. */
export function atmosphericDensity(body: CelestialBodySpec, altM: number): number {
  if (body.seaLevelDensity <= 0 || altM > body.atmoTopM) return 0;
  const h = Math.max(0, altM);
  return body.seaLevelDensity * Math.exp(-h / body.scaleHeightM);
}

/** Tekanan dinamis (Pa), gaya hambat (N), dan perkiraan angka Mach. */
export function aeroState(
  body: CelestialBodySpec,
  r: Vec3,
  v: Vec3,
  cdAreaM2: number,
): { densityKgM3: number; airSpeedMs: number; dynamicPressurePa: number; dragForceN: number; mach: number; airVel: Vec3 } {
  const altM = vecLen(r) - body.radiusM;
  const densityKgM3 = atmosphericDensity(body, altM);
  const vAtmo = vec3(-body.rotOmegaRadS * r.y, body.rotOmegaRadS * r.x, 0);
  const airVel = vecSub(v, vAtmo);
  const airSpeedMs = vecLen(airVel);
  if (densityKgM3 <= 0) {
    return { densityKgM3: 0, airSpeedMs, dynamicPressurePa: 0, dragForceN: 0, mach: 0, airVel };
  }
  const dynamicPressurePa = 0.5 * densityKgM3 * airSpeedMs * airSpeedMs;
  const dragForceN = dynamicPressurePa * cdAreaM2;
  const speedOfSound = body.id === 'mars' ? 240 : clamp(340 - (Math.min(altM, 20000) / 20000) * 45, 295, 340);
  return { densityKgM3, airSpeedMs, dynamicPressurePa, dragForceN, mach: airSpeedMs / speedOfSound, airVel };
}

/** Hitung 6 elemen orbit Keplerian 3D penuh dari vektor posisi `r` dan kecepatan `v`. */
export function computeKeplerian(r: Vec3, v: Vec3, body: CelestialBodySpec): KeplerianElements {
  const mu = body.mu;
  const rMag = Math.max(1, vecLen(r));
  const vMag = vecLen(v);
  const altitudeM = rMag - body.radiusM;
  const circularSpeedMs = Math.sqrt(mu / rMag);
  const escapeSpeedMs = Math.sqrt((2 * mu) / rMag);

  const h = vecCross(r, v);
  const hMag = vecLen(h);
  const n = vecCross(vec3(0, 0, 1), h);
  const nMag = vecLen(n);

  const rv = vecDot(r, v);
  const eVec = vecScale(vecSub(vecScale(r, vMag * vMag - mu / rMag), vecScale(v, rv)), 1 / mu);
  const e = vecLen(eVec);

  const specificEnergyJkg = (vMag * vMag) * 0.5 - mu / rMag;
  const hyperbolic = e >= 1 - 1e-6 || specificEnergyJkg >= 0;
  const semiMajorAxisM = Math.abs(specificEnergyJkg) > EPS ? -mu / (2 * specificEnergyJkg) : Infinity;

  const p = (hMag * hMag) / mu;
  const periapsisM = p / (1 + e);
  const apoapsisM = hyperbolic ? Infinity : p / Math.max(1e-7, 1 - e);
  const periapsisAltM = periapsisM - body.radiusM;
  const apoapsisAltM = hyperbolic ? Infinity : apoapsisM - body.radiusM;

  const inclinationDeg = hMag > EPS ? Math.acos(clamp(h.z / hMag, -1, 1)) * RAD_TO_DEG : 0;

  let raanDeg = 0;
  if (nMag > EPS) {
    raanDeg = Math.acos(clamp(n.x / nMag, -1, 1)) * RAD_TO_DEG;
    if (n.y < 0) raanDeg = 360 - raanDeg;
  }

  let argPeriapsisDeg = 0;
  if (nMag > EPS && e > 1e-6) {
    argPeriapsisDeg = Math.acos(clamp(vecDot(n, eVec) / (nMag * e), -1, 1)) * RAD_TO_DEG;
    if (eVec.z < 0) argPeriapsisDeg = 360 - argPeriapsisDeg;
  } else if (e > 1e-6) {
    argPeriapsisDeg = (Math.atan2(eVec.y, eVec.x) * RAD_TO_DEG + 360) % 360;
  }

  let trueAnomalyRad: number;
  if (e > 1e-6) {
    trueAnomalyRad = Math.acos(clamp(vecDot(eVec, r) / (e * rMag), -1, 1));
    if (rv < 0) trueAnomalyRad = 2 * Math.PI - trueAnomalyRad;
  } else if (nMag > EPS) {
    trueAnomalyRad = Math.acos(clamp(vecDot(n, r) / (nMag * rMag), -1, 1));
    if (r.z < 0) trueAnomalyRad = 2 * Math.PI - trueAnomalyRad;
  } else {
    trueAnomalyRad = (Math.atan2(r.y, r.x) + 2 * Math.PI) % (2 * Math.PI);
  }
  const trueAnomalyDeg = trueAnomalyRad * RAD_TO_DEG;

  let periodSec = Infinity;
  let timeToApoapsisSec = Infinity;
  let timeToPeriapsisSec = Infinity;
  if (!hyperbolic && semiMajorAxisM > 0) {
    periodSec = 2 * Math.PI * Math.sqrt((semiMajorAxisM ** 3) / mu);
    if (e > 1e-6) {
      const cosE = clamp((e + Math.cos(trueAnomalyRad)) / (1 + e * Math.cos(trueAnomalyRad)), -1, 1);
      let E = Math.acos(cosE);
      if (trueAnomalyRad > Math.PI) E = 2 * Math.PI - E;
      const meanAnomaly = E - e * Math.sin(E);
      const meanMotion = (2 * Math.PI) / periodSec;
      const timeSincePeri = meanAnomaly / meanMotion;
      timeToPeriapsisSec = (periodSec - timeSincePeri) % periodSec;
      const halfT = periodSec * 0.5;
      timeToApoapsisSec = timeSincePeri <= halfT ? halfT - timeSincePeri : periodSec - timeSincePeri + halfT;
    } else {
      timeToPeriapsisSec = 0;
      timeToApoapsisSec = periodSec * 0.5;
    }
  }

  return {
    radiusM: rMag,
    altitudeM,
    speedMs: vMag,
    circularSpeedMs,
    escapeSpeedMs,
    specificEnergyJkg,
    semiMajorAxisM,
    eccentricity: e,
    inclinationDeg,
    raanDeg,
    argPeriapsisDeg,
    trueAnomalyDeg,
    periapsisM,
    apoapsisM,
    periapsisAltM,
    apoapsisAltM,
    periodSec,
    timeToApoapsisSec,
    timeToPeriapsisSec,
    hyperbolic,
  };
}

/** Hitung 7 vektor referensi Navball (Prograde, Retrograde, Normal, Anti-Normal, Radial Out/In, Maneuver). */
export function computeNavballVectors(r: Vec3, v: Vec3, maneuverTarget?: Vec3): NavballVectors {
  const prograde = vecNorm(v, vecNorm(r));
  const retrograde = vecScale(prograde, -1);
  const normal = vecNorm(vecCross(r, v), vec3(0, 0, 1));
  const antiNormal = vecScale(normal, -1);
  const radialOut = vecNorm(vecCross(prograde, normal), vecNorm(r));
  const radialIn = vecScale(radialOut, -1);
  const maneuver = maneuverTarget ? vecNorm(maneuverTarget, prograde) : prograde;
  return { prograde, retrograde, normal, antiNormal, radialOut, radialIn, maneuver };
}

export function projectNavballVector(att: Quat, worldDir: Vec3): NavballProjection {
  const b = vecNorm(worldToBody(att, worldDir));
  return { bx: b.x, by: b.y, bz: b.z, front: b.z >= 0 };
}

/** Putar orientasi menuju target vektor dengan laju maksimum `maxRateRadS`. */
export function slewAttitudeToward(att: Quat, targetForward: Vec3, maxRateRadS: number, dt: number): Quat {
  const nose = quatRotateVec(att, vec3(0, 0, 1));
  const target = vecNorm(targetForward);
  const dot = clamp(vecDot(nose, target), -1, 1);
  const angle = Math.acos(dot);
  if (angle < 1e-5) return att;
  const step = Math.min(angle, maxRateRadS * dt);
  const axis = vecCross(nose, target);
  if (vecLenSq(axis) < EPS) {
    const dorsal = quatRotateVec(att, vec3(0, 1, 0));
    return quatNorm(quatMul(quatFromAxisAngle(dorsal, step), att));
  }
  return quatNorm(quatMul(quatFromAxisAngle(axis, step), att));
}

export interface OrbitStepInput {
  r: Vec3;
  v: Vec3;
  massKg: number;
  thrustN: number;
  noseDir: Vec3;
  cdAreaM2: number;
  body: CelestialBodySpec;
}

function accelerationAt(
  r: Vec3,
  v: Vec3,
  massKg: number,
  thrustN: number,
  noseDir: Vec3,
  cdAreaM2: number,
  body: CelestialBodySpec,
): Vec3 {
  const rMag = Math.max(1, vecLen(r));
  const gFactor = -body.mu / (rMag * rMag * rMag);
  let ax = r.x * gFactor;
  let ay = r.y * gFactor;
  let az = r.z * gFactor;

  if (thrustN > 0 && massKg > 0) {
    const tAcc = thrustN / massKg;
    ax += noseDir.x * tAcc;
    ay += noseDir.y * tAcc;
    az += noseDir.z * tAcc;
  }

  if (cdAreaM2 > 0 && body.seaLevelDensity > 0 && massKg > 0) {
    const aero = aeroState(body, r, v, cdAreaM2);
    if (aero.dragForceN > 0 && aero.airSpeedMs > EPS) {
      const dAcc = -aero.dragForceN / (massKg * aero.airSpeedMs);
      ax += aero.airVel.x * dAcc;
      ay += aero.airVel.y * dAcc;
      az += aero.airVel.z * dAcc;
    }
  }
  return { x: ax, y: ay, z: az };
}

/** Integrasi satu langkah posisi & kecepatan 3D dengan RK4 (stabil untuk orbit & time warp). */
export function stepOrbitRK4(s: OrbitStepInput, dt: number): { r: Vec3; v: Vec3 } {
  const nose = vecNorm(s.noseDir);
  const k1r = s.v;
  const k1v = accelerationAt(s.r, s.v, s.massKg, s.thrustN, nose, s.cdAreaM2, s.body);

  const r2 = vecAdd(s.r, vecScale(k1r, 0.5 * dt));
  const v2 = vecAdd(s.v, vecScale(k1v, 0.5 * dt));
  const k2r = v2;
  const k2v = accelerationAt(r2, v2, s.massKg, s.thrustN, nose, s.cdAreaM2, s.body);

  const r3 = vecAdd(s.r, vecScale(k2r, 0.5 * dt));
  const v3 = vecAdd(s.v, vecScale(k2v, 0.5 * dt));
  const k3r = v3;
  const k3v = accelerationAt(r3, v3, s.massKg, s.thrustN, nose, s.cdAreaM2, s.body);

  const r4 = vecAdd(s.r, vecScale(k3r, dt));
  const v4 = vecAdd(s.v, vecScale(k3v, dt));
  const k4r = v4;
  const k4v = accelerationAt(r4, v4, s.massKg, s.thrustN, nose, s.cdAreaM2, s.body);

  const nextR = vecAdd(
    s.r,
    vecScale(vecAdd(vecAdd(k1r, vecScale(k2r, 2)), vecAdd(vecScale(k3r, 2), k4r)), dt / 6),
  );
  const nextV = vecAdd(
    s.v,
    vecScale(vecAdd(vecAdd(k1v, vecScale(k2v, 2)), vecAdd(vecScale(k3v, 2), k4v)), dt / 6),
  );
  return { r: nextR, v: nextV };
}

/** Gaya dorong & Isp efektif berdasarkan kepadatan atmosfer lokal (interpolasi SL -> Vac). */
export function effectiveEngineStats(
  thrustVacN: number,
  ispSlS: number,
  ispVacS: number,
  body: CelestialBodySpec,
  altitudeM: number,
): { thrustN: number; ispS: number; atmFrac: number } {
  const atmFrac = body.seaLevelDensity > 0
    ? clamp(atmosphericDensity(body, altitudeM) / body.seaLevelDensity, 0, 1)
    : 0;
  const ispS = ispVacS - (ispVacS - ispSlS) * atmFrac;
  const thrustN = ispVacS > 0 ? thrustVacN * (ispS / ispVacS) : thrustVacN;
  return { thrustN, ispS, atmFrac };
}

/** Perkiraan waktu burn Tsiolkovsky nyata (detik) untuk mencapai `dvMs` dengan massa `m0Kg`, `thrustN`, `ispS`. */
export function burnTimeSec(m0Kg: number, dvMs: number, thrustN: number, ispS: number): number {
  if (m0Kg <= 0 || dvMs <= 0 || thrustN <= 0 || ispS <= 0) return 0;
  const ve = ispS * G0;
  const mDot = thrustN / ve;
  const fuelNeeded = m0Kg * (1 - Math.exp(-dvMs / ve));
  return fuelNeeded / mDot;
}

/** Pemandu pendakian tertutup (closed-loop gravity turn + PEG apoapsis hold ke Timur). */
export function ascentGuidanceDir(
  r: Vec3,
  v: Vec3,
  kepler: KeplerianElements,
  body: CelestialBodySpec,
  targetAltM = ORBITAL.earth.parkOrbitAltM,
): Vec3 {
  const { up, east } = lvlhBasis(r);
  const vAtmo = vec3(-body.rotOmegaRadS * r.y, body.rotOmegaRadS * r.x, 0);
  const airSpeed = vecLen(vecSub(v, vAtmo));
  const alt = kepler.altitudeM;

  if (alt < 500 || airSpeed < 60) return up;

  const radialVel = vecDot(v, up);
  let targetPitchDeg: number;

  if (!kepler.hyperbolic && kepler.apoapsisAltM >= targetAltM) {
    // Apoapsis sudah tercapai: miring mendatar untuk sirkularisasi periapsis
    if (alt < targetAltM * 0.72) {
      targetPitchDeg = clamp(4 + (radialVel < 0 ? 12 : 0), 0, 22);
    } else {
      targetPitchDeg = clamp(-radialVel * 0.04, -3, 6);
    }
  } else {
    // Gravity turn mulus berdasarkan ketinggian + kendali tertutup waktu-ke-apoapsis
    const altFrac = clamp((alt - 500) / 95_000, 0, 1);
    targetPitchDeg = 84 - 75 * Math.pow(altFrac, 0.56);

    if (!kepler.hyperbolic && alt > 15_000 && Number.isFinite(kepler.timeToApoapsisSec)) {
      const tta = kepler.timeToApoapsisSec;
      if (tta < 45) targetPitchDeg += clamp((45 - tta) * 0.8, 0, 28);
      else if (tta > 95 && alt > 45_000) targetPitchDeg -= clamp((tta - 95) * 0.2, 0, 10);
    }
    if (radialVel < 15 && alt < 130_000) {
      targetPitchDeg = Math.max(targetPitchDeg, 22);
    }
    targetPitchDeg = clamp(targetPitchDeg, 3, 88);
  }

  const rad = targetPitchDeg * DEG_TO_RAD;
  return vecNorm(vecAdd(vecScale(east, Math.cos(rad)), vecScale(up, Math.sin(rad))));
}

/** Konversi target SAS ke vektor arah inersia. */
export function sasTargetVector(
  mode: SasMode,
  nav: NavballVectors,
  r: Vec3,
): Vec3 | null {
  switch (mode) {
    case 'prograde': return nav.prograde;
    case 'retrograde': return nav.retrograde;
    case 'normal': return nav.normal;
    case 'antiNormal': return nav.antiNormal;
    case 'radialOut': return nav.radialOut;
    case 'radialIn': return nav.radialIn;
    case 'maneuver': return nav.maneuver;
    case 'off':
    case 'stability':
    case 'ascent':
    default:
      void r;
      return null;
  }
}
