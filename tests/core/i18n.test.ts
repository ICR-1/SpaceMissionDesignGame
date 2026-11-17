import { afterEach, describe, expect, it } from 'vitest';
import { EN_CATALOG, localizedCatalog } from '../../src/core/catalogEn';
import { defaultMission, toggleInstrument } from '../../src/core/missionBuilder';
import {
  DESIGN, EVENT_SCENE_UI, FLIGHT_UI, GLOSSARY, JOURNAL_UI, LOADING_UI, NOVA_MESSAGES,
  REVIEW_UI, STORY_UI, STRINGS, SURFACE_UI, TITLE_UI, TUTOR_UI, getLang, setLang,
} from '../../src/core/strings';
import { preflight } from '../../src/rules/preflight';
import { TUTOR_STEPS } from '../../src/rules/tutor';
import { suggestChanges } from '../../src/rules/whatIf';
import { describeChoice, formatEffect, formatEffects } from '../../src/ui/effectText';
import { journalFacts } from '../../src/ui/journalFacts';
import { novaWarnings } from '../../src/ui/warnings';
import { catalog, moonExample } from '../rules/helpers';

afterEach(() => {
  setLang('id');
});

describe('i18n (Indonesia & English)', () => {
  it('default bahasa adalah Indonesia dan dapat diubah ke Inggris lalu kembali', () => {
    expect(getLang()).toBe('id');
    expect(STRINGS.scenes.design).toBe('Desain Misi');
    expect(STORY_UI.language).toBe('Bahasa');
    expect(TITLE_UI.play).toBe('Main');

    setLang('en');
    expect(getLang()).toBe('en');
    expect(STRINGS.scenes.design).toBe('Mission Design');
    expect(STORY_UI.language).toBe('Language');
    expect(TITLE_UI.play).toBe('Play');
    expect(DESIGN.launch).toBe('Launch');
    expect(FLIGHT_UI.phases.orbit).toBe('Keplerian Parking Orbit');
    expect(SURFACE_UI.cardinals).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    expect(REVIEW_UI.success).toBe('Mission succeeded');
    expect(JOURNAL_UI.title).toBe('Mission journal');
    expect(LOADING_UI.planets.earth).toBe('Earth');

    setLang('id');
    expect(STRINGS.scenes.design).toBe('Desain Misi');
  });

  it('GLOSSARY, TUTOR_UI, dan EVENT_SCENE_UI lengkap di kedua bahasa', () => {
    for (const lang of ['id', 'en'] as const) {
      setLang(lang);
      expect(Object.keys(GLOSSARY)).toHaveLength(11);
      for (const g of Object.values(GLOSSARY)) {
        expect(g.term.length).toBeGreaterThan(0);
        expect(g.text.length).toBeGreaterThan(0);
        expect(g.text.length).toBeLessThanOrEqual(160);
      }
      for (const step of TUTOR_STEPS) {
        const copy = TUTOR_UI.steps[step.id];
        expect(copy.title.length).toBeGreaterThan(3);
        expect(copy.body.length).toBeGreaterThan(10);
      }
      for (const ev of catalog.events) {
        expect(EVENT_SCENE_UI[ev.id]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('localizedCatalog menerjemahkan seluruh entitas data/*.json ke bahasa Inggris', () => {
    expect(localizedCatalog(catalog, 'id')).toBe(catalog);
    const en = localizedCatalog(catalog, 'en');
    expect(en).not.toBe(catalog);

    for (const r of catalog.rockets) {
      expect(EN_CATALOG.rockets[r.id], r.id).toBeDefined();
      for (const st of r.stages) expect(EN_CATALOG.rockets[r.id].stages[st.id], st.id).toBeTruthy();
    }
    for (const m of catalog.modules) expect(EN_CATALOG.modules[m.id], m.id).toBeTruthy();
    for (const inst of catalog.instruments) expect(EN_CATALOG.instruments[inst.id], inst.id).toBeTruthy();
    for (const d of catalog.destinations) {
      expect(EN_CATALOG.destinations[d.id], d.id).toBeDefined();
      for (const o of d.objectives) expect(EN_CATALOG.destinations[d.id].objectives[o.id], o.id).toBeTruthy();
    }
    for (const ev of catalog.events) {
      expect(EN_CATALOG.events[ev.id], ev.id).toBeDefined();
      expect(EN_CATALOG.events[ev.id].choices).toHaveLength(ev.choices.length);
    }
    for (const dlg of catalog.dialogs) expect(EN_CATALOG.dialogs[dlg.id], dlg.id).toBeTruthy();

    expect(en.destinations.find((d) => d.id === 'moon')?.name).toBe('Moon');
    expect(en.instruments.find((i) => i.id === 'sample_drill')?.name).toBe('Sample Drill');
    expect(en.events.find((e) => e.id === 'ev_dust_storm')?.title).toBe('Dust storm');
    expect(en.dialogs.find((d) => d.id === 'intro_1')?.text).toContain('Year 2061');
    // Pastikan caching mengembalikan referensi yang sama untuk bahasa Inggris
    expect(localizedCatalog(catalog, 'en')).toBe(en);
  });

  it('formatter UI (effectText, journalFacts, novaWarnings) dan whatIf bekerja di bahasa Inggris', () => {
    setLang('en');
    const en = localizedCatalog(catalog, 'en');
    expect(formatEffect({ target: 'timeSec', delta: 45 })).toBe('Time +45 s');
    expect(formatEffects([])).toBe('no impact');

    const storm = en.events.find((x) => x.id === 'ev_dust_storm')!;
    const risky = describeChoice(storm.choices[1]);
    expect(risky.risk).toBe('Failure risk 50%');
    expect(risky.failImpact).toBe('Oxygen −25, Signal −40% for 60 s');

    const moon = en.destinations.find((d) => d.id === 'moon')!;
    const facts = Object.fromEntries(journalFacts(moon));
    expect(facts.Gravity).toBe('1.62 m/s²');
    expect(facts['Solar irradiance']).toContain('W/m²');

    const missing = toggleInstrument(defaultMission('moon'), en, 'sample_drill');
    expect(novaWarnings(preflight(missing, en), missing, en).join(' ')).toContain('Sample Drill');
    expect(NOVA_MESSAGES.allClear).toContain('Ready for launch');

    const suggestions = suggestChanges({ ...moonExample, fuelFraction: 0.5 }, en);
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
