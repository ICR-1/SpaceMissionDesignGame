import { describe, expect, it } from 'vitest';
import { ORBITAL } from '../../src/core/constants';
import {
  ascentGuidanceDir,
  attitudeToLvlh,
  BODIES,
  burnTimeSec,
  computeKeplerian,
  computeNavballVectors,
  effectiveEngineStats,
  launchpadInitialState,
  lvlhBasis,
  projectNavballVector,
  quatFromForwardUp,
  rotateAttitudeLocal,
  stepOrbitRK4,
  vec3,
  vecDot,
  vecLen,
  vecScale,
} from '../../src/rules/orbital';

describe('mekanika orbit 3D Keplerian (orbital.ts)', () => {
  it('launchpad LC-39A memiliki kecepatan rotasi permukaan Bumi ~409 m/s dan pitch 90° tegak', () => {
    const init = launchpadInitialState(BODIES.earth);
    const speed = vecLen(init.v);
    expect(speed).toBeGreaterThan(400);
    expect(speed).toBeLessThan(420);
    const lvlh = attitudeToLvlh(init.att, init.r);
    expect(lvlh.pitchDeg).toBeCloseTo(90, 4);
  });

  it('rotateAttitudeLocal mengubah pitch, heading (+yaw ke kanan), dan roll secara konsisten', () => {
    const r = vec3(BODIES.earth.radiusM, 0, 0);
    const { up, east } = lvlhBasis(r);
    // Hadap Timur (heading 90°) mendatar di cakrawala dengan punggung ke atas
    const levelEast = quatFromForwardUp(east, up);
    const base = attitudeToLvlh(levelEast, r);
    expect(base.pitchDeg).toBeCloseTo(0, 3);
    expect(base.headingDeg).toBeCloseTo(90, 3);
    expect(base.rollDeg).toBeCloseTo(0, 3);

    // +pitch = hidung turun (pitchDeg berkurang)
    const pitched = attitudeToLvlh(rotateAttitudeLocal(levelEast, 0.1, 0, 0), r);
    expect(pitched.pitchDeg).toBeLessThan(-4);

    // +yaw = belok kanan dari Timur (90°) ke Selatan (>90°)
    const yawed = attitudeToLvlh(rotateAttitudeLocal(levelEast, 0, 0.1, 0), r);
    expect(yawed.headingDeg).toBeGreaterThan(94);

    // +roll = miring sayap kanan ke bawah (+rollDeg)
    const rolled = attitudeToLvlh(rotateAttitudeLocal(levelEast, 0, 0, 0.1), r);
    expect(rolled.rollDeg).toBeGreaterThan(4);
  });

  it('orbit parkir LEO 200 km melingkar mempertahankan energi & periapsis satu periode penuh dengan RK4', () => {
    const alt = ORBITAL.earth.parkOrbitAltM;
    const r0Mag = BODIES.earth.radiusM + alt;
    const vCirc = Math.sqrt(BODIES.earth.mu / r0Mag);
    const incRad = (ORBITAL.launchLatitudeDeg * Math.PI) / 180;
    let r = vec3(r0Mag, 0, 0);
    let v = vec3(0, vCirc * Math.cos(incRad), vCirc * Math.sin(incRad));

    const k0 = computeKeplerian(r, v, BODIES.earth);
    expect(k0.eccentricity).toBeLessThan(0.001);
    expect(k0.inclinationDeg).toBeCloseTo(ORBITAL.launchLatitudeDeg, 1);
    expect(k0.apoapsisAltM).toBeCloseTo(alt, -1);
    expect(k0.periapsisAltM).toBeCloseTo(alt, -1);

    const steps = 600;
    const dt = k0.periodSec / steps;
    for (let i = 0; i < steps; i++) {
      const next = stepOrbitRK4({
        r, v, massKg: 15_000, thrustN: 0, noseDir: v, cdAreaM2: 0, body: BODIES.earth,
      }, dt);
      r = next.r;
      v = next.v;
    }
    const k1 = computeKeplerian(r, v, BODIES.earth);
    expect(Math.abs(k1.specificEnergyJkg - k0.specificEnergyJkg) / Math.abs(k0.specificEnergyJkg)).toBeLessThan(1e-4);
    expect(k1.periapsisAltM).toBeCloseTo(alt, -1);
  });

  it('orbit hiperbolik escape terdeteksi saat kecepatan melampaui kecepatan lepas', () => {
    const r = vec3(BODIES.earth.radiusM + 200_000, 0, 0);
    const vEsc = Math.sqrt((2 * BODIES.earth.mu) / vecLen(r));
    const v = vec3(0, vEsc * 1.05, 0);
    const k = computeKeplerian(r, v, BODIES.earth);
    expect(k.hyperbolic).toBe(true);
    expect(k.eccentricity).toBeGreaterThan(1);
    expect(k.apoapsisAltM).toBe(Infinity);
  });

  it('Navball 7 vektor ortogonal dan proyeksi sejajar tepat di depan (bz ≈ +1)', () => {
    const r = vec3(BODIES.earth.radiusM + 200_000, 0, 0);
    const v = vec3(0, 7784, 0);
    const nav = computeNavballVectors(r, v, v);
    expect(vecDot(nav.prograde, nav.retrograde)).toBeCloseTo(-1, 5);
    expect(vecDot(nav.prograde, nav.normal)).toBeCloseTo(0, 5);
    expect(vecDot(nav.prograde, nav.radialOut)).toBeCloseTo(0, 5);
    expect(vecDot(nav.normal, nav.radialOut)).toBeCloseTo(0, 5);

    const att = quatFromForwardUp(nav.prograde, nav.radialOut);
    const pPro = projectNavballVector(att, nav.prograde);
    const pRet = projectNavballVector(att, nav.retrograde);
    expect(pPro.front).toBe(true);
    expect(pPro.bz).toBeCloseTo(1, 5);
    expect(pRet.front).toBe(false);
    expect(pRet.bz).toBeCloseTo(-1, 5);
  });

  it('interpolasi mesin SL->Vac, burnTimeSec, dan panduan pendakian tertutup bekerja akurat', () => {
    const sl = effectiveEngineStats(1_000_000, 282, 311, BODIES.earth, 0);
    const vac = effectiveEngineStats(1_000_000, 282, 311, BODIES.earth, 150_000);
    expect(sl.ispS).toBeCloseTo(282, 1);
    expect(vac.ispS).toBeCloseTo(311, 1);
    expect(vac.thrustN).toBeCloseTo(1_000_000, -1);

    const bt = burnTimeSec(15_000, 3120, 98_000, 452);
    expect(bt).toBeGreaterThan(200);
    expect(bt).toBeLessThan(500);

    const init = launchpadInitialState(BODIES.earth);
    const { up, east } = lvlhBasis(init.r);
    const kPad = computeKeplerian(init.r, init.v, BODIES.earth);
    const gPad = ascentGuidanceDir(init.r, init.v, kPad, BODIES.earth);
    expect(vecDot(gPad, up)).toBeCloseTo(1, 4);

    const rClimb = vecScale(vec3(init.r.x, init.r.y, init.r.z), (BODIES.earth.radiusM + 40_000) / BODIES.earth.radiusM);
    const vClimb = vecScale(east, 1800);
    const gClimb = ascentGuidanceDir(rClimb, vClimb, computeKeplerian(rClimb, vClimb, BODIES.earth), BODIES.earth);
    expect(vecDot(gClimb, east)).toBeGreaterThan(0.3);
  });
});
