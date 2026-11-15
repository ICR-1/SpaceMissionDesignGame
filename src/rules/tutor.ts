import type { SceneId } from '../core/constants';
import { modeRules, type SaveData } from './progress';
import type { DialogSpeaker, GameMode, Id } from './types';

export type TutorStepId =
  | 'design_welcome'
  | 'design_catalog'
  | 'design_indicators'
  | 'design_launch'
  | 'flight_launch'
  | 'flight_landing'
  | 'surface_explore'
  | 'surface_uplink';

export interface TutorStepSpec {
  id: TutorStepId;
  scene: SceneId;
  speaker: DialogSpeaker;
  /** Selector elemen UI untuk disorot di scene tersebut, atau null bila menyorot viewport 3D. */
  spotlight: string | null;
  /** true jika langkah menunggu aksi nyata pemain (mis. tombol Luncurkan). */
  waitForAction: boolean;
  /** true jika tombol aksi menyembunyikan kartu sampai fase/scene berikutnya tiba. */
  hideOnAcknowledge: boolean;
}

export const TUTOR_STEPS: readonly TutorStepSpec[] = [
  { id: 'design_welcome', scene: 'design', speaker: 'sekar', spotlight: null, waitForAction: false, hideOnAcknowledge: false },
  { id: 'design_catalog', scene: 'design', speaker: 'nova', spotlight: '.panel-left', waitForAction: false, hideOnAcknowledge: false },
  { id: 'design_indicators', scene: 'design', speaker: 'nova', spotlight: '.panel-right .indicators, .panel-right .go-badge', waitForAction: false, hideOnAcknowledge: false },
  { id: 'design_launch', scene: 'design', speaker: 'sekar', spotlight: '.panel-right button.launch-button', waitForAction: true, hideOnAcknowledge: false },
  { id: 'flight_launch', scene: 'flight', speaker: 'nova', spotlight: null, waitForAction: false, hideOnAcknowledge: true },
  { id: 'flight_landing', scene: 'flight', speaker: 'nova', spotlight: null, waitForAction: false, hideOnAcknowledge: true },
  { id: 'surface_explore', scene: 'surface', speaker: 'sekar', spotlight: null, waitForAction: false, hideOnAcknowledge: false },
  { id: 'surface_uplink', scene: 'surface', speaker: 'nova', spotlight: null, waitForAction: false, hideOnAcknowledge: false },
];

export interface TutorState {
  active: boolean;
  stepIndex: number;
  /** Disembunyikan sementara oleh pemain sambil menunggu transisi fase berikutnya. */
  hiddenUntilTransition: boolean;
}

export function createTutorState(active = false): TutorState {
  return { active, stepIndex: 0, hiddenUntilTransition: false };
}

export function startTutor(): TutorState {
  return { active: true, stepIndex: 0, hiddenUntilTransition: false };
}

export function stopTutor(): TutorState {
  return { active: false, stepIndex: 0, hiddenUntilTransition: false };
}

export function currentTutorStep(state: TutorState): TutorStepSpec | null {
  if (!state.active) return null;
  return TUTOR_STEPS[state.stepIndex] ?? null;
}

export function indexOfTutorStep(id: TutorStepId): number {
  return TUTOR_STEPS.findIndex((s) => s.id === id);
}

/** Memajukan langkah tur saat pengguna menekan Lanjut / Mengerti / Selesai. */
export function advanceTutor(state: TutorState): TutorState {
  if (!state.active) return state;
  const step = currentTutorStep(state);
  if (!step) return stopTutor();
  if (step.hideOnAcknowledge) {
    return { ...state, hiddenUntilTransition: true };
  }
  const next = state.stepIndex + 1;
  if (next >= TUTOR_STEPS.length) return stopTutor();
  return { active: true, stepIndex: next, hiddenUntilTransition: false };
}

/** Menyelaraskan langkah tur ketika scene atau fase penerbangan berubah. */
export function syncTutorForScene(state: TutorState, scene: SceneId, flightPhase?: string): TutorState {
  if (!state.active) return state;
  if (scene === 'briefing' || scene === 'review') return stopTutor();

  if (scene === 'design') {
    const step = currentTutorStep(state);
    if (step && step.scene === 'design') return state;
    return { active: true, stepIndex: indexOfTutorStep('design_welcome'), hiddenUntilTransition: false };
  }

  if (scene === 'flight') {
    const targetId: TutorStepId = flightPhase === 'landing' ? 'flight_landing' : 'flight_launch';
    const targetIdx = indexOfTutorStep(targetId);
    const current = currentTutorStep(state);
    if (current?.scene === 'flight' && state.stepIndex >= targetIdx) return state;
    return { active: true, stepIndex: targetIdx, hiddenUntilTransition: false };
  }

  if (scene === 'surface') {
    const current = currentTutorStep(state);
    if (current?.scene === 'surface') return state;
    return { active: true, stepIndex: indexOfTutorStep('surface_explore'), hiddenUntilTransition: false };
  }

  return state;
}

/** Penawaran Tur Pengenalan otomatis untuk pemain baru sebelum misi pertama ke Bulan di Mode Cerita. */
export function shouldOfferTutor(save: SaveData, mode: GameMode, destinationId: Id): boolean {
  return !save.tutorialSeen && modeRules(mode).storyDialogs && destinationId === 'moon';
}
