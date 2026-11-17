import { audio } from '../core/audio';
import { TEXT_SCALES } from '../core/constants';
import { setLang, STORY_UI } from '../core/strings';
import type { DetailLevel } from '../gen/detail';
import type { Lang } from '../rules/types';
import { el } from './dom';

export function applyTextScale(index: number): void {
  const scale = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, index))];
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

export interface ControlsState {
  muted: boolean;
  volume: number;
  textScale: number;
  shadows: boolean;
  detail: DetailLevel;
  music: boolean;
  lang: Lang;
}

/**
 * Tombol roda gigi di kiri bawah yang membuka panel Pengaturan (suara, musik, volume, bahasa, ukuran teks, bayangan, detail).
 * `onChange` dipanggil setiap ada perubahan agar pilihan disimpan.
 */
export function createSettings(
  host: HTMLElement,
  initial: ControlsState,
  onChange: (state: ControlsState) => void,
): { setDetail(level: DetailLevel): void; open(): void } {
  let textScale = initial.textScale;
  let shadows = initial.shadows;
  let detail = initial.detail;
  let music = initial.music;
  let lang: Lang = initial.lang;
  applyTextScale(textScale);
  const emit = (): void => onChange({
    muted: audio.isMuted, volume: audio.currentVolume, textScale, shadows, detail, music, lang,
  });

  const root = el('div', 'settings');
  const toggle = el('button', 'settings-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = el('div', 'settings-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');

  const head = el('div', 'settings-head');
  const titleEl = el('h3', '', STORY_UI.settings);
  const close = el('button', 'settings-close', '×');
  close.type = 'button';
  head.append(titleEl, close);

  const row = (getLabel: () => string, ...controls: HTMLElement[]): { el: HTMLDivElement; update: () => void } => {
    const r = el('div', 'settings-row');
    const lab = el('span', 'settings-label', getLabel());
    const c = el('div', 'settings-controls');
    c.append(...controls);
    r.append(lab, c);
    return {
      el: r,
      update: () => { lab.textContent = getLabel(); },
    };
  };
  const switchButton = (onClick: () => void): HTMLButtonElement => {
    const b = el('button', 'settings-switch');
    b.type = 'button';
    b.addEventListener('click', () => { onClick(); emit(); });
    return b;
  };
  const setSwitch = (b: HTMLButtonElement, on: boolean, text: string = on ? STORY_UI.on : STORY_UI.off): void => {
    b.textContent = text;
    b.dataset.on = String(on);
    b.setAttribute('aria-pressed', String(on));
  };

  const soundButton = switchButton(() => { audio.unlock(); audio.setMuted(!audio.isMuted); refresh(); });
  const musicButton = switchButton(() => { music = !music; refresh(); });
  const slider = el('input', 'settings-volume');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(initial.volume * 100));
  const volumeValue = el('span', 'settings-value');
  slider.addEventListener('input', () => {
    audio.unlock();
    audio.setVolume(Number(slider.value) / 100);
    refresh();
    emit();
  });

  const langIdBtn = el('button', 'settings-step settings-lang', STORY_UI.langId);
  const langEnBtn = el('button', 'settings-step settings-lang', STORY_UI.langEn);
  langIdBtn.type = langEnBtn.type = 'button';
  langIdBtn.title = 'Bahasa Indonesia';
  langEnBtn.title = 'English';
  const selectLang = (next: Lang): void => {
    if (lang === next) return;
    lang = next;
    setLang(lang);
    refresh();
    emit();
  };
  langIdBtn.addEventListener('click', () => selectLang('id'));
  langEnBtn.addEventListener('click', () => selectLang('en'));

  const textValue = el('span', 'settings-value');
  const textButton = (label: string, delta: number, getTitle: () => string): { btn: HTMLButtonElement; update: () => void } => {
    const b = el('button', 'settings-step', label);
    b.type = 'button';
    b.title = getTitle();
    b.addEventListener('click', () => {
      textScale = Math.min(TEXT_SCALES.length - 1, Math.max(0, textScale + delta));
      applyTextScale(textScale);
      refresh();
      emit();
    });
    return { btn: b, update: () => { b.title = getTitle(); } };
  };
  const smallerBtn = textButton('A−', -1, () => STORY_UI.textSmaller);
  const largerBtn = textButton('A+', 1, () => STORY_UI.textLarger);
  const shadowButton = switchButton(() => { shadows = !shadows; refresh(); });
  const detailButton = switchButton(() => { detail = detail === 'high' ? 'low' : 'high'; refresh(); });

  const soundSection = el('h4', 'settings-section settings-section-sound', STORY_UI.sound);
  const displaySection = el('h4', 'settings-section settings-section-display', STORY_UI.display);
  const rows = [
    row(() => STORY_UI.soundEffects, soundButton),
    row(() => STORY_UI.music, musicButton),
    row(() => STORY_UI.volume, slider, volumeValue),
    row(() => STORY_UI.language, langIdBtn, langEnBtn),
    row(() => STORY_UI.textSize, smallerBtn.btn, textValue, largerBtn.btn),
    row(() => STORY_UI.shadows, shadowButton),
    row(() => STORY_UI.detail, detailButton),
  ];

  function refresh(): void {
    toggle.title = STORY_UI.settings;
    toggle.setAttribute('aria-label', STORY_UI.settings);
    panel.setAttribute('aria-label', STORY_UI.settings);
    titleEl.textContent = STORY_UI.settings;
    close.title = STORY_UI.close;
    close.setAttribute('aria-label', STORY_UI.close);
    soundSection.textContent = STORY_UI.sound;
    displaySection.textContent = STORY_UI.display;
    slider.setAttribute('aria-label', STORY_UI.volume);
    smallerBtn.update();
    largerBtn.update();
    detailButton.title = STORY_UI.detailTitle;
    rows.forEach((r) => r.update());

    setSwitch(soundButton, !audio.isMuted);
    setSwitch(musicButton, music);
    volumeValue.textContent = `${slider.value}%`;
    slider.disabled = audio.isMuted;
    langIdBtn.textContent = STORY_UI.langId;
    langEnBtn.textContent = STORY_UI.langEn;
    setSwitch(langIdBtn, lang === 'id', STORY_UI.langId);
    setSwitch(langEnBtn, lang === 'en', STORY_UI.langEn);
    textValue.textContent = `${Math.round(TEXT_SCALES[textScale] * 100)}%`;
    setSwitch(shadowButton, shadows);
    setSwitch(detailButton, detail === 'high', detail === 'high' ? STORY_UI.detailHigh : STORY_UI.detailLow);
  }

  panel.append(
    head,
    soundSection,
    rows[0].el,
    rows[1].el,
    rows[2].el,
    displaySection,
    rows[3].el,
    rows[4].el,
    rows[5].el,
    rows[6].el,
  );

  let isOpen = false;
  const setOpen = (open: boolean): void => {
    isOpen = open;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    root.classList.toggle('open', open);
  };
  toggle.addEventListener('click', () => setOpen(!isOpen));
  close.addEventListener('click', () => setOpen(false));
  document.addEventListener('pointerdown', (e) => {
    if (isOpen && !root.contains(e.target as Node)) setOpen(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) setOpen(false);
  });
  // Tombol keyboard game (WASD, Spasi, angka) tidak boleh ikut terpicu saat slider/tombol di panel fokus.
  panel.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });

  refresh();
  root.append(panel, toggle);
  host.appendChild(root);
  return {
    open() {
      setOpen(true);
    },
    setDetail(level) {
      if (level === detail) return;
      detail = level;
      refresh();
      emit();
    },
  };
}
