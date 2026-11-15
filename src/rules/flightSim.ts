import { FLIGHT, G0, ORBITAL, STAGING } from '../core/constants';
import { createRng, type Rng } from '../core/rng';
import { resolveAssembly } from './catalog';
import { dryMassKg, initialMassKg } from './mass';
import { dvRequiredMs, engineIsp, engineThrustN } from './deltav';
import {
  classifyTouchdown, createLanding, headingDeviation01,
  rollInstrumentLoss, stepLanding, type LandingParams, type LandingState,
  type TransferResult,
} from './flightPhysics';
import { clamp } from './margin';
import type { FlightSummary, ReviewCode, TouchdownOutcome } from './missionResult';
import {
  aeroState, ascentGuidanceDir, attitudeToLvlh, BODIES, burnTimeSec, computeKeplerian, computeNavballVectors,
  effectiveEngineStats, launchpadInitialState, lvlhBasis, quatRotateVec, rotateAttitudeLocal,
  sasTargetVector, slewAttitudeToward, stepOrbitRK4, uprightAttitudeAt, vec3, vecDot, vecLen, vecNorm, vecScale,
  type BodyId, type CelestialBodySpec, type KeplerianElements, type LvlhAttitude,
  type NavballVectors, type Quat, type SasMode, type Vec3,
} from './orbital';
import { preflight } from './preflight';
import {
  accelFactor, activeStageIndex, createStaging, errorFraction, flightQuality, handlingEff,
  oldestDepletedIndex, stepStaging, type StagingEvent, type StagingState,
} from './staging';
import type { Catalog, Id, MissionConfig, Rocket, Stage } from './types';

export type FlightPhase = 'launch' | 'orbit' | 'transfer' | 'capture' | 'landing' | 'ended';

export interface FlightInput {
  /** Laju perubahan throttle: +1 (W) naik, -1 (S) turun. */
  throttle: number;
  /** Setel throttle langsung (0..1, misal Z = 1, X = 0). */
  setThrottle?: number;
  /** +1 = hidung turun ke cakrawala. */
  pitch: number;
  yaw: number;
  /** -1 (A) kiri, +1 (D) kanan. */
  roll: number;
  /** Tombol F (satu kali per penekanan). */
  jettison: boolean;
  boost: boolean;
  precision: boolean;
  /** Perubahan indeks time warp (-1 lambatkan, +1 percepat). */
  warp?: number;
  /** Setel indeks time warp langsung (tombol HUD). */
  setWarpIndex?: number;
  /** Aktifkan warp otomatis sampai jendela burn / SOI tujuan. */
  warpToTarget?: boolean;
  /** Ubah mode SAS Navball. */
  sasMode?: SasMode;
}

export const NO_INPUT: FlightInput = { throttle: 0, pitch: 0, yaw: 0, roll: 0, jettison: false, boost: false, precision: false };

export type FlightEvent =
  | StagingEvent
  | { type: 'fairing' }
  | { type: 'phase'; phase: FlightPhase }
  | { type: 'burn_complete'; result: TransferResult }
  | { type: 'touchdown'; outcome: TouchdownOutcome }
  | { type: 'rocket_crash'; altitudeKm: number }
  | { type: 'ended'; failed: boolean };

export interface FlightSimConfig {
  destinationId: Id;
  rocket: Rocket;
  m0Kg: number;
  mfKg: number;
  ispS: number;
  thrustN: number;
  dvRequiredMs: number;
  gravity: number;
  instrumentIds: Id[];
  tightMargin: boolean;
  seed: number;
}

export function createFlightSimConfig(config: MissionConfig, catalog: Catalog): FlightSimConfig {
  const a = resolveAssembly(config, catalog);
  return {
    destinationId: a.destination.id,
    rocket: a.rocket,
    m0Kg: initialMassKg(a),
    mfKg: dryMassKg(a),
    ispS: engineIsp(a),
    thrustN: engineThrustN(a),
    dvRequiredMs: dvRequiredMs(a),
    gravity: a.destination.gravity,
    instrumentIds: [...config.instrumentIds],
    tightMargin: preflight(config, catalog).tightMargin,
    seed: config.seed,
  };
}

/**
 * Indeks `ORBITAL.warpSteps` untuk fase coast berdasarkan ETA (detik waktu simulasi) sampai tiba: warp terbesar yang
 * masih menyisakan >= `FLIGHT.coastWarpStepRealSec` detik nyata. Hasilnya turun bertahap (mis. 10000x -> 1000x -> 250x -> 50x
 * -> 10x -> 1x) saat tujuan mendekat, tidak melompat dari warp maksimum ke permukaan. ETA <= 0 berarti 1x.
 * Warp di atas `FLIGHT.coastWarpSoftMax` (100.000x) hanya dipakai bila masih >= `FLIGHT.coastWarpTopRealSec` detik nyata di warp itu:
 * Mars (ETA jutaan detik) ya, Bulan (ETA sekitar 204.000 detik, hanya sekitar 2 detik di 100.000x) puncaknya 10.000x.
 */
export function coastWarpIndex(etaSec: number): number {
  const steps = ORBITAL.warpSteps;
  let idx = 0;
  if (!(etaSec > 0)) return idx;
  for (let i = 0; i < steps.length; i++) {
    const realSec = etaSec / steps[i];
    if (realSec < FLIGHT.coastWarpStepRealSec) continue;
    if (steps[i] > FLIGHT.coastWarpSoftMax && realSec < FLIGHT.coastWarpTopRealSec) continue;
    idx = i;
  }
  return idx;
}

const SEED_SALT = 0x9e3779b9;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function stageDefaults(stage: Stage, payloadKg: number, index: number, totalStages: number): {
  dryMassKg: number;
  fuelKg: number;
  thrustN: number;
  ispSlS: number;
  ispVacS: number;
} {
  const scale = Math.max(1, payloadKg / 15_000);
  const ispVacS = stage.ispVacS ?? (index === totalStages - 1 ? 450 : 320);
  const ispSlS = stage.ispSlS ?? (index === 0 ? 280 : ispVacS * 0.9);
  const thrustN = (stage.thrustKn ?? (index === 0 ? 7500 * scale : 1000 * scale)) * 1000;
  const fuelKg = stage.fuelKg ?? Math.max(5_000, (thrustN / (ispVacS * G0)) * stage.burnSec);
  const dryMassKg = stage.dryMassKg ?? fuelKg * 0.08;
  return { dryMassKg, fuelKg, thrustN, ispSlS, ispVacS };
}

/**
 * Simulasi penerbangan & mekanika orbit 3D skala penuh:
 * - Peluncuran 3D RK4 dari LC-39A dengan gravitasi 1/r^2, drag atmosfer, Max-Q, dan rotasi Bumi
 * - Orbit parkir Keplerian 3D nyata (apoapsis, periapsis, inklinasi, eksentrisitas, perioda)
 * - Transfer antarplanet / translunar menggunakan Navball + burn Tsiolkovsky + Time Warp jarak nyata
 * - Capture & Powered Descent dengan vektor dorong miring serta drag atmosfer Mars
 */
export class FlightSim {
  phase: FlightPhase = 'launch';
  phaseTimeSec = 0;
  elapsedSec = 0;
  /** Total waktu misi tersimulasi termasuk Time Warp (detik). */
  missionTimeSec = 0;
  throttle = 0;
  staging: StagingState;
  pitchDeg: number = FLIGHT.launchStartPitchDeg;
  progress = 0;
  altitudeKm = 0;
  fairingSeparated = false;
  aimYawDeg = 0;
  aimPitchDeg = 0;
  markerYawDeg = 0;
  markerPitchDeg = 0;
  deviationDeg = 0;
  flightQuality = 1;
  errorFraction = 0;
  transfer: TransferResult | null = null;
  landing: LandingState | null = null;
  touchdown: { outcome: TouchdownOutcome; factor: number } | null = null;
  instrumentsLost: Id[] = [];
  failCodes: ReviewCode[] = [];
  cushionActive = false;
  /** Penyesuaian delta-v dari event penerbangan (m/s). */
  dvAdjustMs = 0;
  eventsHandledWell = 0;
  handledEventIds: Id[] = [];

  // --- State Fisika 3D & Orbit Keplerian ---
  bodyId: BodyId = 'earth';
  body: CelestialBodySpec = BODIES.earth;
  r: Vec3;
  v: Vec3;
  att: Quat;
  kepler: KeplerianElements;
  navball: NavballVectors;
  lvlh: LvlhAttitude;
  sasMode: SasMode = 'ascent';
  timeWarpIndex = 0;
  timeWarp = 1;
  warpToTargetActive = false;

  twr = 0;
  dynamicPressurePa = 0;
  maxQPa = 0;
  mach = 0;
  surfaceSpeedMs = 0;
  verticalSpeedMs = 0;
  coastEtaSec = 0;

  spacecraftFuelKg: number;
  distanceToTargetM: number;
  coastSubPhase = false;
  transferTargetDvMs: number;
  transferDoneDvMs = 0;
  captureTargetDvMs: number;
  captureDoneDvMs = 0;
  burnTimeRemainingSec = 0;
  windowRemainingSec: number = FLIGHT.orbitParkSec;

  crashed = false;

  private readonly rng: Rng;
  private readonly targetBodyId: BodyId;
  private readonly lastStage: number;
  private readonly stageSpecs: ReturnType<typeof stageDefaults>[];
  private liftoff = false;
  private transferReleasedSpacecraft = false;
  private devSum = 0;
  private thrustTime = 0;
  private maneuverWorldDir: Vec3;

  constructor(readonly cfg: FlightSimConfig) {
    this.rng = createRng((cfg.seed ^ SEED_SALT) >>> 0);
    this.targetBodyId = cfg.destinationId === 'mars' ? 'mars' : 'moon';
    this.staging = createStaging(cfg.rocket.stages.map((s) => s.burnSec));
    this.lastStage = cfg.rocket.stages.length - 1;
    this.stageSpecs = cfg.rocket.stages.map((s, i) => stageDefaults(s, cfg.rocket.payloadToLeoKg, i, cfg.rocket.stages.length));

    const init = launchpadInitialState(BODIES.earth);
    this.r = init.r;
    this.v = init.v;
    this.att = init.att;

    this.spacecraftFuelKg = Math.max(0, cfg.m0Kg - cfg.mfKg);
    const targetSpec = BODIES[this.targetBodyId];
    this.distanceToTargetM = targetSpec.distanceFromEarthM;
    this.transferTargetDvMs = this.targetBodyId === 'mars' ? ORBITAL.mars.tmiDvMs : ORBITAL.moon.tliDvMs;
    this.captureTargetDvMs = this.targetBodyId === 'mars' ? ORBITAL.mars.moiDvMs : ORBITAL.moon.loiDvMs;

    this.kepler = computeKeplerian(this.r, this.v, this.body);
    this.maneuverWorldDir = vecNorm(this.v);
    this.navball = computeNavballVectors(this.r, this.v, this.maneuverWorldDir);
    this.lvlh = attitudeToLvlh(this.att, this.r);
    this.pitchDeg = this.lvlh.pitchDeg;
    this.updateAeroAndBurnMetrics(0);
  }

  get handling(): number {
    return handlingEff(this.cfg.rocket.handling, this.staging.jettisoned);
  }

  get ended(): boolean {
    return this.phase === 'ended';
  }

  get failed(): boolean {
    return this.failCodes.some((c) => c === 'LAUNCH_FAIL' || c === 'LOW_FUEL' || c === 'CRASH_LANDING');
  }

  get falling(): boolean {
    if (this.phase !== 'launch' || !this.liftoff) return false;
    const radialVel = vecDot(this.v, vecNorm(this.r));
    return radialVel < -15 && this.kepler.altitudeM < ORBITAL.earth.atmoTopM && this.twr < 1;
  }

  get jettisonPrompt(): boolean {
    if (this.phase === 'capture' && !this.transferReleasedSpacecraft) return true;
    const depleted = oldestDepletedIndex(this.staging);
    return depleted >= 0 && depleted < this.lastStage;
  }

  get landingCushionActive(): boolean {
    return this.phase === 'landing' && this.cushionActive;
  }

  get fuelDisplayKg(): number {
    if (this.landing) return this.landing.fuelKg;
    return this.spacecraftFuelKg;
  }

  get landingParams(): LandingParams {
    return {
      thrustN: this.cfg.thrustN,
      ispS: this.cfg.ispS,
      dryMassKg: this.cfg.mfKg,
      gravity: this.cfg.gravity,
      bodyId: this.targetBodyId,
      cdAreaM2: this.targetBodyId === 'mars' ? 14 : 0,
    };
  }

  /** Massa total roket + wahana saat ini (kg). */
  currentTotalMassKg(): number {
    let m = this.cfg.mfKg + this.spacecraftFuelKg;
    if (this.phase === 'landing') return m;
    for (let i = 0; i < this.staging.stages.length; i++) {
      const st = this.staging.stages[i];
      if (st.phase === 'jettisoned') continue;
      if (i === this.lastStage && this.transferReleasedSpacecraft) continue;
      const spec = this.stageSpecs[i];
      const frac = this.cfg.rocket.stages[i].burnSec > 0
        ? clamp(st.burnRemainingSec / this.cfg.rocket.stages[i].burnSec, 0, 1)
        : 0;
      m += spec.dryMassKg + spec.fuelKg * frac;
    }
    return m;
  }

  hoverThrottle(): number {
    const mass = this.cfg.mfKg + (this.landing?.fuelKg ?? this.spacecraftFuelKg);
    return this.cfg.thrustN > 0 ? clamp((mass * this.cfg.gravity) / this.cfg.thrustN, 0, 1) : 1;
  }

  private setPhase(phase: FlightPhase, events: FlightEvent[]): void {
    this.phase = phase;
    this.phaseTimeSec = 0;
    events.push({ type: 'phase', phase });
  }

  private end(events: FlightEvent[]): void {
    this.timeWarpIndex = 0;
    this.timeWarp = 1;
    this.phase = 'ended';
    events.push({ type: 'ended', failed: this.failed });
  }

  private rotationRate(input: FlightInput): number {
    return FLIGHT.rotationRateDegS * this.handling * (input.precision ? FLIGHT.precisionFactor : 1);
  }

  private updateTimeWarp(input: FlightInput): void {
    const steps = ORBITAL.warpSteps;
    if (input.warpToTarget && (this.phase === 'orbit' || (this.phase === 'transfer' && this.coastSubPhase))) {
      this.warpToTargetActive = true;
    }
    if (input.setWarpIndex !== undefined) {
      this.warpToTargetActive = false;
      this.timeWarpIndex = clamp(Math.round(input.setWarpIndex), 0, steps.length - 1);
    } else if (input.warp) {
      this.warpToTargetActive = false;
      this.timeWarpIndex = clamp(this.timeWarpIndex + Math.sign(input.warp), 0, steps.length - 1);
    }
    if (input.sasMode) this.sasMode = input.sasMode;

    if (this.warpToTargetActive) {
      if (this.phase === 'orbit') {
        this.timeWarpIndex = 4; // 50x melewati sisa jendela orbit parkir
      } else if (this.phase === 'transfer' && this.coastSubPhase) {
        this.timeWarpIndex = coastWarpIndex(this.coastEtaSec);
      } else {
        this.warpToTargetActive = false;
        this.timeWarpIndex = 0;
      }
    }

    const maxAllowed = this.maxAllowedWarpIndex();
    if (this.timeWarpIndex > maxAllowed) this.timeWarpIndex = maxAllowed;
    this.timeWarp = steps[this.timeWarpIndex];
  }

  private maxAllowedWarpIndex(): number {
    const steps = ORBITAL.warpSteps;
    if (this.phase === 'landing') {
      // Pendaratan: physics warp (<= maxPhysicsWarp) hanya jauh di atas permukaan; di bawah warpMinAltM selalu 1x untuk presisi.
      if (!this.landing || this.landing.altitudeM < FLIGHT.landing.warpMinAltM) return 0;
      const idx = steps.findIndex((w) => w > ORBITAL.maxPhysicsWarp);
      return idx < 0 ? steps.length - 1 : idx - 1;
    }
    const inAtmo = this.body.seaLevelDensity > 0 && this.kepler.altitudeM < this.body.atmoTopM;
    const burning = this.throttle > 0.01;
    if (burning || inAtmo) {
      // Maksimal physics warp 10x saat di atmosfer atau saat mesin menyala
      const idx = steps.findIndex((w) => w > ORBITAL.maxPhysicsWarp);
      return idx < 0 ? steps.length - 1 : idx - 1;
    }
    return steps.length - 1;
  }

  private updateThrottle(input: FlightInput, dt: number): void {
    if (this.phase === 'landing') {
      this.updateLandingThrottle(input, dt);
      return;
    }
    if (input.setThrottle !== undefined) {
      this.throttle = clamp(input.setThrottle, 0, 1);
      return;
    }
    const rate = FLIGHT.throttleRatePerSec * (input.precision ? FLIGHT.precisionFactor : 1);
    if (input.throttle !== 0) {
      this.throttle = clamp(this.throttle + input.throttle * rate * dt, 0, 1);
    } else if (FLIGHT.throttleDecayPerSec > 0) {
      this.throttle = clamp(this.throttle - FLIGHT.throttleDecayPerSec * dt, 0, 1);
    }
  }

  private updateLandingThrottle(input: FlightInput, dt: number): void {
    const l = this.landing;
    if (!l) return;
    const hover = this.hoverThrottle();
    const mass = this.cfg.mfKg + l.fuelKg;
    const L = FLIGHT.landing;

    // Target throttle absolut (autopilot): geser menuju target dengan laju naik/turun yang sama seperti kendali manual,
    // tanpa overshoot walau beberapa sub-step warp memakai input yang sama.
    if (input.setThrottle !== undefined) {
      const target = clamp(input.setThrottle, 0, 1);
      const maxStep = (target > this.throttle ? L.throttleRatePerSec : L.throttleDecayPerSec) * dt;
      this.throttle = clamp(this.throttle + clamp(target - this.throttle, -maxStep, maxStep), 0, 1);
      return;
    }

    if (input.precision) {
      const targetVy = l.altitudeM <= 40
        ? -L.cushionTargetVy
        : -clamp(L.cushionTargetVy + 0.025 * (l.altitudeM - 40), L.cushionTargetVy, 55);
      const tiltRad = (l.tiltDeg * Math.PI) / 180;
      const cosTilt = Math.max(0.35, Math.cos(tiltRad));
      const wantAccel = clamp(2.5 * (targetVy - l.vy) + input.throttle * 5, -this.cfg.gravity, 35);
      const wantThrottle = this.cfg.thrustN > 0
        ? clamp(((wantAccel + this.cfg.gravity) * mass) / (this.cfg.thrustN * cosTilt), 0, 1)
        : 0;
      const k = 1 - Math.exp(-8 * dt);
      this.throttle = clamp(this.throttle + (wantThrottle - this.throttle) * k, 0, 1);
      return;
    }

    if (input.throttle > 0) {
      const maxThrust = l.vy > 1.0 ? Math.max(hover * 1.2, 0.1) : 1.0;
      this.throttle = clamp(this.throttle + input.throttle * L.throttleRatePerSec * dt, 0, maxThrust);
    } else if (input.throttle < 0) {
      this.throttle = clamp(this.throttle + input.throttle * L.throttleDecayPerSec * dt, 0, 1);
    } else {
      if (l.vy > 0) this.throttle = clamp(this.throttle - L.throttleDecayPerSec * dt, 0, 1);
      else if (this.throttle > hover) this.throttle = Math.max(hover, this.throttle - 1.2 * dt);
    }
  }

  private steerAttitude(input: FlightInput, dt: number): void {
    // Kunci sikap tegak di landasan dan saat melewati menara peluncuran
    if (this.phase === 'launch' && (!this.liftoff || this.kepler.altitudeM < FLIGHT.padLockAltitudeM)) {
      this.att = uprightAttitudeAt(this.r);
      return;
    }
    const manualSteer = Math.abs(input.pitch) > 0.001 || Math.abs(input.yaw) > 0.001 || Math.abs(input.roll) > 0.001;
    if (manualSteer) {
      const rateRad = this.rotationRate(input) * DEG_TO_RAD;
      this.att = rotateAttitudeLocal(
        this.att,
        input.pitch * rateRad * dt,
        input.yaw * rateRad * dt,
        input.roll * rateRad * dt,
      );
      return;
    }
    const target = this.sasMode === 'ascent' && this.phase === 'launch'
      ? ascentGuidanceDir(this.r, this.v, this.kepler, this.body, ORBITAL.earth.parkOrbitAltM)
      : sasTargetVector(this.sasMode, this.navball, this.r);
    if (target) {
      const slewRad = ORBITAL.sasSlewRateDegS * this.handling * DEG_TO_RAD;
      this.att = slewAttitudeToward(this.att, target, slewRad, dt);
    }
  }

  private updateAeroAndBurnMetrics(thrustN: number): void {
    const mass = Math.max(1, this.currentTotalMassKg());
    const rMag = Math.max(1, vecLen(this.r));
    const localG = this.body.mu / (rMag * rMag);
    this.twr = localG > 0 ? thrustN / (mass * localG) : 0;

    const aero = aeroState(this.body, this.r, this.v, ORBITAL.defaultCdAreaM2);
    this.dynamicPressurePa = aero.dynamicPressurePa;
    if (aero.dynamicPressurePa > this.maxQPa) this.maxQPa = aero.dynamicPressurePa;
    this.mach = aero.mach;
    this.surfaceSpeedMs = aero.airSpeedMs;
    this.verticalSpeedMs = vecDot(this.v, vecNorm(this.r));

    this.kepler = computeKeplerian(this.r, this.v, this.body);
    this.altitudeKm = Math.max(0, this.kepler.altitudeM / 1000);
    this.lvlh = attitudeToLvlh(this.att, this.r);
    this.pitchDeg = clamp(this.lvlh.pitchDeg, -90, 90);
    this.navball = computeNavballVectors(this.r, this.v, this.maneuverWorldDir);
    const coastSpeedMs = this.targetBodyId === 'mars' ? 14_500 : 1_850;
    const soiStop = BODIES[this.targetBodyId].soiRadiusM * 0.1;
    this.coastEtaSec = this.phase === 'transfer' && this.coastSubPhase
      ? Math.max(0, (this.distanceToTargetM - soiStop) / coastSpeedMs)
      : 0;

    const active = activeStageIndex(this.staging);
    const activeEngine = active >= 0 && this.phase === 'launch'
      ? { thrustN: this.stageSpecs[active].thrustN, ispS: this.stageSpecs[active].ispVacS }
      : { thrustN: this.cfg.thrustN, ispS: this.cfg.ispS };
    const dvRem = this.phase === 'transfer'
      ? Math.max(0, this.transferTargetDvMs - this.transferDoneDvMs)
      : this.phase === 'capture'
        ? Math.max(0, this.captureTargetDvMs - this.captureDoneDvMs)
        : 0;
    this.burnTimeRemainingSec = burnTimeSec(mass, dvRem, activeEngine.thrustN, activeEngine.ispS);
  }

  /** Maju satu frame simulasi; menerapkan sub-step fisika jika Time Warp > 1. */
  step(input: FlightInput, dt: number): FlightEvent[] {
    const events: FlightEvent[] = [];
    if (this.ended) return events;

    this.elapsedSec += dt;
    this.updateTimeWarp(input);
    this.updateThrottle(input, dt);
    this.cushionActive = this.phase === 'landing' && Boolean(input.precision);

    if (this.phase === 'landing') {
      // Physics warp pendaratan: n sub-step berukuran tetap `dt` per frame (deterministik; fisika tidak pernah memakai dt besar).
      // Throttle diperbarui di setiap sub-step agar slew laju throttle tetap benar terhadap waktu simulasi.
      const n = Math.max(1, Math.round(this.timeWarp));
      for (let k = 0; k < n && !this.ended; k++) {
        if (k > 0) this.updateThrottle(input, dt);
        this.missionTimeSec += dt;
        this.phaseTimeSec += dt;
        this.stepLandingPhase(input, dt, events);
      }
      return events;
    }

    // Sub-step adaptif: rapat (0.05s) saat mesin/atmosfer aktif; longgar (<=25s) saat coast vakum berkecepatan warp tinggi
    const simDtTotal = dt * this.timeWarp;
    const burningOrAtmo = this.throttle > 0 || (this.body.seaLevelDensity > 0 && this.kepler.altitudeM < this.body.atmoTopM);
    const maxSubDt = burningOrAtmo ? 0.05 : (this.timeWarp >= 1000 ? 25 : 4);
    const maxSteps = burningOrAtmo ? 200 : 40;
    const steps = Math.max(1, Math.min(maxSteps, Math.ceil(simDtTotal / maxSubDt)));
    const subDt = simDtTotal / steps;

    for (let s = 0; s < steps && !this.ended; s++) {
      const prevPhase = this.readPhase();
      this.stepSub(input, subDt, s === 0 ? input.jettison : false, events);
      // Hentikan sub-step warp besar seketika saat berganti fase (mis. coast 1Mx -> capture 1x).
      const nowPhase = this.readPhase();
      if (nowPhase !== prevPhase || nowPhase === 'landing') break;
    }
    return events;
  }

  /** Baca fase terkini tanpa penyempitan tipe oleh TypeScript (`stepSub` dapat mengubah `this.phase`). */
  private readPhase(): FlightPhase {
    return this.phase;
  }

  private stepSub(input: FlightInput, dt: number, jettisonPressed: boolean, events: FlightEvent[]): void {
    this.missionTimeSec += dt;
    this.phaseTimeSec += dt;
    this.steerAttitude(input, dt);

    const active = activeStageIndex(this.staging);
    const rocketDriving = this.phase === 'launch' || (this.phase === 'transfer' && !this.coastSubPhase && active >= 0 && !this.transferReleasedSpacecraft);
    const lockedLast = active === this.lastStage && this.phase === 'orbit';
    const stagingThrottle = rocketDriving && !lockedLast && this.throttle > 0
      ? this.throttle * accelFactor(this.staging)
      : 0;

    const res = stepStaging(this.staging, dt, stagingThrottle, jettisonPressed && this.phase !== 'capture', true);
    this.staging = res.state;
    events.push(...res.events);

    switch (this.phase) {
      case 'launch':
        this.stepLaunch(dt, events);
        break;
      case 'orbit':
        this.stepOrbit(dt, events);
        break;
      case 'transfer':
        this.stepTransfer(dt, events);
        break;
      case 'capture':
        this.stepCapture(dt, jettisonPressed, events);
        break;
    }
  }

  private stepLaunch(dt: number, events: FlightEvent[]): void {
    const active = activeStageIndex(this.staging);
    const mass = Math.max(1, this.currentTotalMassKg());
    let thrustN = 0;
    const anyStageFuel = active >= 0 && (active < this.lastStage || this.staging.stages[this.lastStage].burnRemainingSec > 0);

    if (active >= 0 && anyStageFuel && this.throttle > 0) {
      const spec = this.stageSpecs[active];
      const eff = effectiveEngineStats(spec.thrustN, spec.ispSlS, spec.ispVacS, this.body, this.kepler.altitudeM);
      thrustN = eff.thrustN * this.throttle * accelFactor(this.staging);
    }

    const rMag = Math.max(1, vecLen(this.r));
    const localG = this.body.mu / (rMag * rMag);
    const currentTwr = mass * localG > 0 ? thrustN / (mass * localG) : 0;

    // Roket masih bertumpu di landasan hingga daya dorong melampaui berat (TWR > 1)
    if (!this.liftoff && this.kepler.altitudeM <= 1 && currentTwr <= 1.0) {
      const { up } = lvlhBasis(this.r);
      // Pertahankan posisi di permukaan Bumi sambil ikut berotasi
      const next = stepOrbitRK4({
        r: this.r, v: this.v, massKg: mass,
        thrustN: mass * localG, noseDir: up, cdAreaM2: 0, body: this.body,
      }, dt);
      this.r = vecScale(vecNorm(next.r), this.body.radiusM);
      this.v = vec3(-this.body.rotOmegaRadS * this.r.y, this.body.rotOmegaRadS * this.r.x, 0);
      this.progress = 0;
      this.updateAeroAndBurnMetrics(thrustN);
      return;
    }

    this.liftoff = true;
    const nose = quatRotateVec(this.att, vec3(0, 0, 1));
    const next = stepOrbitRK4({
      r: this.r,
      v: this.v,
      massKg: mass,
      thrustN,
      noseDir: nose,
      cdAreaM2: ORBITAL.defaultCdAreaM2,
      body: this.body,
    }, dt);
    this.r = next.r;
    this.v = next.v;
    this.updateAeroAndBurnMetrics(thrustN);

    // Cek menabrak permukaan Bumi kembali setelah lepas landas
    if (this.kepler.altitudeM <= 0 && this.phaseTimeSec > 1.5) {
      this.failCodes.push('LAUNCH_FAIL');
      this.crashed = true;
      events.push({ type: 'rocket_crash', altitudeKm: 0 });
      this.throttle = 0;
      this.end(events);
      return;
    }

    const altProgress = clamp(this.kepler.altitudeM / ORBITAL.earth.parkOrbitAltM, 0, 1);
    const velProgress = clamp((this.kepler.speedMs - 409) / (7784 - 409), 0, 1);
    this.progress = clamp(0.45 * altProgress + 0.55 * velProgress, 0, 1);

    if (!this.fairingSeparated && this.kepler.altitudeM >= ORBITAL.fairingSepAltM) {
      this.fairingSeparated = true;
      events.push({ type: 'fairing' });
    }

    // Orbit LEO stabil tercapai: periapsis di atas atmosfer (>= 140 km) & apoapsis >= 170 km
    const stableLeo = !this.kepler.hyperbolic
      && this.kepler.periapsisAltM >= ORBITAL.earth.minSafePeriapsisAltM
      && this.kepler.apoapsisAltM >= 170_000;
    if (stableLeo) {
      this.progress = 1;
      this.throttle = 0;
      this.maneuverWorldDir = vecNorm(this.v);
      this.windowRemainingSec = FLIGHT.orbitParkSec;
      if (this.sasMode === 'ascent') this.sasMode = 'prograde';
      this.setPhase('orbit', events);
      return;
    }

    // Jika semua tahap roket habis dan orbit stabil tidak tercapai, peluncuran gagal
    if (!anyStageFuel) {
      this.failCodes.push('LAUNCH_FAIL');
      this.crashed = true;
      events.push({ type: 'rocket_crash', altitudeKm: this.altitudeKm });
      this.throttle = 0;
      this.end(events);
    }
  }

  private stepOrbit(dt: number, events: FlightEvent[]): void {
    const mass = Math.max(1, this.currentTotalMassKg());
    const nose = quatRotateVec(this.att, vec3(0, 0, 1));
    let thrustN = 0;
    if (this.throttle > 0 && this.spacecraftFuelKg > 0) {
      thrustN = this.cfg.thrustN * this.throttle;
      const burned = this.cfg.ispS > 0 ? (thrustN * dt) / (this.cfg.ispS * G0) : 0;
      this.spacecraftFuelKg = Math.max(0, this.spacecraftFuelKg - burned);
    }

    const next = stepOrbitRK4({
      r: this.r, v: this.v, massKg: mass, thrustN, noseDir: nose, cdAreaM2: 0, body: this.body,
    }, dt);
    this.r = next.r;
    this.v = next.v;
    this.maneuverWorldDir = vecNorm(this.v);
    this.updateAeroAndBurnMetrics(thrustN);

    this.windowRemainingSec = Math.max(0, this.windowRemainingSec - dt);
    if (this.windowRemainingSec > 0) return;

    // Penilaian kualitas peluncuran berbasis hasil fisik orbit (bukan deviasi jadwal sudut terbuka)
    const apoErr = Math.abs(this.kepler.apoapsisAltM - ORBITAL.earth.parkOrbitAltM) / 200_000;
    const periMargin = clamp((this.kepler.periapsisAltM - ORBITAL.earth.minSafePeriapsisAltM) / 60_000, 0, 1);
    const orbitScore = clamp(0.85 + 0.15 * periMargin - clamp(apoErr * 0.25, 0, 0.35), 0.55, 1);
    this.flightQuality = flightQuality(orbitScore, this.staging.lateStageCount);
    this.throttle = 0;
    this.timeWarpIndex = 0;
    this.timeWarp = 1;
    this.warpToTargetActive = false;
    this.coastSubPhase = false;
    if (this.sasMode !== 'off') this.sasMode = 'maneuver';
    this.setPhase('transfer', events);
  }

  private stepTransfer(dt: number, events: FlightEvent[]): void {
    const mass = Math.max(1, this.currentTotalMassKg());
    const nose = quatRotateVec(this.att, vec3(0, 0, 1));
    this.maneuverWorldDir = vecNorm(this.v);

    // Hitung simpangan sudut hidung terhadap vektor Manuver/Prograde di Navball
    const dotAlign = clamp(vecDot(nose, this.maneuverWorldDir), -1, 1);
    this.deviationDeg = Math.acos(dotAlign) * RAD_TO_DEG;
    this.aimPitchDeg = 0;
    this.aimYawDeg = 0;
    this.markerPitchDeg = clamp(-this.lvlh.pitchDeg, -FLIGHT.markerMaxDeg, FLIGHT.markerMaxDeg);
    this.markerYawDeg = clamp(this.deviationDeg, -FLIGHT.markerMaxDeg, FLIGHT.markerMaxDeg);

    if (!this.coastSubPhase) {
      let thrustN = 0;
      const active = activeStageIndex(this.staging);
      if (this.throttle > 0) {
        if (active >= 0 && !this.transferReleasedSpacecraft && this.staging.stages[active].phase === 'burning') {
          const spec = this.stageSpecs[active];
          thrustN = spec.thrustN * this.throttle * accelFactor(this.staging);
        } else if (this.spacecraftFuelKg > 0) {
          thrustN = this.cfg.thrustN * this.throttle;
          const burned = this.cfg.ispS > 0 ? (thrustN * dt) / (this.cfg.ispS * G0) : 0;
          this.spacecraftFuelKg = Math.max(0, this.spacecraftFuelKg - burned);
        }
      }

      const next = stepOrbitRK4({
        r: this.r, v: this.v, massKg: mass, thrustN, noseDir: nose, cdAreaM2: 0, body: this.body,
      }, dt);
      this.r = next.r;
      this.v = next.v;

      if (thrustN > 0) {
        const dvStep = (thrustN / mass) * dt;
        const effectiveDv = dvStep * Math.max(0, dotAlign);
        this.transferDoneDvMs += effectiveDv;
        this.devSum += this.deviationDeg * this.throttle * dt;
        this.thrustTime += this.throttle * dt;
      }

      this.updateAeroAndBurnMetrics(thrustN);

      // Cek apakah bahan bakar tahap pendorong & wahana habis sebelum burn transfer tuntas
      const rocketStageHasFuel = active >= 0 && !this.transferReleasedSpacecraft && this.staging.stages[active].burnRemainingSec > 0;
      if (!rocketStageHasFuel && this.spacecraftFuelKg <= 0 && this.transferDoneDvMs < this.transferTargetDvMs) {
        this.failCodes.push('LOW_FUEL');
        this.end(events);
        return;
      }

      if (this.transferDoneDvMs >= this.transferTargetDvMs) {
        this.coastSubPhase = true;
        this.throttle = 0;
        const dev01 = this.thrustTime > 0 ? headingDeviation01(this.devSum / this.thrustTime) : 0;
        this.errorFraction = errorFraction(dev01, this.staging.lateStageCount);
        this.transfer = {
          burnCostMs: this.transferDoneDvMs,
          dvAvailableMs: Math.max(0, tsiolkovskyTotalRemaining(this.spacecraftFuelKg, this.cfg.mfKg, this.cfg.ispS) + this.transferDoneDvMs + this.dvAdjustMs),
          sufficient: true,
          fuelRemainingKg: this.spacecraftFuelKg,
        };
        events.push({ type: 'burn_complete', result: this.transfer });
      }
      return;
    }

    // Fase Coast antarplanet / translunar: melintasi jarak nyata ke SOI target!
    const coastSpeedMs = this.targetBodyId === 'mars' ? 14_500 : 1_850;
    this.distanceToTargetM = Math.max(0, this.distanceToTargetM - coastSpeedMs * dt);
    const next = stepOrbitRK4({
      r: this.r, v: this.v, massKg: mass, thrustN: 0, noseDir: nose, cdAreaM2: 0, body: this.body,
    }, dt);
    this.r = next.r;
    this.v = next.v;
    this.updateAeroAndBurnMetrics(0);

    const targetBody = BODIES[this.targetBodyId];
    if (this.distanceToTargetM <= targetBody.soiRadiusM * 0.1) {
      // Masuk Sphere of Influence Bulan / Mars: ganti pusat gravitasi ke planet target!
      this.bodyId = this.targetBodyId;
      this.body = targetBody;
      const captureAlt = targetBody.parkOrbitAltM;
      const rArrival = targetBody.radiusM + captureAlt;
      const vCirc = Math.sqrt(targetBody.mu / rArrival);
      const arrivalSpeed = vCirc + this.captureTargetDvMs;
      this.r = vec3(rArrival, 0, 0);
      this.v = vec3(0, arrivalSpeed, 0);
      this.maneuverWorldDir = vecNorm(vecScale(this.v, -1)); // Retrograde untuk orbit capture!
      this.timeWarpIndex = 0;
      this.timeWarp = 1;
      this.warpToTargetActive = false;
      if (this.sasMode !== 'off') this.sasMode = 'retrograde';
      this.updateAeroAndBurnMetrics(0);
      this.setPhase('capture', events);
    }
  }

  private stepCapture(dt: number, jettisonPressed: boolean, events: FlightEvent[]): void {
    const mass = Math.max(1, this.currentTotalMassKg());
    const nose = quatRotateVec(this.att, vec3(0, 0, 1));
    this.maneuverWorldDir = vecNorm(vecScale(this.v, -1));

    let thrustN = 0;
    if (this.throttle > 0 && this.spacecraftFuelKg > 0) {
      thrustN = this.cfg.thrustN * this.throttle;
      const burned = this.cfg.ispS > 0 ? (thrustN * dt) / (this.cfg.ispS * G0) : 0;
      this.spacecraftFuelKg = Math.max(0, this.spacecraftFuelKg - burned);
    }

    const next = stepOrbitRK4({
      r: this.r, v: this.v, massKg: mass, thrustN, noseDir: nose, cdAreaM2: this.bodyId === 'mars' ? 14 : 0, body: this.body,
    }, dt);
    this.r = next.r;
    this.v = next.v;

    if (thrustN > 0) {
      const retroDot = Math.max(0, vecDot(nose, this.maneuverWorldDir));
      this.captureDoneDvMs += (thrustN / mass) * dt * retroDot;
    }
    this.updateAeroAndBurnMetrics(thrustN);

    const autoReleaseCapture = !this.transferReleasedSpacecraft && this.phaseTimeSec >= STAGING.autoJettisonSec;
    if ((jettisonPressed || autoReleaseCapture) && !this.transferReleasedSpacecraft) {
      this.transferReleasedSpacecraft = true;
      const last = this.staging.stages[this.lastStage];
      if (last && last.phase !== 'jettisoned') {
        last.phase = 'jettisoned';
        this.staging.jettisoned += 1;
        if (autoReleaseCapture) this.staging.lateStageCount += 1;
        events.push({ type: 'jettison', stageIndex: this.lastStage, late: autoReleaseCapture, auto: autoReleaseCapture });
      }
    }

    const captured = !this.kepler.hyperbolic && this.kepler.eccentricity <= 0.35;
    if ((captured || this.captureDoneDvMs >= this.captureTargetDvMs) && this.transferReleasedSpacecraft) {
      this.landing = createLanding(this.spacecraftFuelKg, FLIGHT.landing.startAltitudeM, FLIGHT.landing.startVy, 95);
      this.throttle = 0;
      this.timeWarpIndex = 0;
      this.timeWarp = 1;
      this.setPhase('landing', events);
      return;
    }

    if (this.spacecraftFuelKg <= 0 && !captured && this.captureDoneDvMs < this.captureTargetDvMs) {
      this.failCodes.push('LOW_FUEL');
      this.end(events);
    }
  }

  private stepLandingPhase(input: FlightInput, dt: number, events: FlightEvent[]): void {
    if (!this.landing) return;
    const rollInput = input.precision && Math.abs(input.roll) < 0.01
      ? clamp(-this.landing.tiltDeg * 0.18 - this.landing.vx * 0.06, -1, 1)
      : input.roll;
    this.landing = stepLanding(this.landing, {
      throttle01: this.throttle, rotate: rollInput, boost: input.boost, precision: input.precision,
    }, this.landingParams, dt);
    this.spacecraftFuelKg = this.landing.fuelKg;
    this.altitudeKm = this.landing.altitudeM / 1000;
    this.twr = this.landingParams.gravity > 0
      ? (this.cfg.thrustN * this.throttle) / ((this.cfg.mfKg + this.landing.fuelKg) * this.landingParams.gravity)
      : 0;
    if (!this.landing.landed) return;

    this.touchdown = classifyTouchdown(this.landing.vy, this.landing.tiltDeg, this.landing.vx);
    events.push({ type: 'touchdown', outcome: this.touchdown.outcome });
    if (this.touchdown.outcome === 'crash') this.failCodes.push('CRASH_LANDING');
    if (this.touchdown.outcome === 'damaged') {
      this.failCodes.push('DAMAGED_LANDING');
      this.instrumentsLost = rollInstrumentLoss(this.cfg.instrumentIds, this.rng);
    }
    if (this.landing.fuelOut && !this.failCodes.includes('LOW_FUEL')) this.failCodes.push('LOW_FUEL');
    this.end(events);
  }

  /** Terapkan penyesuaian delta-v dari event penerbangan. */
  applyDvAdjust(deltaMs: number): FlightEvent[] {
    this.dvAdjustMs += deltaMs;
    const events: FlightEvent[] = [];
    if (deltaMs < 0 && this.cfg.ispS > 0) {
      const m = this.cfg.mfKg + this.spacecraftFuelKg;
      const fuelLoss = m * (1 - Math.exp(deltaMs / (this.cfg.ispS * G0)));
      this.spacecraftFuelKg = Math.max(0, this.spacecraftFuelKg - fuelLoss);
      if (this.spacecraftFuelKg <= 0 && !this.ended) {
        this.failCodes.push('LOW_FUEL');
        this.end(events);
      }
    }
    if (this.transfer) {
      this.transfer = { ...this.transfer, fuelRemainingKg: this.spacecraftFuelKg };
    }
    return events;
  }

  /** Ringkasan hasil penerbangan; null jika belum selesai. */
  summary(): FlightSummary | null {
    if (!this.ended) return null;
    const codes = [...this.failCodes];
    if (this.staging.lateStageCount > 0) codes.push('LATE_STAGING');
    if (this.cfg.tightMargin) codes.push('OVER_MARGIN_TIGHT');
    return {
      failed: this.failed,
      failCodes: codes,
      flightQuality: this.flightQuality,
      errorFraction: this.errorFraction,
      lateStageCount: this.staging.lateStageCount,
      touchdown: this.touchdown?.outcome ?? null,
      touchdownFactor: this.touchdown?.factor ?? 0,
      instrumentsLost: this.instrumentsLost,
      fuelRemainingKg: this.landing?.fuelKg ?? this.spacecraftFuelKg,
      eventsHandledWell: this.eventsHandledWell,
      handledEventIds: [...this.handledEventIds],
    };
  }
}

function tsiolkovskyTotalRemaining(fuelKg: number, dryKg: number, ispS: number): number {
  if (ispS <= 0 || dryKg <= 0 || fuelKg <= 0) return 0;
  return ispS * G0 * Math.log((dryKg + fuelKg) / dryKg);
}
