import { getLang, JOURNAL_UI } from '../core/strings';
import type { Destination, Lang } from '../rules/types';

/**
 * Fakta destinasi untuk jurnal misi, hanya dari PRD bagian 9 dan 10 (angka dibulatkan). Gravitasi dan
 * irradiansi dibaca dari data kanonik; sisanya tabel PRD.
 */
const STATIC_FACTS: Record<Lang, Record<string, { atmosphere: string; temperature: string; signalDelay: string }>> = {
  id: {
    moon: { atmosphere: 'Hampir tidak ada', temperature: '-173 sampai 127 °C', signalDelay: 'sekitar 1,3 detik' },
    mars: { atmosphere: 'Tipis, CO₂, kurang dari 1% tekanan Bumi', temperature: 'Rata-rata sekitar -63 °C', signalDelay: '3-22 menit' },
  },
  en: {
    moon: { atmosphere: 'Virtually none', temperature: '-173 to 127 °C', signalDelay: 'about 1.3 seconds' },
    mars: { atmosphere: 'Thin CO₂, less than 1% of Earth pressure', temperature: 'Average around -63 °C', signalDelay: '3-22 minutes' },
  },
};

const LABELS: Record<Lang, { gravity: string; atmosphere: string; temp: string; irradiance: string; approx: string; delay: string }> = {
  id: {
    gravity: 'Gravitasi',
    atmosphere: 'Atmosfer',
    temp: 'Suhu permukaan',
    irradiance: 'Irradiansi Matahari',
    approx: 'sekitar',
    delay: 'Jeda sinyal satu arah (asli)',
  },
  en: {
    gravity: 'Gravity',
    atmosphere: 'Atmosphere',
    temp: 'Surface temperature',
    irradiance: 'Solar irradiance',
    approx: 'approx.',
    delay: 'One-way signal delay (actual)',
  },
};

export const JOURNAL_NOTE = JOURNAL_UI.note;

export function journalNote(): string {
  return JOURNAL_UI.note;
}

export function journalFacts(dest: Destination, lang: Lang = getLang()): [string, string][] {
  const fixed = STATIC_FACTS[lang][dest.id];
  const l = LABELS[lang];
  const gravStr = lang === 'en' ? String(dest.gravity) : String(dest.gravity).replace('.', ',');
  const irrStr = dest.solarIrradianceWm2.toLocaleString(lang === 'en' ? 'en-US' : 'id-ID');
  const facts: [string, string][] = [
    [l.gravity, `${gravStr} m/s²`],
  ];
  if (fixed) facts.push([l.atmosphere, fixed.atmosphere], [l.temp, fixed.temperature]);
  facts.push([l.irradiance, `${l.approx} ${irrStr} W/m²`]);
  if (fixed) facts.push([l.delay, fixed.signalDelay]);
  return facts;
}
