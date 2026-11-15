import { describe, expect, it } from 'vitest';
import { resolveAssembly } from '../../src/rules/catalog';
import { rateTotal, signalQuality, uplinkDataD, uplinkFactor } from '../../src/rules/comms';
import { dayPowerW, isDaytime, productionW, rtgPowerW, stepBatteryWh } from '../../src/rules/power';
import { computeScore, starsFor, type ScoreInput } from '../../src/rules/score';
import { fuelRemainingKg, transferBurnCostMs, tsiolkovskyDv } from '../../src/rules/deltav';
import { G0 } from '../../src/core/constants';
import { catalog, moonExample } from './helpers';

const moon = resolveAssembly(moonExample, catalog);

describe('komunikasi dan uplink', () => {
  it('rateTotal menjumlahkan antena utama dan relay', () => {
    expect(rateTotal(moon)).toBe(8);
    const relay = resolveAssembly({ ...moonExample, moduleIds: [...moonExample.moduleIds, 'relay_link'] }, catalog);
    expect(rateTotal(relay)).toBe(13);
  });
  it('signalQuality: 1 di hub, turun dengan jarak, minimal 0,4, efek event aditif', () => {
    expect(signalQuality(0)).toBe(1);
    expect(signalQuality(200)).toBeCloseTo(0.7, 10);
    expect(signalQuality(400)).toBeCloseTo(0.4, 10);
    expect(signalQuality(5000)).toBeCloseTo(0.4, 10);
    expect(signalQuality(0, -0.3)).toBeCloseTo(0.7, 10);
    expect(signalQuality(400, -0.5)).toBe(0);
  });
  it('faktor uplink U = min(1, C/D); D = 0 menghasilkan 0', () => {
    const D = uplinkDataD([{ dataUnits: 20, score01: 0.5 }, { dataUnits: 40, score01: 1 }]);
    expect(D).toBe(50);
    expect(uplinkFactor(D, 8, 1)).toBe(1);
    expect(uplinkFactor(D, 1, 1)).toBeCloseTo(30 / 50, 10);
    expect(uplinkFactor(D, 1, 0.5)).toBeCloseTo(15 / 50, 10);
    expect(uplinkFactor(0, 8, 1)).toBe(0);
  });
});

describe('daya permukaan', () => {
  it('panel surya tidak menghasilkan daya di malam hari', () => {
    expect(isDaytime(0)).toBe(true);
    expect(isDaytime(239.9)).toBe(true);
    expect(isDaytime(240)).toBe(false);
    expect(isDaytime(359.9)).toBe(false);
    expect(isDaytime(360)).toBe(true);
    expect(productionW(moon, 100)).toBeCloseTo(dayPowerW(moon), 10);
    expect(productionW(moon, 300)).toBe(0);
  });
  it('RTG (MMRTG) tetap menghasilkan daya di malam hari', () => {
    const rtg = resolveAssembly({ ...moonExample, moduleIds: [...moonExample.moduleIds, 'mmrtg'] }, catalog);
    expect(productionW(rtg, 300)).toBe(rtgPowerW(rtg));
    expect(rtgPowerW(rtg)).toBe(125);
  });
  it('baterai terkuras malam hari dan terjaga di [0, kapasitas]', () => {
    // beban rakitan Bulan acuan 120 W (Apollo LM 45 + kamera 15 + bor 60); 20 dtk nyata = 1 jam-game
    expect(stepBatteryWh(1200, 1200, 0, 120, 20)).toBeCloseTo(1080, 10);
    expect(stepBatteryWh(100, 1200, 0, 120, 100)).toBe(0);
    expect(stepBatteryWh(1190, 1200, 1700, 120, 20)).toBe(1200);
  });
});

describe('delta-v dan burn', () => {
  it('Tsiolkovsky dan kasus tepi', () => {
    // Bulan acuan: m0 15.327 kg, mf 3.427 kg, RL10C-1 454 s
    expect(tsiolkovskyDv(454, 15_327, 3427)).toBeCloseTo(454 * G0 * Math.log(15_327 / 3427), 8);
    expect(tsiolkovskyDv(454, 15_327, 3427)).toBeGreaterThan(5840);
    expect(tsiolkovskyDv(450, 1000, 1000)).toBe(0);
    expect(tsiolkovskyDv(0, 2000, 1000)).toBe(0);
  });
  it('biaya burn transfer dan bahan bakar tersisa', () => {
    expect(transferBurnCostMs(5840, 0)).toBeCloseTo(0.7 * 5840, 10);
    expect(transferBurnCostMs(5840, 1)).toBeCloseTo(0.7 * 5840 * 1.5, 10);
    const left = fuelRemainingKg(15_327, 3427, 0.7 * 5840, 454);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(11_900);
    expect(left).toBeCloseTo(15_327 * Math.exp(-(0.7 * 5840) / (454 * G0)) - 3427, 6);
    expect(fuelRemainingKg(15_327, 3427, 99_999, 454)).toBe(0);
  });
});

describe('skor akhir', () => {
  const base: ScoreInput = {
    uplinkU: 1, requiredDone: 2, requiredTotal: 2, minigameScores: [1, 1],
    budgetMargin: 0.2, massMargin: 0.2, powerMargin: 0.2,
    touchdownFactor: 1, faintCount: 0, instrumentsLost: 0, lateStageCount: 0,
    bonusObjectivesDone: 1, eventsHandledWell: 1, failed: false,
  };
  it('skor sempurna: 40 + 25 + 20 + 7 = 92, 3 bintang, 46 poin sains', () => {
    const s = computeScore(base);
    expect(s.science).toBeCloseTo(40, 10);
    expect(s.efficiency).toBeCloseTo(25, 10);
    expect(s.safety).toBe(20);
    expect(s.bonus).toBe(7);
    expect(s.total).toBeCloseTo(92, 10);
    expect(s.stars).toBe(3);
    expect(s.sciencePoints).toBe(46);
  });
  it('sains: bobot objektif 0,7 dan minigame 0,3, dikali U', () => {
    const s = computeScore({ ...base, requiredDone: 1, minigameScores: [0.5], uplinkU: 0.5 });
    expect(s.science).toBeCloseTo(40 * 0.5 * (0.7 * 0.5 + 0.3 * 0.5), 10);
  });
  it('efisiensi jenuh pada 0,15 / 0,10 / 0,10 dan nol jika margin negatif', () => {
    expect(computeScore({ ...base, budgetMargin: 0.075, massMargin: 0, powerMargin: -1 }).efficiency).toBeCloseTo(25 * 0.25, 10);
  });
  it('keselamatan: penalti pingsan, instrumen hilang, tahap terlambat; tidak negatif', () => {
    const s = computeScore({ ...base, touchdownFactor: 0.7, faintCount: 1, instrumentsLost: 1, lateStageCount: 1 });
    expect(s.safety).toBeCloseTo(14 - 5 - 3 - 2, 10);
    expect(computeScore({ ...base, touchdownFactor: 0.3, faintCount: 3 }).safety).toBe(0);
  });
  it('bonus dibatasi 15', () => {
    expect(computeScore({ ...base, bonusObjectivesDone: 3, eventsHandledWell: 5 }).bonus).toBe(15);
  });
  it('bintang: 40 / 60 / 80 dan misi gagal = 0 bintang', () => {
    expect([39.9, 40, 59.9, 60, 79.9, 80].map((t) => starsFor(t, false))).toEqual([0, 1, 1, 2, 2, 3]);
    expect(starsFor(95, true)).toBe(0);
    expect(computeScore({ ...base, failed: true }).sciencePoints).toBe(0);
  });
  it('tanpa objektif dan minigame: tidak NaN', () => {
    const s = computeScore({ ...base, requiredTotal: 0, requiredDone: 0, minigameScores: [] });
    expect(Number.isFinite(s.total)).toBe(true);
  });
});
