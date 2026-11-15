import { describe, expect, it } from 'vitest';
import { defaultSave } from '../../src/rules/progress';
import {
  TUTOR_STEPS, advanceTutor, createTutorState, currentTutorStep, indexOfTutorStep,
  shouldOfferTutor, startTutor, stopTutor, syncTutorForScene,
} from '../../src/rules/tutor';
import { TUTOR_UI } from '../../src/core/strings';

describe('alur Tur Pengenalan (tutor mode)', () => {
  it('hanya menawarkan tur otomatis untuk pemain baru di Mode Cerita sebelum ke Bulan', () => {
    const fresh = defaultSave();
    expect(shouldOfferTutor(fresh, 'story', 'moon')).toBe(true);
    expect(shouldOfferTutor(fresh, 'story', 'mars')).toBe(false);
    expect(shouldOfferTutor(fresh, 'free', 'moon')).toBe(false);
    expect(shouldOfferTutor({ ...fresh, tutorialSeen: true }, 'story', 'moon')).toBe(false);
  });

  it('setiap langkah di TUTOR_STEPS punya teks lengkap di TUTOR_UI.steps', () => {
    expect(TUTOR_STEPS.length).toBe(8);
    for (const step of TUTOR_STEPS) {
      const copy = TUTOR_UI.steps[step.id];
      expect(copy.title.length).toBeGreaterThan(3);
      expect(copy.body.length).toBeGreaterThan(10);
    }
  });

  it('startTutor memulai di langkah pertama desain dan advanceTutor memajukan hingga selesai', () => {
    let s = startTutor();
    expect(s.active).toBe(true);
    expect(currentTutorStep(s)?.id).toBe('design_welcome');

    s = advanceTutor(s);
    expect(currentTutorStep(s)?.id).toBe('design_catalog');

    s = advanceTutor(s);
    expect(currentTutorStep(s)?.id).toBe('design_indicators');

    s = advanceTutor(s);
    expect(currentTutorStep(s)?.id).toBe('design_launch');
  });

  it('syncTutorForScene berpindah mulus antar scene dan fase pendaratan', () => {
    let s = startTutor();
    s = syncTutorForScene(s, 'flight', 'launch');
    expect(currentTutorStep(s)?.id).toBe('flight_launch');

    // Mengakui flight_launch menyembunyikan kartu hingga fase landing tiba
    s = advanceTutor(s);
    expect(s.hiddenUntilTransition).toBe(true);
    expect(syncTutorForScene(s, 'flight', 'orbit').hiddenUntilTransition).toBe(true);

    s = syncTutorForScene(s, 'flight', 'landing');
    expect(currentTutorStep(s)?.id).toBe('flight_landing');
    expect(s.hiddenUntilTransition).toBe(false);

    s = syncTutorForScene(s, 'surface');
    expect(currentTutorStep(s)?.id).toBe('surface_explore');

    s = advanceTutor(s);
    expect(currentTutorStep(s)?.id).toBe('surface_uplink');

    s = advanceTutor(s);
    expect(s.active).toBe(false);
    expect(currentTutorStep(s)).toBeNull();
  });

  it('kembali ke briefing atau masuk review menutup tur secara bersih', () => {
    const active = { ...createTutorState(true), stepIndex: indexOfTutorStep('flight_launch') };
    expect(syncTutorForScene(active, 'briefing')).toEqual(stopTutor());
    expect(syncTutorForScene(active, 'review')).toEqual(stopTutor());
  });
});
