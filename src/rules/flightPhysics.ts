import { FLIGHT, G0 } from '../core/constants';
import type { Rng } from '../core/rng';
import { fuelRemainingKg, transferBurnCostMs, tsiolkovskyDv } from './deltav';
import { clamp } from './margin';
import type { TouchdownOutcome } from './missionResult';
import { BODIES, atmosphericDensity, type BodyId } from './orbital';
import type { Id } from './types';

const L = FLIGHT.landing;
const T = FLIGHT.touchdown;

/** Pitch panduan gravity turn: vertikal (90) saat progress 0, horizontal (0) saat progress 1. */
export function guidePitchDeg(progress01: number): number {
  return FLIGHT.launchStartPitchDeg * (1 - clamp(progress01, 0, 1)) ** FLIGHT.guideExponent;
}

export function altitudeKmAt(progress01: number): number {
  return FLIGHT.orbitAltitudeKm * clamp(progress01, 0, 1) ** FLIGHT.altitudeExponent;
}

/** Kualitas sudut 0-1 dari rata-rata kesalahan sudut (derajat). */
export function angleQuality(meanErrorDeg: number): number {
  return clamp(1 - meanErrorDeg / FLIGHT.angleErrorZeroDeg, 0, 1);
}

/** Penyimpangan arah 0-1 dari rata-rata simpangan (derajat). */
export function headingDeviation01(meanDeviationDeg: number): number {
  return clamp(meanDeviationDeg / FLIGHT.angleErrorZeroDeg, 0, 1);
}

export interface TransferParams {
  m0Kg: number;
  mfKg: number;
  ispS: number;
  dvRequiredMs: number;
  /** Perubahan dvAvailable dari event (m/s, negatif = berkurang). */
  dvAdjustMs?: number;
}

export interface TransferResult {
  burnCostMs: number;
  dvAvailableMs: number;
  sufficient: boolean;
  fuelRemainingKg: number;
}

/**
 * Hitung kelayakan delta-v transfer terhadap anggaran Tsiolkovsky.
 */
export function resolveTransfer(p: TransferParams, errorFraction: number): TransferResult {
  const dvAvailableMs = Math.max(0, tsiolkovskyDv(p.ispS, p.m0Kg, p.mfKg) + (p.dvAdjustMs ?? 0));
  const burnCostMs = transferBurnCostMs(p.dvRequiredMs, errorFraction);
  const sufficient = dvAvailableMs >= burnCostMs;
  const effectiveM0 = p.ispS > 0 ? p.mfKg * Math.exp(dvAvailableMs / (p.ispS * G0)) : p.mfKg;
  return {
    burnCostMs, dvAvailableMs, sufficient,
    fuelRemainingKg: sufficient ? fuelRemainingKg(effectiveM0, p.mfKg, burnCostMs, p.ispS) : 0,
  };
}

export interface LandingParams {
  thrustN: number;
  ispS: number;
  dryMassKg: number;
  gravity: number;
  /** Tubuh langit target untuk gravitasi 1/r^2 & hambatan atmosfer Mars (opsional). */
  bodyId?: BodyId;
  /** Luas hambat aerodinamis efektif Cd*A (m^2). */
  cdAreaM2?: number;
}

export interface LandingState {
  altitudeM: number;
  vy: number;
  vx: number;
  tiltDeg: number;
  fuelKg: number;
  fuelOut: boolean;
  landed: boolean;
  timeSec: number;
  dragAccelMs2?: number;
}

export interface LandingInput {
  throttle01: number;
  /** -1 = miring kiri, +1 = miring kanan. */
  rotate: number;
  boost: boolean;
  precision: boolean;
}

export function createLanding(
  fuelKg: number,
  startAltitudeM: number = L.startAltitudeM,
  startVy: number = L.startVy,
  startVx = 120,
): LandingState {
  return {
    altitudeM: startAltitudeM,
    vy: startVy,
    vx: startVx,
    tiltDeg: 0,
    fuelKg,
    fuelOut: fuelKg <= 0,
    landed: false,
    timeSec: 0,
    dragAccelMs2: 0,
  };
}

/** Sensitivitas rotasi = 60 derajat/detik x clamp(sqrt(refMass / mCurrent), 0,5, 1,5). */
export function rotationRateDegS(mCurrentKg: number): number {
  return FLIGHT.rotationRateDegS * clamp(Math.sqrt(L.rotationMassRefKg / mCurrentKg), L.rotationScaleMin, L.rotationScaleMax);
}

/**
 * Satu langkah pendaratan fisika nyata:
 * - Gravitasi lokal mu / (R + h)^2 (atau fallback p.gravity)
 * - Proyeksi vektor dorong: vertikal = a_thrust * cos(tilt), horizontal = a_thrust * sin(tilt)
 * - Hambatan aerodinamis di atmosfer Mars (0.5 * rho(h) * v^2 * Cd*A / m)
 */
export function stepLanding(s: LandingState, input: LandingInput, p: LandingParams, dt: number): LandingState {
  if (s.landed) return s;
  const mCurrent = Math.max(1, p.dryMassKg + s.fuelKg);
  const throttle = s.fuelKg > 0 ? clamp(input.throttle01, 0, 1) : 0;
  const thrustAccel = (p.thrustN * throttle) / mCurrent;
  const rate = rotationRateDegS(mCurrent) * (input.precision ? FLIGHT.precisionFactor : 1);
  const tiltDeg = clamp(s.tiltDeg + clamp(input.rotate, -1, 1) * rate * dt, -L.maxTiltDeg, L.maxTiltDeg);
  const tiltRad = (tiltDeg * Math.PI) / 180;

  let burned = p.ispS > 0 ? (p.thrustN * throttle * dt) / (p.ispS * G0) : 0;
  const upThrustAccel = thrustAccel * Math.cos(tiltRad);
  let sideAccel = thrustAccel * Math.sin(tiltRad);
  if (input.boost && s.fuelKg > 0) {
    sideAccel += L.boostAccel * (tiltDeg === 0 ? Math.sign(input.rotate) : Math.sign(tiltDeg));
    burned += L.boostFuelKgPerSec * dt;
  }

  const body = p.bodyId ? BODIES[p.bodyId] : null;
  const localG = body
    ? body.mu / ((body.radiusM + Math.max(0, s.altitudeM)) ** 2)
    : p.gravity;

  let dragAx = 0;
  let dragAy = 0;
  let dragAccelMs2 = 0;
  if (body && body.seaLevelDensity > 0) {
    const rho = atmosphericDensity(body, s.altitudeM);
    const speed = Math.hypot(s.vx, s.vy);
    if (rho > 0 && speed > 1e-4) {
      const cdArea = p.cdAreaM2 ?? 12;
      const dragForce = 0.5 * rho * speed * speed * cdArea;
      dragAccelMs2 = dragForce / mCurrent;
      dragAx = -(dragAccelMs2 * s.vx) / speed;
      dragAy = -(dragAccelMs2 * s.vy) / speed;
    }
  }

  const fuelKg = Math.max(0, s.fuelKg - burned);
  const vy = s.vy + (upThrustAccel - localG + dragAy) * dt;
  const vx = s.vx + (sideAccel + dragAx) * dt;
  const altitudeM = s.altitudeM + vy * dt;
  return {
    altitudeM: Math.max(0, altitudeM),
    vy,
    vx,
    tiltDeg,
    fuelKg,
    fuelOut: s.fuelOut || fuelKg <= 0,
    landed: altitudeM <= 0,
    timeSec: s.timeSec + dt,
    dragAccelMs2,
  };
}

export interface TouchdownResult { outcome: TouchdownOutcome; factor: number }

/** Hasil touchdown (kecepatan vertikal, horizontal opsional, dan kemiringan). */
export function classifyTouchdown(vy: number, tiltDeg: number, vx = 0): TouchdownResult {
  const speed = Math.abs(vy);
  const hSpeed = Math.abs(vx);
  const tilt = Math.abs(tiltDeg);
  if (speed > T.crashVy || hSpeed > T.crashVy * 1.5) return { outcome: 'crash', factor: 0 };
  if (speed <= T.perfectVy && hSpeed <= 3.5 && tilt <= T.maxTiltDeg) return { outcome: 'perfect', factor: T.perfectFactor };
  if (speed <= T.successVy && hSpeed <= 7 && tilt <= T.maxTiltDeg) return { outcome: 'success', factor: T.successFactor };
  return { outcome: 'damaged', factor: T.damagedFactor };
}

/** Tiap instrumen hilang dengan peluang 0,4 (RNG berseed, satu pengundian per instrumen sesuai urutan). */
export function rollInstrumentLoss(instrumentIds: Id[], rng: Rng): Id[] {
  return instrumentIds.filter(() => rng() < T.instrumentLossChance);
}
