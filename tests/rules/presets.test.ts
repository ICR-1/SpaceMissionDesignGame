import { describe, expect, it } from 'vitest';
import { DAY_SEC, SURFACE } from '../../src/core/constants';
import { getPresetMission, STUDENT_PRESETS } from '../../src/core/missionBuilder';
import { resolveAssembly } from '../../src/rules/catalog';
import { dayPowerW, loadW, nightPowerMargin } from '../../src/rules/power';
import { preflight } from '../../src/rules/preflight';
import { canUplink, createSurfaceState, roverDriveW, stepSurface } from '../../src/rules/surface';
import { catalog } from './helpers';

describe('verifikasi preset misi siswa untuk Bulan dan Mars (katalog NASA)', () => {
  it('preset standar Bulan adalah GO (Falcon 9 + Apollo LM)', () => {
    const config = getPresetMission('moon', 'standard');
    expect(config.rocketId).toBe('falcon_9');
    const r = preflight(config, catalog);
    expect(r.assemblyErrors).toEqual([]);
    expect(r.missingObjectives).toEqual([]);
    expect(r.go).toBe(true);
  });

  it('preset jelajah Bulan (+ NASA Artemis LTV Rover) adalah GO', () => {
    const config = getPresetMission('moon', 'cruiser');
    expect(config.moduleIds).toContain('rover_ltv');
    const r = preflight(config, catalog);
    expect(r.assemblyErrors).toEqual([]);
    expect(r.missingObjectives).toEqual([]);
    expect(r.go, JSON.stringify(r.indicators)).toBe(true);
  });

  it('preset jelajah Bulan memiliki daya wahana penuh di permukaan (baterai Orion/HLS 1.200 Wh)', () => {
    const a = resolveAssembly(getPresetMission('moon', 'cruiser'), catalog);
    const s = createSurfaceState(a);
    expect(s.vehicleCapacityWh).toBe(1200);
    expect(s.vehicleWh).toBe(1200);
    expect(s.powerOut).toBe(false);
    expect(canUplink(s, 0)).toBe(true);
  });

  it('preset jelajah Bulan: menyetir rover terus-menerus sepanjang siang tidak menguras daya wahana', () => {
    const a = resolveAssembly(getPresetMission('moon', 'cruiser'), catalog);
    expect(roverDriveW(a)).toBe(150);
    expect(dayPowerW(a)).toBeGreaterThan(loadW(a) + roverDriveW(a));
    let s = createSurfaceState(a);
    for (let t = 0; t < DAY_SEC; t += 1) {
      s = stepSurface(s, { movement: 'drive', distanceFromHubM: 500 }, a, 1).state;
      s.oxygen = SURFACE.meterMax; // fokus pada daya wahana, bukan oksigen astronot
    }
    expect(s.powerOut).toBe(false);
    expect(s.vehicleWh).toBeGreaterThanOrEqual(s.vehicleCapacityWh * 0.99);
  });

  it('preset jelajah Bulan: baterai bertahan melewati satu malam penuh saat wahana diam', () => {
    const a = resolveAssembly(getPresetMission('moon', 'cruiser'), catalog);
    expect(nightPowerMargin(a)).toBeGreaterThan(0.25);
  });

  it('rakitan MMRTG tanpa baterai terpisah tetap memiliki cadangan penyangga (daya tidak 0)', () => {
    const config = {
      destinationId: 'moon',
      rocketId: 'atlas_v',
      moduleIds: ['apollo_lm', 'eng_rl10', 'tank_cryo_l', 'mmrtg', 'ant_hga'],
      instrumentIds: ['sample_drill', 'cam_pano'],
      fuelFraction: 1,
      seed: 1,
    };
    const r = preflight(config, catalog);
    expect(r.assemblyErrors).toEqual([]);
    expect(r.go, JSON.stringify(r.indicators)).toBe(true);

    const a = resolveAssembly(config, catalog);
    const s = createSurfaceState(a);
    expect(s.vehicleCapacityWh).toBe(750); // 125 W * 6 jam cadangan MMRTG (PRD 14)
    expect(s.vehicleWh).toBe(750);
    expect(s.powerOut).toBe(false);
    expect(canUplink(s, 0)).toBe(true);
  });

  it('preset standar Mars adalah GO (Atlas V 551 + Mars Sky-Crane)', () => {
    const config = getPresetMission('mars', 'standard');
    expect(config.rocketId).toBe('atlas_v');
    const r = preflight(config, catalog);
    expect(r.assemblyErrors).toEqual([]);
    expect(r.missingObjectives).toEqual([]);
    expect(r.go).toBe(true);
  });

  it('preset jelajah Mars (SLS Block 1 + MMRTG + rover) adalah GO', () => {
    const config = getPresetMission('mars', 'cruiser');
    expect(config.rocketId).toBe('sls_block1');
    expect(config.moduleIds).toContain('rover_ltv');
    const r = preflight(config, catalog);
    expect(r.assemblyErrors).toEqual([]);
    expect(r.missingObjectives).toEqual([]);
    expect(r.go, JSON.stringify(r.indicators)).toBe(true);
  });

  it.each(['moon', 'mars'])('semua preset %s hanya memakai ID katalog yang ada', (dest) => {
    const ids = new Set([...catalog.modules.map((m) => m.id), ...catalog.instruments.map((i) => i.id)]);
    const rockets = new Set(catalog.rockets.map((r) => r.id));
    for (const preset of Object.values(STUDENT_PRESETS[dest])) {
      expect(rockets.has(preset.config.rocketId), preset.key).toBe(true);
      for (const id of [...preset.config.moduleIds, ...preset.config.instrumentIds]) expect(ids.has(id), `${preset.key}:${id}`).toBe(true);
    }
  });
});
