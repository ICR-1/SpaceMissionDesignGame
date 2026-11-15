import { describe, expect, it } from 'vitest';
import { FIXED_DT, FLIGHT } from '../../src/core/constants';
import { defaultMission } from '../../src/core/missionBuilder';
import { makeAutopilot, type AutopilotOptions } from '../../src/rules/autopilot';
import {
  createFlightSimConfig, FlightSim, NO_INPUT, type FlightEvent,
} from '../../src/rules/flightSim';
import type { MissionConfig } from '../../src/rules/types';
import { catalog } from './helpers';

type Pilot = AutopilotOptions;
const SKILLED: Pilot = {};

const makePilot = (sim: FlightSim, pilot: Pilot) => makeAutopilot(sim, pilot);

function fly(config: MissionConfig, pilot: Pilot = SKILLED, maxSec = 900) {
  const sim = new FlightSim(createFlightSimConfig(config, catalog));
  const next = makePilot(sim, pilot);
  const events: FlightEvent[] = [];
  const phases: string[] = [sim.phase];
  while (!sim.ended && sim.elapsedSec < maxSec) {
    for (const e of sim.step(next(), FIXED_DT)) {
      events.push(e);
      if (e.type === 'phase') phases.push(e.phase);
      if (e.type === 'ended') phases.push('ended');
    }
  }
  return { sim, events, phases };
}

const moon = defaultMission('moon');
const mars = defaultMission('mars');
const jettisons = (events: FlightEvent[]) => events.filter((e) => e.type === 'jettison');

describe('simulasi penerbangan 3D Keplerian (NASA)', () => {
  it('pilot terampil: Bulan melewati semua fase (launch -> orbit -> transfer -> capture -> landing) tanpa gagal', () => {
    const { sim, phases } = fly(moon);
    expect(phases).toEqual(['launch', 'orbit', 'transfer', 'capture', 'landing', 'ended']);
    const s = sim.summary()!;
    expect(s.failed).toBe(false);
    expect(['perfect', 'success']).toContain(s.touchdown);
    expect(s.lateStageCount).toBe(0);
    expect(s.flightQuality).toBeGreaterThan(0.8);
    expect(s.fuelRemainingKg).toBeGreaterThan(0);
    expect(sim.landing?.landed).toBe(true);
  });

  it('Mars dapat diterbangkan sampai mendarat dengan Atlas V & SLS Block 1', () => {
    for (const rocketId of ['atlas_v', 'sls_block1']) {
      const { sim } = fly({ ...mars, rocketId });
      expect(sim.summary()!.failed, rocketId).toBe(false);
    }
  });

  it.each([['falcon_9', 2], ['atlas_v', 3], ['sls_block1', 3], ['saturn_v', 3]])('%s: jumlah F sama dengan jumlah tahap (%i)', (rocketId, n) => {
    const cfg = { ...moon, rocketId, fuelFraction: 0.9 };
    const { sim, events } = fly(cfg);
    expect(jettisons(events)).toHaveLength(n);
    expect(sim.staging.jettisoned).toBe(n);
    expect(sim.summary()!.lateStageCount).toBe(0);
  });

  it('lebih banyak tahap dilepas membuat roket lebih lincah (handlingEff naik 0,25 per tahap)', () => {
    const sim = new FlightSim(createFlightSimConfig({ ...moon, rocketId: 'atlas_v' }, catalog));
    const baseHandling = sim.handling;
    const { sim: done } = fly({ ...moon, rocketId: 'atlas_v', fuelFraction: 0.9 });
    expect(done.handling).toBeCloseTo(baseHandling + 0.75, 10);
  });

  it('deterministik: seed dan input sama menghasilkan hasil identik', () => {
    expect(fly(moon).sim.summary()).toEqual(fly(moon).sim.summary());
  });
});

describe('kunci pitch di landasan & kendali 3D', () => {
  it('input pitch/yaw/roll diabaikan di landasan dan saat di bawah ketinggian kunci menara', () => {
    const sim = new FlightSim(createFlightSimConfig(moon, catalog));
    const start = sim.pitchDeg;
    for (let i = 0; i < 120; i++) sim.step({ ...NO_INPUT, pitch: 1, yaw: 1 }, FIXED_DT);
    expect(sim.pitchDeg).toBeCloseTo(start, 3);
    while (sim.kepler.altitudeM < FLIGHT.padLockAltitudeM * 0.5) {
      sim.step({ ...NO_INPUT, setThrottle: 1, pitch: 1 }, FIXED_DT);
    }
    expect(sim.pitchDeg).toBeCloseTo(90, 1);
  });

  it('pitch bisa diatur setelah melewati ketinggian kunci menara', () => {
    const sim = new FlightSim(createFlightSimConfig(moon, catalog));
    while (sim.kepler.altitudeM < FLIGHT.padLockAltitudeM + 20) {
      sim.step({ ...NO_INPUT, setThrottle: 1, sasMode: 'off' }, FIXED_DT);
    }
    for (let i = 0; i < 30; i++) sim.step({ ...NO_INPUT, setThrottle: 1, sasMode: 'off', pitch: 1 }, FIXED_DT);
    expect(sim.pitchDeg).toBeLessThan(88);
  });
});

describe('bahan bakar wahana yang ditampilkan', () => {
  it('penuh saat peluncuran dan orbit, turun saat burn transfer/capture, sama dengan sisa akhir', () => {
    const sim = new FlightSim(createFlightSimConfig({ ...moon, rocketId: 'falcon_9' }, catalog));
    const full = sim.fuelDisplayKg;
    expect(full).toBeCloseTo(sim.cfg.m0Kg - sim.cfg.mfKg, 6);
    const next = makeAutopilot(sim, SKILLED);
    while (!sim.ended && sim.phase !== 'landing' && sim.elapsedSec < 900) {
      sim.step(next(), FIXED_DT);
    }
    expect(sim.fuelDisplayKg).toBeLessThan(full);
  });
});

describe('throttle menetap (W/S/Z/X) dan memotong mesin di atmosfer', () => {
  const fresh = () => new FlightSim(createFlightSimConfig(moon, catalog));
  const run = (sim: FlightSim, input: typeof NO_INPUT, seconds: number): FlightEvent[] => {
    const events: FlightEvent[] = [];
    for (let i = 0; i < Math.round(seconds / FIXED_DT) && !sim.ended; i++) events.push(...sim.step(input, FIXED_DT));
    return events;
  };

  it('di landasan tanpa menyalakan mesin roket diam: tidak jatuh dan tidak gagal', () => {
    const sim = fresh();
    run(sim, NO_INPUT, 20);
    expect(sim.altitudeKm).toBeCloseTo(0, 6);
    expect(sim.ended).toBe(false);
    expect(sim.falling).toBe(false);
  });

  it('throttle menetap di peluncuran/orbit saat W dilepas, Z=100% dan X=0%', () => {
    const sim = fresh();
    run(sim, { ...NO_INPUT, throttle: 1 }, 3);
    expect(sim.throttle).toBe(1);
    run(sim, NO_INPUT, 2);
    expect(sim.throttle).toBe(1);
    sim.step({ ...NO_INPUT, setThrottle: 0 }, FIXED_DT);
    expect(sim.throttle).toBe(0);
    sim.step({ ...NO_INPUT, setThrottle: 1 }, FIXED_DT);
    expect(sim.throttle).toBe(1);
  });

  it('tahap tidak terpakai selama thrust di bawah ambang angkat (TWR <= 1)', () => {
    const sim = fresh();
    run(sim, { ...NO_INPUT, setThrottle: 0.3 }, 0.5);
    const before = sim.staging.stages[0].burnRemainingSec;
    expect(sim.twr).toBeLessThan(1);
    run(sim, { ...NO_INPUT, setThrottle: 0 }, 1);
    expect(sim.staging.stages[0].burnRemainingSec).toBe(before);
  });

  it('mematikan mesin di atmosfer bawah ([X]) membuat roket jatuh & LAUNCH_FAIL dengan event rocket_crash', () => {
    const sim = fresh();
    run(sim, { ...NO_INPUT, setThrottle: 1 }, 20);
    expect(sim.altitudeKm).toBeGreaterThan(0.5);
    const events = run(sim, { ...NO_INPUT, setThrottle: 0 }, 90);
    expect(sim.ended).toBe(true);
    expect(events.some((e) => e.type === 'rocket_crash')).toBe(true);
    expect(sim.failed).toBe(true);
    expect(sim.summary()!.failCodes).toContain('LAUNCH_FAIL');
    expect(sim.crashed).toBe(true);
  });
});

describe('kegagalan dan penalti', () => {
  it('terbang vertikal murni tanpa gravity turn gagal mencapai orbit stabil (LAUNCH_FAIL)', () => {
    const { sim, phases } = fly(moon, { skipPitch: true });
    expect(phases).toEqual(['launch', 'ended']);
    const s = sim.summary()!;
    expect(s.failed).toBe(true);
    expect(s.failCodes).toContain('LAUNCH_FAIL');
  });

  it('delta-v wahana kurang saat burn menghasilkan LOW_FUEL', () => {
    // 2% tangki (280 kg) hanya memberi sekitar 350 m/s, jauh di bawah burn capture Bulan (850 m/s; tertangkap bila eksentrisitas
    // <= 0,35 butuh sekitar 585 m/s). Memakai 5% tidak lagi pasti kurang karena autopilot pendaratan kini efisien (suicide burn).
    const { sim, phases } = fly({ ...moon, fuelFraction: 0.02 });
    expect(phases).toContain('transfer');
    expect(sim.ended).toBe(true);
    expect(sim.summary()!.failCodes).toContain('LOW_FUEL');
  });

  it('touchdown dengan vy di atas 12 m/s menghasilkan CRASH_LANDING', () => {
    const { sim } = fly(moon, { skipLanding: true });
    const s = sim.summary()!;
    expect(s.failed).toBe(true);
    expect(s.touchdown).toBe('crash');
    expect(s.failCodes).toContain('CRASH_LANDING');
  });

  it('bahan bakar habis sebelum mendarat menghasilkan LOW_FUEL', () => {
    const cfg = createFlightSimConfig(moon, catalog);
    const sim = new FlightSim(cfg);
    const next = makePilot(sim, SKILLED);
    while (sim.phase !== 'landing') sim.step(next(), FIXED_DT);
    sim.landing!.fuelKg = 0.5;
    sim.landing!.fuelOut = false;
    while (!sim.ended) sim.step({ ...NO_INPUT, throttle: 1 }, FIXED_DT);
    const s = sim.summary()!;
    expect(s.failCodes).toContain('LOW_FUEL');
    expect(s.failed).toBe(true);
  });

  it('F tidak ditekan: tahap dilepas otomatis dan dihitung terlambat (LATE_STAGING)', () => {
    const sim = new FlightSim(createFlightSimConfig({ ...moon, rocketId: 'atlas_v' }, catalog));
    const p = makePilot(sim, SKILLED);
    const events: FlightEvent[] = [];
    while (!sim.ended && sim.elapsedSec < 2400) {
      const input = p();
      input.jettison = false;
      events.push(...sim.step(input, FIXED_DT));
    }
    const autoJettisons = jettisons(events).filter((e) => e.type === 'jettison' && e.auto && e.late);
    expect(autoJettisons.length).toBeGreaterThan(0);
    expect(sim.staging.lateStageCount).toBeGreaterThan(0);
    expect(sim.summary()!.failCodes).toContain('LATE_STAGING');
  });
});

describe('peristiwa dan prompt', () => {
  it('prompt F menyala saat tahap habis dan hilang setelah dilepas', () => {
    const sim = new FlightSim(createFlightSimConfig(moon, catalog));
    const p = makePilot(sim, SKILLED);
    expect(sim.jettisonPrompt).toBe(false);
    while (!sim.jettisonPrompt) sim.step({ ...p(), jettison: false }, FIXED_DT);
    sim.step({ ...NO_INPUT, jettison: true }, FIXED_DT);
    expect(sim.jettisonPrompt).toBe(false);
  });

  it('fairing membelah otomatis di atas 110 km (Garis Kármán)', () => {
    const { events, sim } = fly(moon);
    expect(events.filter((e) => e.type === 'fairing')).toHaveLength(1);
    expect(sim.fairingSeparated).toBe(true);
  });

  it('roket Atlas V 551: tahap pertama adalah Side Booster dan dilepas lebih dulu', () => {
    const { events } = fly({ ...moon, rocketId: 'atlas_v', fuelFraction: 0.9 });
    const first = events.find((e) => e.type === 'jettison');
    expect(first && first.type === 'jettison' && first.stageIndex).toBe(0);
  });
});

describe('kontrol kecepatan pendaratan (landing speed control)', () => {
  function startLandingSim() {
    const sim = new FlightSim(createFlightSimConfig(moon, catalog));
    const p = makePilot(sim, SKILLED);
    while (sim.phase !== 'landing') sim.step(p(), FIXED_DT);
    return sim;
  }

  it('W meningkatkan throttle pendaratan dengan respons cepat (2.0/s)', () => {
    const sim = startLandingSim();
    expect(sim.throttle).toBe(0);
    sim.step({ ...NO_INPUT, throttle: 1 }, 0.25);
    expect(sim.throttle).toBeCloseTo(0.5, 1);
  });

  it('S memotong throttle pendaratan dengan cepat (2.5/s)', () => {
    const sim = startLandingSim();
    sim.step({ ...NO_INPUT, throttle: 1 }, 0.5);
    expect(sim.throttle).toBeGreaterThan(0.8);
    sim.step({ ...NO_INPUT, throttle: -1 }, 0.2);
    expect(sim.throttle).toBeLessThan(0.6);
  });

  it('saat wahana naik (vy > 0), melepas W memotong throttle agar tidak meluncur kabur ke angkasa', () => {
    const sim = startLandingSim();
    sim.landing!.vy = 5;
    sim.throttle = 0.8;
    sim.step(NO_INPUT, 0.2);
    expect(sim.throttle).toBeLessThan(0.8);
  });

  it('tahan Spasi (precision cushion) mengatur kecepatan vertikal ke zona aman dan mendarat sempurna', () => {
    const sim = startLandingSim();
    expect(sim.phase).toBe('landing');
    expect(sim.landingCushionActive).toBe(false);

    let guard = 0;
    while (!sim.ended && guard++ < 60 * 350) {
      sim.step({ ...NO_INPUT, precision: true }, FIXED_DT);
      if (!sim.ended) expect(sim.landingCushionActive).toBe(true);
    }
    expect(sim.ended).toBe(true);
    const summary = sim.summary()!;
    expect(summary.failed).toBe(false);
    expect(summary.touchdown).toBe('perfect');
    expect(Math.abs(sim.landing!.vy)).toBeLessThanOrEqual(2.0);
    expect(Math.abs(sim.landing!.tiltDeg)).toBeLessThanOrEqual(5.0);
  });

  it('Mars: tahap transfer tetap terpasang sampai tiba di capture (lander tidak terbang telanjang dari Bumi)', () => {
    for (const rocketId of ['atlas_v', 'sls_block1']) {
      const cfg = createFlightSimConfig({ ...mars, rocketId }, catalog);
      const sim = new FlightSim(cfg);
      const next = makePilot(sim, SKILLED);
      const lastIdx = cfg.rocket.stages.length - 1;
      const events: FlightEvent[] = [];
      let ticks = 0;
      while (!sim.ended && ticks++ < 60 * 1500) {
        const stepped = sim.step(next(), FIXED_DT);
        events.push(...stepped);
        if (sim.phase === 'launch' || sim.phase === 'orbit' || sim.phase === 'transfer') {
          expect(sim.staging.stages[lastIdx].phase, `${rocketId} melepas tahap transfer di ${sim.phase}`).not.toBe('jettisoned');
        }
      }
      expect(sim.summary()!.failed, rocketId).toBe(false);
      expect(events.some((e) => e.type === 'jettison' && e.stageIndex === lastIdx)).toBe(true);
      expect(sim.summary()!.lateStageCount).toBe(0);
    }
  });
});
