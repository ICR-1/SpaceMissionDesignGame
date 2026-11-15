import { loadCatalog } from '../../src/core/data';
import type { MissionConfig } from '../../src/rules/types';

export const catalog = loadCatalog();

/**
 * Rakitan Bulan acuan (katalog NASA): Falcon 9 + Apollo LM + tangki kriogenik L + RL10C + panel ROSA + baterai Orion/HLS + HGA.
 * Massa awal 15.327 kg dari muatan 16.800 kg (margin kuning), delta-v sekitar 6.669 m/s dari kebutuhan 5.840 m/s (hijau).
 */
export const moonExample: MissionConfig = {
  destinationId: 'moon',
  rocketId: 'falcon_9',
  moduleIds: ['apollo_lm', 'tank_cryo_l', 'eng_rl10', 'solar_m', 'battery_m', 'ant_hga'],
  instrumentIds: ['cam_pano', 'sample_drill'],
  seed: 1,
  fuelFraction: 0.85,
};
