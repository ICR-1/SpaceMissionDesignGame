import { describe, expect, it } from 'vitest';
import { resolveAssembly } from '../../src/rules/catalog';
import { preflight } from '../../src/rules/preflight';
import { budgetMargin, totalCostMusd } from '../../src/rules/budget';
import { dayPowerMargin, nightPowerMargin, dayPowerW, loadW } from '../../src/rules/power';
import { commsMargin } from '../../src/rules/comms';
import { dvAvailableMs, dvMargin } from '../../src/rules/deltav';
import { dryMassKg, fuelMassKg, initialMassKg, massMargin } from '../../src/rules/mass';
import { G0 } from '../../src/core/constants';
import { catalog, moonExample } from './helpers';

const TOL = 0.005; // toleransi 0,5%
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(TOL);

/**
 * Contoh hitung misi Bulan dengan katalog NASA: Falcon 9 (muatan LEO 16.800 kg) + Apollo LM + Tangki Kriogenik L (14.000 kg, diisi 85%)
 * + RL10C-1 (454 s) + Array ROSA + Baterai Orion/HLS + HGA Ka-band; instrumen Kamera Panorama dan Bor Sampel.
 */
describe('contoh hitung misi Bulan (katalog NASA)', () => {
  const a = resolveAssembly(moonExample, catalog);
  // Massa kering: 1900 + 1150 + 190 + 42 + 62 + 30 (modul) + 8 + 45 (instrumen)
  const DRY = 3427;
  const FUEL = 14000 * 0.85;

  it('massa', () => {
    expect(dryMassKg(a)).toBe(DRY);
    expect(fuelMassKg(a)).toBe(FUEL);
    expect(initialMassKg(a)).toBe(DRY + FUEL);
    near(massMargin(a), (16_800 - (DRY + FUEL)) / 16_800);
  });
  it('delta-v: Tsiolkovsky dengan Isp 454 s terhadap kebutuhan Bulan 5.840 m/s', () => {
    const dv = 454 * G0 * Math.log((DRY + FUEL) / DRY);
    near(dvAvailableMs(a), dv);
    near(dvMargin(a), (dv - 5840) / 5840);
  });
  it('biaya dan budget', () => {
    // Falcon 9 67 + Apollo LM 75 + tangki 48 + RL10C 42 + ROSA 15 + baterai 20 + HGA 22 + kamera 15 + bor 55
    expect(totalCostMusd(a)).toBe(359);
    expect(a.destination.budgetMusd).toBe(485);
    near(budgetMargin(a), (485 - 359) / 485);
  });
  it('daya', () => {
    near(dayPowerW(a), 4 * 0.3 * 1361);
    expect(loadW(a)).toBe(45 + 15 + 60);
    near(dayPowerMargin(a), (4 * 0.3 * 1361 - 120) / 120);
    near(nightPowerMargin(a), (1200 - 120 * 6) / (120 * 6));
  });
  it('komunikasi', () => {
    near(commsMargin(a), 3.0);
  });
  it('status indikator dan Go', () => {
    const r = preflight(moonExample, catalog);
    expect(r.indicators.mass.status).toBe('yellow');
    expect(r.indicators.deltaV.status).toBe('green');
    expect(r.indicators.budget.status).toBe('green');
    expect(r.indicators.power.status).toBe('green');
    expect(r.indicators.comms.status).toBe('green');
    expect(r.assemblyErrors).toEqual([]);
    expect(r.missingObjectives).toEqual([]);
    expect(r.go).toBe(true);
    expect(r.tightMargin).toBe(true);
  });
});

describe('Go/No-Go', () => {
  it('No-Go jika objektif wajib tanpa instrumen', () => {
    const r = preflight({ ...moonExample, instrumentIds: ['cam_pano'] }, catalog);
    expect(r.missingObjectives).toEqual(['moon_regolith']);
    expect(r.go).toBe(false);
  });
  it('Free Design: objektif wajib tanpa instrumen tetap dilaporkan tetapi tidak mengunci Go', () => {
    const r = preflight({ ...moonExample, instrumentIds: ['cam_pano'] }, catalog, false);
    expect(r.missingObjectives).toEqual(['moon_regolith']);
    expect(r.go).toBe(true);
  });
  it('Free Design tetap No-Go jika ada indikator merah', () => {
    const r = preflight({ ...moonExample, fuelFraction: 1 }, catalog, false);
    expect(r.indicators.mass.status).toBe('red');
    expect(r.go).toBe(false);
  });
  it('No-Go jika ada indikator merah (massa melebihi muatan roket)', () => {
    const r = preflight({ ...moonExample, fuelFraction: 1 }, catalog);
    expect(r.indicators.mass.status).toBe('red');
    expect(r.go).toBe(false);
  });
  it('aturan perakitan dilaporkan', () => {
    const r = preflight({ ...moonExample, moduleIds: [...moonExample.moduleIds, 'eng_aj10', 'relay_link', 'relay_link'] }, catalog);
    expect(r.assemblyErrors).toEqual(expect.arrayContaining(['ENGINE_COUNT', 'RELAY_MAX']));
    expect(r.go).toBe(false);
  });
  it('slot instrumen dan duplikat divalidasi', () => {
    const six = ['cam_pano', 'weather_station', 'seismometer', 'spectrometer', 'sample_drill', 'ice_radar'];
    expect(preflight({ ...moonExample, instrumentIds: six }, catalog).assemblyErrors).toContain('INSTRUMENT_SLOTS');
    expect(preflight({ ...moonExample, instrumentIds: ['cam_pano', 'cam_pano'] }, catalog).assemblyErrors).toContain('INSTRUMENT_DUPLICATE');
  });
  it('id tidak dikenal menghasilkan error jelas', () => {
    expect(() => preflight({ ...moonExample, rocketId: 'nope' }, catalog)).toThrow(/Roket tidak dikenal: "nope"/);
  });
});
