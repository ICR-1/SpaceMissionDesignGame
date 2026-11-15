import { describe, expect, it } from 'vitest';
import { FIXED_DT, FLIGHT, G0 } from '../../src/core/constants';
import { createRng } from '../../src/core/rng';
import {
  altitudeKmAt, angleQuality, classifyTouchdown, createLanding, guidePitchDeg, resolveTransfer,
  rollInstrumentLoss, rotationRateDegS, stepLanding, type LandingInput, type LandingParams,
} from '../../src/rules/flightPhysics';
import { fuelRemainingKg, transferBurnCostMs, tsiolkovskyDv } from '../../src/rules/deltav';
import { BODIES } from '../../src/rules/orbital';

const hold = (throttle01: number): LandingInput => ({ throttle01, rotate: 0, boost: false, precision: false });
/** Lander Bulan acuan katalog NASA: Apollo LM + RL10C-1 (102 kN, 454 s); massa kering 3.427 kg (lihat helpers.moonExample). */
const moonParams: LandingParams = { thrustN: 102_000, ispS: 454, dryMassKg: 3427, gravity: 1.62 };
const L = FLIGHT.landing;

function run(throttle: number, seconds: number, params = moonParams, fuel = 600) {
  let s = createLanding(fuel);
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps && !s.landed; i++) s = stepLanding(s, hold(throttle), params, FIXED_DT);
  return s;
}

describe('pendaratan dengan throttle konstan', () => {
  it('mulai dari 12.000 m dengan vy -45 m/s dan vx 120 m/s (orbit tangkap menuju pendaratan)', () => {
    const s = createLanding(100);
    expect(L.startAltitudeM).toBe(12_000);
    expect(L.startVy).toBe(-45);
    expect(s.altitudeM).toBe(12_000);
    expect(s.vy).toBe(-45);
    expect(s.vx).toBe(120);
    expect(s.tiltDeg).toBe(0);
  });
  it('titik awal dapat ditentukan (ketinggian, vy, vx)', () => {
    // Parameter bawaan createLanding bertipe literal (12000, -45) karena berasal dari konstanta `as const`,
    // jadi titik awal lain dibuat lewat spread agar tes tidak bergantung pada tipe literal itu.
    const s = { ...createLanding(50), altitudeM: 5000, vy: -20, vx: 30 };
    expect([s.altitudeM, s.vy, s.vx, s.fuelKg]).toEqual([5000, -20, 30, 50]);
    const next = stepLanding(s, hold(0), moonParams, FIXED_DT);
    expect(next.altitudeM).toBeLessThan(5000);
    expect(next.vx).toBe(30);
  });
  it('tanpa thrust: jatuh bebas sesuai gravitasi (vy = -45 - g t)', () => {
    const s = run(0, 5);
    expect(s.vy).toBeCloseTo(-45 - 1.62 * 5, 1);
    expect(s.altitudeM).toBeCloseTo(12_000 - 45 * 5 - 0.5 * 1.62 * 25, 0);
    expect(s.fuelKg).toBe(600);
    expect(s.vx).toBe(120);
  });
  it('thrust konstan: percepatan = thrust x throttle / massa - gravitasi', () => {
    const heavy: LandingParams = { thrustN: 40_000, ispS: 450, dryMassKg: 100_000, gravity: 1.62 };
    const s = run(0.5, 4, heavy, 1000);
    const accel = (40_000 * 0.5) / (100_000 + 1000) - 1.62;
    expect(s.vy).toBeCloseTo(-45 + accel * 4, 1);
  });
  it('massa lebih besar memberi respons lebih lambat (percepatan dan rotasi)', () => {
    const light = run(0.5, 3, { ...moonParams, dryMassKg: 800 }, 100);
    const heavy = run(0.5, 3, { ...moonParams, dryMassKg: 6000 }, 100);
    expect(light.vy).toBeGreaterThan(heavy.vy);
    expect(rotationRateDegS(800)).toBeGreaterThan(rotationRateDegS(6000));
    expect(rotationRateDegS(100)).toBeCloseTo(FLIGHT.rotationRateDegS * L.rotationScaleMax, 10);
    expect(rotationRateDegS(1e6)).toBeCloseTo(FLIGHT.rotationRateDegS * L.rotationScaleMin, 10);
    // pada massa acuan (3.500 kg) laju rotasi sama dengan laju dasar
    expect(rotationRateDegS(L.rotationMassRefKg)).toBeCloseTo(FLIGHT.rotationRateDegS, 10);
    expect(L.rotationMassRefKg).toBe(3500);
  });
  it('laju bahan bakar = thrust x throttle / (Isp g0) kg per detik', () => {
    const s = run(0.5, 2);
    expect(600 - s.fuelKg).toBeCloseTo(((102_000 * 0.5) / (454 * G0)) * 2, 1);
  });
  it('bahan bakar habis: thrust mati, fuelOut menyala, jatuh bebas', () => {
    const s = run(1, 600, moonParams, 1);
    expect(s.fuelOut).toBe(true);
    expect(s.fuelKg).toBe(0);
    expect(s.landed).toBe(true);
    expect(Math.abs(s.vy)).toBeGreaterThan(12);
  });
  it('tanpa thrust mendarat dengan crash; kecepatan sentuh mengikuti fisika', () => {
    const s = run(0, 600);
    expect(s.landed).toBe(true);
    expect(s.altitudeM).toBe(0);
    expect(classifyTouchdown(s.vy, s.tiltDeg).outcome).toBe('crash');
    // v^2 = v0^2 + 2 g h (Euler semi-implisit: toleransi beberapa persen)
    const expected = Math.sqrt(45 ** 2 + 2 * 1.62 * 12_000);
    expect(Math.abs(s.vy)).toBeGreaterThan(expected * 0.98);
    expect(Math.abs(s.vy)).toBeLessThan(expected * 1.02);
  });
  it('deterministik: input sama menghasilkan keadaan sama', () => {
    expect(run(0.3, 20)).toEqual(run(0.3, 20));
  });
  it('rotasi: A/D mengubah kemiringan, mode presisi lebih halus, dibatasi 90 derajat', () => {
    const turn = (precision: boolean, sec: number) => {
      let s = createLanding(100);
      for (let i = 0; i < Math.round(sec / FIXED_DT); i++) s = stepLanding(s, { throttle01: 0, rotate: 1, boost: false, precision }, moonParams, FIXED_DT);
      return s.tiltDeg;
    };
    expect(turn(false, 0.5)).toBeGreaterThan(turn(true, 0.5));
    expect(turn(false, 100)).toBe(90);
  });
  it('boost samping boros bahan bakar dan menggeser kecepatan horizontal', () => {
    let s = createLanding(100);
    s = stepLanding(s, { throttle01: 0, rotate: 1, boost: false, precision: false }, moonParams, 0.5);
    const base = s;
    const boosted = stepLanding(base, { throttle01: 0, rotate: 0, boost: true, precision: false }, moonParams, 1);
    expect(boosted.fuelKg).toBeLessThan(base.fuelKg);
    expect(boosted.vx).toBeGreaterThan(base.vx);
    // boros: bahan bakar boost 2,5 kg/s
    expect(base.fuelKg - boosted.fuelKg).toBeCloseTo(L.boostFuelKgPerSec, 6);
  });
});

describe('vektor dorong miring dan gravitasi 1/r^2', () => {
  const heavy: LandingParams = { thrustN: 40_000, ispS: 450, dryMassKg: 100_000, gravity: 1.62 };

  it('dorong vertikal = a cos(tilt), horizontal = a sin(tilt)', () => {
    const start = { ...createLanding(1000), tiltDeg: 60 };
    const next = stepLanding(start, hold(1), heavy, FIXED_DT);
    const a = 40_000 / (100_000 + 1000);
    expect(next.vy).toBeCloseTo(start.vy + (a * Math.cos(Math.PI / 3) - 1.62) * FIXED_DT, 9);
    expect(next.vx).toBeCloseTo(start.vx + a * Math.sin(Math.PI / 3) * FIXED_DT, 9);
    expect(next.tiltDeg).toBe(60);
  });
  it('tilt 0: seluruh dorong ke atas, tidak ada percepatan horizontal', () => {
    const next = stepLanding(createLanding(1000), hold(1), heavy, FIXED_DT);
    expect(next.vx).toBe(120);
  });
  it('bodyId mengganti gravitasi tetap dengan mu / (R + h)^2 (Mars)', () => {
    const mars: LandingParams = { ...heavy, bodyId: 'mars', cdAreaM2: 0 };
    let s = createLanding(100);
    for (let i = 0; i < Math.round(5 / FIXED_DT); i++) s = stepLanding(s, hold(0), mars, FIXED_DT);
    const g = BODIES.mars.mu / (BODIES.mars.radiusM + 12_000) ** 2;
    expect(g).toBeGreaterThan(3.6);
    expect(g).toBeLessThan(3.8);
    expect(s.vy).toBeCloseTo(-45 - g * 5, 1);
  });
});

describe('hambatan atmosfer Mars saat pendaratan', () => {
  const base: LandingParams = { thrustN: 102_000, ispS: 454, dryMassKg: 4306, gravity: 3.71, bodyId: 'mars' };

  it('Bulan tanpa atmosfer: tidak ada hambatan', () => {
    const next = stepLanding(createLanding(1000), hold(0), { ...moonParams, bodyId: 'moon', cdAreaM2: 14 }, FIXED_DT);
    expect(next.dragAccelMs2).toBe(0);
    expect(next.vx).toBe(120);
  });
  it('Mars: hambatan memperlambat kecepatan horizontal dan menambah hambatan vertikal dibanding tanpa Cd*A', () => {
    const drag = base;
    const noDrag = { ...base, cdAreaM2: 0 };
    let a = createLanding(1000), b = createLanding(1000);
    for (let i = 0; i < Math.round(5 / FIXED_DT); i++) {
      a = stepLanding(a, hold(0), { ...drag, cdAreaM2: 14 }, FIXED_DT);
      b = stepLanding(b, hold(0), noDrag, FIXED_DT);
    }
    expect(a.dragAccelMs2 ?? 0).toBeGreaterThan(0);
    expect(a.vx).toBeLessThan(b.vx);
    expect(b.vx).toBe(120);
    // hambatan melawan gerak turun: jatuh lebih lambat
    expect(a.vy).toBeGreaterThan(b.vy);
  });
  it('hambatan = 1/2 rho v^2 Cd*A / m, searah berlawanan kecepatan', () => {
    const s = createLanding(1000);
    const next = stepLanding(s, hold(0), { ...base, cdAreaM2: 14 }, FIXED_DT);
    const rho = BODIES.mars.seaLevelDensity * Math.exp(-s.altitudeM / BODIES.mars.scaleHeightM);
    const speed = Math.hypot(s.vx, s.vy);
    const accel = (0.5 * rho * speed * speed * 14) / (4306 + 1000);
    expect(next.dragAccelMs2).toBeCloseTo(accel, 9);
    expect(next.vx).toBeLessThan(s.vx);
  });
});

describe('hasil touchdown (PRD 14)', () => {
  it.each([
    [1.9, 10, 'perfect', 1],
    [2, 15, 'perfect', 1],
    [2.1, 10, 'success', 0.7],
    [5, 15, 'success', 0.7],
    [5.1, 10, 'damaged', 0.3],
    [12, 10, 'damaged', 0.3],
    [3, 16, 'damaged', 0.3],
    [1, 40, 'damaged', 0.3],
    [12.01, 0, 'crash', 0],
    [-30, 0, 'crash', 0],
    [-4, -5, 'success', 0.7],
  ] as const)('vy %f tilt %f -> %s', (vy, tilt, outcome, factor) => {
    expect(classifyTouchdown(vy, tilt)).toEqual({ outcome, factor });
  });
  it.each([
    [1, 0, 3.5, 'perfect'],
    [1, 0, 3.6, 'success'],
    [1, 0, 7, 'success'],
    [1, 0, 7.1, 'damaged'],
    [1, 0, 18, 'damaged'],
    [1, 0, 18.1, 'crash'],
    [1, 0, -18.1, 'crash'],
  ] as const)('kecepatan horizontal: vy %f tilt %f vx %f -> %s', (vy, tilt, vx, outcome) => {
    expect(classifyTouchdown(vy, tilt, vx).outcome).toBe(outcome);
  });
  it('instrumen hilang berdasarkan RNG berseed (deterministik)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(rollInstrumentLoss(ids, createRng(5))).toEqual(rollInstrumentLoss(ids, createRng(5)));
    const lost = rollInstrumentLoss(ids, createRng(5));
    expect(lost.length).toBeLessThan(ids.length);
    let total = 0;
    for (let seed = 0; seed < 400; seed++) total += rollInstrumentLoss(ids, createRng(seed)).length;
    expect(total / (400 * ids.length)).toBeGreaterThan(0.33);
    expect(total / (400 * ids.length)).toBeLessThan(0.47);
  });
});

describe('panduan peluncuran dan burn transfer', () => {
  it('pitch panduan 90 -> 0 dan altitude 0 -> orbit', () => {
    expect(guidePitchDeg(0)).toBe(90);
    expect(guidePitchDeg(1)).toBe(0);
    expect(guidePitchDeg(0.5)).toBeLessThan(90);
    expect(altitudeKmAt(0)).toBe(0);
    expect(altitudeKmAt(1)).toBe(200);
  });
  it('kualitas sudut', () => {
    expect(angleQuality(0)).toBe(1);
    expect(angleQuality(15)).toBeCloseTo(0.5, 10);
    expect(angleQuality(60)).toBe(0);
  });
  // Misi Bulan acuan: m0 15.327 kg, mf 3.427 kg, RL10C-1 454 s, kebutuhan delta-v 5.840 m/s.
  it('resolveTransfer sama dengan rumus PRD saat tanpa penyesuaian', () => {
    const p = { m0Kg: 15_327, mfKg: 3427, ispS: 454, dvRequiredMs: 5840 };
    const r = resolveTransfer(p, 0.2);
    expect(r.burnCostMs).toBeCloseTo(transferBurnCostMs(5840, 0.2), 10);
    expect(r.burnCostMs).toBeCloseTo(0.7 * 5840 * 1.1, 6);
    expect(r.sufficient).toBe(true);
    expect(r.fuelRemainingKg).toBeCloseTo(fuelRemainingKg(15_327, 3427, r.burnCostMs, 454), 6);
    expect(r.dvAvailableMs).toBeCloseTo(tsiolkovskyDv(454, 15_327, 3427), 6);
    expect(r.dvAvailableMs).toBeCloseTo(454 * G0 * Math.log(15_327 / 3427), 6);
  });
  it('delta-v kurang menghasilkan sufficient false, penyesuaian event mengurangi sisa', () => {
    const p = { m0Kg: 3427 + 2400, mfKg: 3427, ispS: 454, dvRequiredMs: 5840 };
    expect(resolveTransfer(p, 0).sufficient).toBe(false);
    const ok = { m0Kg: 15_327, mfKg: 3427, ispS: 454, dvRequiredMs: 5840 };
    expect(resolveTransfer({ ...ok, dvAdjustMs: -90 }, 0).fuelRemainingKg).toBeLessThan(resolveTransfer(ok, 0).fuelRemainingKg);
  });
  it('Mars: kebutuhan 6.200 m/s dan preset Atlas V (m0 18.306 kg, mf 4.306 kg) cukup untuk burn transfer', () => {
    const p = { m0Kg: 18_306, mfKg: 4306, ispS: 454, dvRequiredMs: 6200 };
    const r = resolveTransfer(p, 0);
    expect(r.burnCostMs).toBeCloseTo(0.7 * 6200, 6);
    expect(r.dvAvailableMs).toBeCloseTo(454 * G0 * Math.log(18_306 / 4306), 6);
    expect(r.sufficient).toBe(true);
  });
});
