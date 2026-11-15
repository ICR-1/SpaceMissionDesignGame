import type { SceneId } from '../core/constants';
import { SPEAKER_NAMES, TUTOR_UI } from '../core/strings';
import type { GameState, Store } from '../core/store';
import {
  TUTOR_STEPS, advanceTutor, currentTutorStep, stopTutor, syncTutorForScene,
  type TutorStepSpec,
} from '../rules/tutor';
import { createPortrait } from './dialog';
import { el } from './dom';
import { renderKeyHints } from './keyHints';

/** Menawarkan Tur Pengenalan interaktif kepada pemain baru sebelum memulai misi Bulan pertama. */
export function showTutorOffer(host: HTMLElement, onStart: () => void, onSkip: () => void): void {
  const card = el('div', 'dialog modal tutor-offer');
  card.dataset.speaker = 'sekar';
  card.dataset.interactive = 'true';

  const head = el('div', 'tutor-offer-head');
  const portraitBox = el('div', 'portrait-box');
  portraitBox.appendChild(createPortrait('sekar'));
  const titleWrap = el('div', 'tutor-offer-titles');
  titleWrap.append(el('h3', 'tutor-offer-title', TUTOR_UI.offerTitle), el('p', 'tutor-offer-sub', TUTOR_UI.offerSubtitle));
  head.append(portraitBox, titleWrap);

  const list = el('ul', 'tutor-offer-list');
  for (const point of TUTOR_UI.offerPoints) list.appendChild(el('li', '', point));

  const actions = el('div', 'tutor-offer-actions');
  const startBtn = el('button', 'launch-button', TUTOR_UI.offerStart);
  const skipBtn = el('button', 'choice tutor-skip-btn', TUTOR_UI.offerSkip);
  startBtn.type = skipBtn.type = 'button';
  startBtn.addEventListener('click', () => {
    card.remove();
    onStart();
  });
  skipBtn.addEventListener('click', () => {
    card.remove();
    onSkip();
  });
  actions.append(startBtn, skipBtn);

  card.append(
    el('div', 'dialog-name', SPEAKER_NAMES.sekar),
    head,
    el('p', 'dialog-text', TUTOR_UI.offerBody),
    list,
    actions,
  );
  host.appendChild(card);
  startBtn.focus();
}

export interface TutorGuideOptions {
  onVisibilityChange?: (visible: boolean) => void;
}

/**
 * Overlay Tur Pengenalan interaktif lintas scene (Desain -> Penerbangan -> Permukaan).
 * Menyediakan sorotan elemen UI dan kartu panduan ringkas tanpa menutupi kendali 3D utama.
 */
export class TutorGuide {
  private readonly card: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly portraitBox: HTMLElement;
  private readonly speakerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly waitEl: HTMLElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private spotlights: HTMLElement[] = [];
  private visible = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly store: Store<GameState>,
    private readonly scene: SceneId,
    private readonly opts: TutorGuideOptions = {},
  ) {
    this.card = el('div', 'tutor-card');
    this.card.dataset.interactive = 'true';
    this.card.hidden = true;

    const top = el('div', 'tutor-top');
    this.progressEl = el('span', 'tutor-progress');
    this.skipBtn = el('button', 'tutor-skip', TUTOR_UI.skip);
    this.skipBtn.type = 'button';
    this.skipBtn.addEventListener('click', () => this.finishTutor());
    top.append(el('span', 'tutor-badge', TUTOR_UI.badge), this.progressEl, this.skipBtn);

    const content = el('div', 'tutor-content');
    this.portraitBox = el('div', 'portrait-box tutor-portrait');
    const copy = el('div', 'tutor-copy');
    this.speakerEl = el('div', 'tutor-speaker');
    this.titleEl = el('h3', 'tutor-title');
    this.bodyEl = el('p', 'tutor-body');
    this.waitEl = el('div', 'tutor-wait', TUTOR_UI.waitingLaunch);
    this.nextBtn = el('button', 'tutor-next', TUTOR_UI.next);
    this.nextBtn.type = 'button';
    this.nextBtn.addEventListener('click', () => this.advance());
    copy.append(this.speakerEl, this.titleEl, this.bodyEl, this.waitEl, this.nextBtn);
    content.append(this.portraitBox, copy);

    this.card.append(top, content);
    this.host.appendChild(this.card);
    this.sync();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Memastikan state tur mengikuti scene dan fase penerbangan saat ini lalu memperbarui DOM. */
  sync(flightPhase?: string): void {
    const prev = this.store.get().tutor;
    const synced = syncTutorForScene(prev, this.scene, flightPhase);
    if (synced !== prev) this.store.set({ tutor: synced });

    const step = currentTutorStep(synced);
    const shouldShow = Boolean(synced.active && step && step.scene === this.scene && !synced.hiddenUntilTransition);
    if (!shouldShow || !step) {
      this.setVisible(false);
      this.clearSpotlight();
      return;
    }

    this.renderStep(step, synced.stepIndex);
    this.applySpotlight(step.spotlight);
    this.setVisible(true);
  }

  private setVisible(next: boolean): void {
    this.card.hidden = !next;
    if (this.visible !== next) {
      this.visible = next;
      this.opts.onVisibilityChange?.(next);
    }
  }

  private renderStep(step: TutorStepSpec, index: number): void {
    this.card.dataset.speaker = step.speaker;
    this.card.dataset.scene = step.scene;
    this.progressEl.textContent = TUTOR_UI.stepOf
      .replace('{n}', String(index + 1))
      .replace('{total}', String(TUTOR_STEPS.length));

    const prevSpeaker = this.portraitBox.dataset.speaker;
    if (prevSpeaker !== step.speaker) {
      this.portraitBox.replaceChildren(createPortrait(step.speaker));
      this.portraitBox.dataset.speaker = step.speaker;
    }
    this.speakerEl.textContent = SPEAKER_NAMES[step.speaker];
    const copy = TUTOR_UI.steps[step.id];
    this.titleEl.textContent = copy.title;
    renderKeyHints(this.bodyEl, copy.body);

    this.waitEl.hidden = !step.waitForAction;
    this.nextBtn.hidden = step.waitForAction;
    if (!step.waitForAction) {
      const isLast = index >= TUTOR_STEPS.length - 1;
      this.nextBtn.textContent = isLast ? TUTOR_UI.done : step.hideOnAcknowledge ? TUTOR_UI.acknowledge : TUTOR_UI.next;
    }
  }

  private advance(): void {
    const state = this.store.get();
    const next = advanceTutor(state.tutor);
    const completed = state.tutor.active && !next.active;
    this.store.set({
      tutor: next,
      save: completed && !state.save.tutorialSeen ? { ...state.save, tutorialSeen: true } : state.save,
    });
    this.sync();
  }

  private finishTutor(): void {
    const state = this.store.get();
    this.store.set({
      tutor: stopTutor(),
      save: !state.save.tutorialSeen ? { ...state.save, tutorialSeen: true } : state.save,
    });
    this.sync();
  }

  private applySpotlight(selector: string | null): void {
    this.clearSpotlight();
    if (!selector) return;
    for (const node of this.host.querySelectorAll<HTMLElement>(selector)) {
      node.classList.add('tutor-spotlight');
      this.spotlights.push(node);
    }
  }

  private clearSpotlight(): void {
    for (const node of this.spotlights) node.classList.remove('tutor-spotlight');
    this.spotlights = [];
  }

  dispose(): void {
    this.clearSpotlight();
    this.setVisible(false);
    this.card.remove();
  }
}
