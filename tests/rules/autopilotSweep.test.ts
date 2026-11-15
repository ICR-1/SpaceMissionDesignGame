import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT, FLIGHT, ORBITAL } from '../../src/core/constants';
import { defaultMission, getPresetMission, type PresetKey } from '../../src/core/missionBuilder';
import { makeAutopilot, type AutopilotWarpMode } from '../../src/rules/autopilot';
import { coastWarpIndex, createFlightSimConfig, FlightSim } from '../../src/rules/flightSim';
import { preflight } from '../../src/rules/preflight';
import type { MissionConfig } from '../../src/rules/types';
import { catalog } from './helpers';

const MAX_TICKS = 60 * 1500;
/** Sisa kemiringan maksimum yang masih dianggap tegak saat touchdown (derajat). */
const MAX_TOUCHDOWN_TILT_DEG = 10;
const WARP_MODES: AutopilotWarpMode[] = ['always', 'onPhaseChange'];

interface Flight { sim: FlightSim; warpCommands: number; ticks: number }

/** Terbangkan satu misi penuh hanya dengan autopilot (kontrol penerbangan tunggal game). */
function autoFly(config: MissionConfig, warp: AutopilotWarpMode): Flight {
  const sim = new FlightSim(createFlightSimConfig(config, catalog));
  const pilot = makeAutopilot(sim, { warp });
  let warpCommands = 0;
  let ticks = 0;
  while (!sim.ended && ticks < MAX_TICKS) {
    const input = pilot();
    if (input.setWarpIndex !== undefined) warpCommands++;
    sim.step(input, FIXED_DT);
    ticks++;
  }
  return { sim, warpCommands, ticks };
}

function expectSafeLanding(f: Flight, label: string): void {
  expect(f.sim.ended, `${label}: simulasi tidak selesai dalam ${MAX_TICKS} tick`).toBe(true);
  const s = f.sim.summary()!;
  expect(s.failed, `${label}: ${s.failCodes.join(',')}`).toBe(false);
  expect(f.sim.landing?.landed, `${label}: tidak menyentuh tanah`).toBe(true);
  expect(['perfect', 'success'], `${label}: touchdown ${s.touchdown}`).toContain(s.touchdown);
  expect(s.fuelRemainingKg, label).toBeGreaterThan(0);
  // Wahana tegak saat menyentuh tanah (batas touchdown 15 derajat; autopilot meluruskan ke ~0 di bawah 15 m).
  expect(Math.abs(f.sim.landing!.tiltDeg), `${label}: miring ${f.sim.landing!.tiltDeg.toFixed(1)} derajat saat touchdown`).toBeLessThanOrEqual(MAX_TOUCHDOWN_TILT_DEG);
}

describe('autopilot: sapuan preset misi siswa', () => {
  const dests = ['moon', 'mars'] as const;
  const keys: PresetKey[] = ['standard', 'cruiser'];
  for (const dest of dests) {
    for (const key of keys) {
      it.each(WARP_MODES)(`${dest}/${key}: preset GO mendarat dengan selamat (warp %s)`, (warp) => {
        const config = getPresetMission(dest, key);
        expect(preflight(config, catalog).go, `${dest}/${key} harus GO`).toBe(true);
        expectSafeLanding(autoFly(config, warp), `${dest}/${key}/${warp}`);
      });
    }
  }
});

describe('autopilot: sapuan roket GO', () => {
  const rockets = ['falcon_9', 'atlas_v', 'sls_block1', 'saturn_v'];

  it.each(WARP_MODES)('setiap kombinasi roket-destinasi yang GO mendarat dengan selamat (warp %s)', (warp) => {
    let tested = 0;
    const skipped: string[] = [];
    for (const dest of ['moon', 'mars']) {
      for (const rocketId of rockets) {
        const config: MissionConfig = { ...defaultMission(dest), rocketId };
        if (!preflight(config, catalog).go) { skipped.push(`${dest}/${rocketId}`); continue; }
        expectSafeLanding(autoFly(config, warp), `${dest}/${rocketId}/${warp}`);
        tested++;
      }
    }
    // Pastikan tes ini tidak kosong secara diam-diam: minimal satu roket GO per destinasi harus teruji.
    expect(tested, `kombinasi dilewati karena No-Go: ${skipped.join(', ')}`).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it.each(WARP_MODES)('beberapa seed dan bahan bakar berbeda pada Bulan tetap mendarat (warp %s)', (warp) => {
    for (const seed of [1, 7, 42]) {
      for (const fuelFraction of [0.85, 1]) {
        const config: MissionConfig = { ...getPresetMission('moon', 'standard'), seed, fuelFraction };
        if (!preflight(config, catalog).go) continue;
        expectSafeLanding(autoFly(config, warp), `moon/seed${seed}/fuel${fuelFraction}/${warp}`);
      }
    }
  }, 60_000);
});

interface Trace {
  orbitTicks: number;
  /** `phaseTimeSec` fase transfer saat gas TLI pertama kali menyala (detik, 1x). */
  burnStartPhaseSec: number | null;
  coastTicks: number;
  /** Indeks warp nyata selama coast (setelah ETA tersedia). */
  coastWarpIdx: number[];
  /** Jumlah tick nyata fase landing. */
  landingTicks: number;
  /** Indeks warp tertinggi yang dipakai selama landing. */
  landingMaxWarpIdx: number;
  /** Indeks warp tertinggi pada tick yang dimulai di bawah `FLIGHT.landing.warpMinAltM` (harus 0 = 1x). */
  landingMaxWarpIdxLow: number;
}

/** Terbangkan satu misi penuh dan rekam ritme fase (orbit, hitung mundur TLI, tangga warp coast, warp pendaratan). */
function trace(config: MissionConfig): Trace {
  const sim = new FlightSim(createFlightSimConfig(config, catalog));
  const pilot = makeAutopilot(sim, { warp: 'onPhaseChange' });
  const t: Trace = {
    orbitTicks: 0, burnStartPhaseSec: null, coastTicks: 0, coastWarpIdx: [], landingTicks: 0, landingMaxWarpIdx: 0, landingMaxWarpIdxLow: 0,
  };
  let ticks = 0;
  while (!sim.ended && ticks < MAX_TICKS) {
    if (sim.phase === 'orbit') t.orbitTicks++;
    const landingAlt = sim.phase === 'landing' && sim.landing ? sim.landing.altitudeM : null;
    sim.step(pilot(), FIXED_DT);
    ticks++;
    if (landingAlt !== null) {
      t.landingTicks++;
      t.landingMaxWarpIdx = Math.max(t.landingMaxWarpIdx, sim.timeWarpIndex);
      if (landingAlt < FLIGHT.landing.warpMinAltM) t.landingMaxWarpIdxLow = Math.max(t.landingMaxWarpIdxLow, sim.timeWarpIndex);
    }
    if (sim.phase === 'transfer' && !sim.coastSubPhase && sim.throttle > 0 && t.burnStartPhaseSec === null) t.burnStartPhaseSec = sim.phaseTimeSec;
    if (sim.phase === 'transfer' && sim.coastSubPhase && sim.coastEtaSec > 0) {
      t.coastTicks++;
      t.coastWarpIdx.push(sim.timeWarpIndex);
    }
  }
  return t;
}

describe('autopilot: ritme fase Bulan (orbit, TLI, coast, pendaratan)', () => {
  let t: Trace;
  beforeAll(() => { t = trace(getPresetMission('moon', 'standard')); }, 60_000);

  it('orbit parkir berhenti sekitar 6-20 detik nyata (bukan sepersekian detik)', () => {
    expect(t.orbitTicks).toBeGreaterThanOrEqual(6 * 60);
    expect(t.orbitTicks).toBeLessThanOrEqual(20 * 60);
  });

  it('gas TLI menunggu hitung mundur 1x sebelum menyala', () => {
    expect(t.burnStartPhaseSec).not.toBeNull();
    expect(t.burnStartPhaseSec!).toBeGreaterThanOrEqual(FLIGHT.tliCountdownSec);
    expect(t.burnStartPhaseSec!).toBeLessThan(FLIGHT.tliCountdownSec + 2);
  });

  it('coast Bulan berlangsung 15-55 detik nyata, naik bertahap dari 5x (tidak loncat ke puncak), puncak <= 10.000x', () => {
    expect(t.coastTicks).toBeGreaterThanOrEqual(15 * 60);
    expect(t.coastTicks).toBeLessThanOrEqual(55 * 60);
    const peak = Math.max(...t.coastWarpIdx);
    expect(peak).toBeGreaterThanOrEqual(6); // setidaknya 1000x di tengah perjalanan
    expect(ORBITAL.warpSteps[peak]).toBeLessThanOrEqual(10_000); // Bulan tidak pernah 100.000x
    const beforePeak = t.coastWarpIdx.slice(0, t.coastWarpIdx.indexOf(peak) + 1);
    const ramp = beforePeak.filter((v, i) => i === 0 || v !== beforePeak[i - 1]);
    expect(ORBITAL.warpSteps[ramp[0]], `tangga naik ${ramp.join('>')}`).toBeLessThanOrEqual(10); // mulai dari warp burn (5x)
    for (let i = 1; i < ramp.length; i++) expect(ramp[i] - ramp[i - 1], `tangga naik ${ramp.join('>')}`).toBe(1); // satu anak tangga per langkah
    // Setiap anak tangga naik bertahan paling sedikit sekitar 0,4 detik nyata (bukan satu frame).
    let run = 0;
    for (let i = 1; i < beforePeak.length; i++) {
      run++;
      if (beforePeak[i] !== beforePeak[i - 1]) {
        expect(run, `anak tangga ${beforePeak[i - 1]} terlalu singkat`).toBeGreaterThanOrEqual(20);
        run = 0;
      }
    }
    const afterPeak = t.coastWarpIdx.slice(t.coastWarpIdx.indexOf(peak));
    const steps = afterPeak.filter((v, i) => i === 0 || v !== afterPeak[i - 1]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i], `anak tangga ${steps.join('>')}`).toBeLessThan(steps[i - 1]); // hanya turun
      expect(steps[i - 1] - steps[i], `anak tangga ${steps.join('>')}`).toBeLessThanOrEqual(2); // tidak loncat jauh
    }
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(steps[steps.length - 1]).toBeLessThanOrEqual(1);
  });

  it('pendaratan memakai warp bertahap di atas 350 m, tetapi selalu 1x di 350 m terakhir sampai touchdown', () => {
    expect(t.landingMaxWarpIdx).toBeGreaterThanOrEqual(2); // minimal 5x dipakai di ketinggian
    expect(t.landingMaxWarpIdx).toBeLessThanOrEqual(3); // tidak pernah lebih dari 10x (physics warp)
    expect(t.landingMaxWarpIdxLow).toBe(0);
  });

  it('pendaratan otomatis singkat dan dinamis: 10-35 detik nyata total (bukan sekitar 4 menit)', () => {
    expect(t.landingTicks).toBeGreaterThanOrEqual(10 * 60);
    expect(t.landingTicks).toBeLessThanOrEqual(35 * 60);
  });
});

describe('coastWarpIndex: tangga warp berbasis ETA', () => {
  it('0 untuk ETA tidak positif, naik monoton dengan ETA, dan selalu menyisakan langkah nyata minimal', () => {
    expect(coastWarpIndex(0)).toBe(0);
    expect(coastWarpIndex(-5)).toBe(0);
    let prev = 0;
    for (const eta of [0.3, 1, 3, 10, 100, 1000, 10_000, 100_000, 1_000_000, 100_000_000]) {
      const idx = coastWarpIndex(eta);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
      if (idx > 0) expect(eta / ORBITAL.warpSteps[idx]).toBeGreaterThanOrEqual(FLIGHT.coastWarpStepRealSec);
    }
    expect(coastWarpIndex(100_000_000)).toBe(ORBITAL.warpSteps.length - 1);
  });

  it('Bulan (ETA sekitar 204.000 dtk) puncaknya 10.000x; Mars (ETA jutaan dtk) boleh 100.000x', () => {
    const idx10k = ORBITAL.warpSteps.indexOf(10_000);
    const idx100k = ORBITAL.warpSteps.indexOf(100_000);
    expect(coastWarpIndex(204_210)).toBe(idx10k);
    expect(coastWarpIndex(5_400_000)).toBe(idx100k);
    // Ambang tepat: 100.000x hanya bila sisa >= coastWarpTopRealSec detik nyata di warp itu.
    expect(coastWarpIndex(100_000 * FLIGHT.coastWarpTopRealSec)).toBe(idx100k);
    expect(coastWarpIndex(100_000 * FLIGHT.coastWarpTopRealSec - 1)).toBe(idx10k);
  });
});

describe('autopilot: mode warp', () => {
  it("'always' mengirim indeks warp di setiap tick; 'onPhaseChange' hanya sekali per fase", () => {
    const config = getPresetMission('moon', 'standard');
    const simA = new FlightSim(createFlightSimConfig(config, catalog));
    const always = makeAutopilot(simA, { warp: 'always' });
    expect(always().setWarpIndex).toBeDefined();
    expect(always().setWarpIndex).toBeDefined();

    const simB = new FlightSim(createFlightSimConfig(config, catalog));
    const once = makeAutopilot(simB, { warp: 'onPhaseChange' });
    expect(once().setWarpIndex).toBe(2); // peluncuran: 5x
    expect(once().setWarpIndex).toBeUndefined();
    expect(once().setWarpIndex).toBeUndefined();
  });

  it("bawaan tanpa opsi sama dengan 'always' (tes lama tidak berubah)", () => {
    const sim = new FlightSim(createFlightSimConfig(getPresetMission('moon', 'standard'), catalog));
    const pilot = makeAutopilot(sim);
    expect(pilot().setWarpIndex).toBeDefined();
    expect(pilot().setWarpIndex).toBeDefined();
  });

  it("'onPhaseChange' mengirim warp jauh lebih jarang daripada 'always' selama satu misi penuh, dan hasilnya sama-sama sukses", () => {
    const config = getPresetMission('moon', 'standard');
    const always = autoFly(config, 'always');
    const once = autoFly(config, 'onPhaseChange');
    expect(always.warpCommands).toBeGreaterThan(always.ticks * 0.5);
    // Peluncuran, orbit, hitung mundur TLI, burn transfer, anak tangga warp coast (sekitar 9), capture (settle + burn), landing:
    // satu perintah per sub-fase atau anak tangga, jauh di bawah satu per tick.
    expect(once.warpCommands).toBeLessThanOrEqual(32);
    expect(once.warpCommands).toBeGreaterThanOrEqual(5);
    expect(always.sim.summary()!.failed).toBe(false);
    expect(once.sim.summary()!.failed).toBe(false);
  });

  it("warp yang diatur pemain di tengah fase tidak ditimpa autopilot 'onPhaseChange'", () => {
    const sim = new FlightSim(createFlightSimConfig(getPresetMission('moon', 'standard'), catalog));
    const pilot = makeAutopilot(sim, { warp: 'onPhaseChange' });
    sim.step(pilot(), FIXED_DT); // tick pertama: autopilot memasang warp fase launch
    expect(sim.timeWarpIndex).toBe(2);
    // Pemain menurunkan warp ke 1x; autopilot tidak boleh menaikkannya lagi di fase yang sama.
    sim.step({ ...pilot(), setWarpIndex: 0 }, FIXED_DT);
    for (let i = 0; i < 30 && sim.phase === 'launch'; i++) sim.step(pilot(), FIXED_DT);
    expect(sim.phase).toBe('launch');
    expect(sim.timeWarpIndex).toBe(0);
  });
});
