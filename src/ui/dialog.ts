import { audio } from '../core/audio';
import { EVENT_UI, SPEAKER_NAMES, STORY_UI } from '../core/strings';
import type { ChoiceOutcome } from '../events/eventSystem';
import type { DialogLine, DialogSpeaker, GameEvent } from '../rules/types';
import { el } from './dom';
import { describeChoice, formatEffects } from './effectText';

export interface EventDialog {
  close(): void;
  refreshLocale(event: GameEvent): void;
}

/**
 * Dialog modal event krisis: menampilkan tiap pilihan dengan konsekuensi dan peluang gagal, lalu hasilnya.
 * `resolve` melempar dadu dan menerapkan efek; `onClose` dipanggil setelah pemain menekan Lanjut.
 */
export function showEventDialog(
  host: HTMLElement,
  event: GameEvent,
  resolve: (choiceIndex: number, minigameScore?: number) => ChoiceOutcome,
  onClose: (outcome: ChoiceOutcome) => void,
  /** Menjalankan minigame untuk pilihan bertipe minigame; mengembalikan skor 0-1. */
  runMinigame?: (minigameId: string) => Promise<number>,
): EventDialog {
  const card = el('div', 'dialog modal event-dialog');
  card.dataset.speaker = 'event';
  host.appendChild(card);

  let currentEvent = event;
  let lastOutcome: ChoiceOutcome | null = null;
  let closed = false;

  const renderResult = (outcome: ChoiceOutcome): void => {
    lastOutcome = outcome;
    card.replaceChildren();
    card.dataset.failed = String(outcome.failed);
    card.append(
      el('div', 'dialog-name', `${EVENT_UI.header}: ${currentEvent.title}`),
      el('h3', 'event-result', outcome.failed ? EVENT_UI.failure : EVENT_UI.success),
      el('p', 'dialog-text', `${EVENT_UI.impact}: ${formatEffects(outcome.effects)}`),
    );
    const next = el('button', 'launch-button', EVENT_UI.next);
    next.type = 'button';
    next.addEventListener('click', () => {
      closed = true;
      card.remove();
      onClose(outcome);
    });
    card.appendChild(next);
    next.focus();
  };

  const renderChoices = (): void => {
    card.replaceChildren();
    card.append(el('div', 'dialog-name', `${EVENT_UI.header}: ${currentEvent.title}`), el('p', 'dialog-text', currentEvent.description));
    currentEvent.choices.forEach((choice, i) => {
      const d = describeChoice(choice);
      const button = el('button', 'choice event-choice');
      button.type = 'button';
      button.appendChild(el('span', 'choice-name', choice.label));
      button.appendChild(el('span', 'choice-sub', `${EVENT_UI.consequence}: ${d.consequence}`));
      if (d.risk) button.appendChild(el('span', 'choice-sub risk', `${d.risk} (${EVENT_UI.ifFail}: ${d.failImpact})`));
      button.addEventListener('click', () => {
        if (choice.minigameId && runMinigame) {
          card.hidden = true;
          void runMinigame(choice.minigameId).then((score) => {
            card.hidden = false;
            renderResult(resolve(i, score));
          });
        } else renderResult(resolve(i));
      });
      card.appendChild(button);
    });
    (card.querySelector('button.event-choice') as HTMLButtonElement | null)?.focus();
  };

  renderChoices();
  return {
    close: () => { closed = true; card.remove(); },
    refreshLocale: (nextEvent) => {
      if (closed) return;
      currentEvent = nextEvent;
      if (lastOutcome) renderResult(lastOutcome);
      else renderChoices();
    },
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const TYPE_MS = 24;
const BLIP_EVERY = 3;
const BUBBLE_MS = 6500;
let portraitUid = 0;

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e as SVGElement;
}

const poly = (points: string, fill: string, stroke = '#0b1020', sw = '1'): SVGElement =>
  svgEl('polygon', { points, fill, stroke, 'stroke-width': sw });

const path = (d: string, fill: string, stroke = 'none', sw = '1', extra: Record<string, string> = {}): SVGElement =>
  svgEl('path', { d, fill, stroke, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra });

function addPortraitBackdrop(svg: SVGElement, glowColor: string, uid: number): void {
  const gradId = `portrait-bg-${uid}`;
  const defs = svgEl('defs', {});
  const grad = svgEl('radialGradient', { id: gradId, cx: '50%', cy: '42%', r: '62%' });
  grad.append(
    svgEl('stop', { offset: '0%', 'stop-color': glowColor, 'stop-opacity': '0.28' }),
    svgEl('stop', { offset: '65%', 'stop-color': '#0f172a', 'stop-opacity': '0.96' }),
    svgEl('stop', { offset: '100%', 'stop-color': '#070b18', 'stop-opacity': '1' }),
  );
  defs.appendChild(grad);
  svg.append(
    defs,
    svgEl('rect', { x: '0', y: '0', width: '80', height: '80', fill: '#080e1f' }),
    svgEl('rect', { x: '0', y: '0', width: '80', height: '80', fill: `url(#${gradId})` }),
    svgEl('circle', {
      cx: '40', cy: '40', r: '33', fill: 'none', stroke: glowColor,
      'stroke-width': '0.8', 'stroke-dasharray': '3 4', opacity: '0.22',
    }),
    path('M6,13 V6 H13 M67,6 H74 V13 M6,67 V74 H13 M67,74 H74 V67', 'none', glowColor, '1.2', { opacity: '0.35' }),
  );
}

/** Potret vektor prosedural bertema antariksa untuk tiap pembicara (tanpa gambar eksternal). */
export function createPortrait(speaker: DialogSpeaker): SVGElement {
  const uid = ++portraitUid;
  const svg = svgEl('svg', { viewBox: '0 0 80 80', class: `portrait portrait-${speaker}`, width: '72', height: '72' });
  const glow = speaker === 'beacon' ? '#c084fc' : speaker === 'sekar' ? '#fb923c' : speaker === 'ground' ? '#60a5fa' : '#38bdf8';
  addPortraitBackdrop(svg, glow, uid);

  switch (speaker) {
    case 'nova':
      svg.append(
        poly('27,12 53,12 68,27 68,53 53,68 27,68 12,53 12,27', '#0f2544', '#38bdf8', '1.4'),
        poly('40,17 59,28 59,52 40,63 21,52 21,28', '#153e5c', '#7dd3fc', '1.1'),
        path('M40,8 V15 M40,65 V72 M8,40 H15 M65,40 H72', 'none', '#38bdf8', '1.4', { opacity: '0.75' }),
        svgEl('circle', { cx: '40', cy: '40', r: '12', fill: '#0284c7', 'fill-opacity': '0.45', stroke: '#7dd3fc', 'stroke-width': '1.3', class: 'portrait-core' }),
        svgEl('circle', { cx: '40', cy: '40', r: '7', fill: '#38bdf8', class: 'portrait-core' }),
        svgEl('circle', { cx: '40', cy: '40', r: '2.8', fill: '#e0f2fe' }),
      );
      break;

    case 'sekar': // Dr. Bil Mark Hawking — Mission Director Badan Antariksa Khatulistiwa
      svg.append(
        // Jaket Mission Director + kerah kemeja
        path('M10,80 L15,62 Q19,56 30,55 H50 Q61,56 65,62 L70,80 Z', '#1e293b', '#0f172a', '1'),
        path('M25,55 L33,80 H17 L15,63 Z', '#273549'),
        path('M55,55 L47,80 H63 L65,63 Z', '#273549'),
        path('M33,55 L40,72 L47,55 Z', '#e2e8f0'),
        path('M38.5,58 H41.5 L42,74 L38,74 Z', '#0f172a'),
        path('M17,63 L28,57 M63,63 L52,57', 'none', '#fb923c', '2'),
        poly('53,66 56,67 54.5,69.5 51.5,69.5 50,67', '#facc15', '#b45309', '0.6'),
        // Leher & bayangan dagu
        path('M34,47 V58 Q40,61 46,58 V47 Z', '#cfa080'),
        path('M34,47 Q40,54 46,47 V52 Q40,56 34,52 Z', '#b68464'),
        // Telinga
        path('M24,33 Q21,33 21.5,38 Q22,42 25,42 Z', '#d8a888', '#8a5f46', '0.8'),
        path('M56,33 Q59,33 58.5,38 Q58,42 55,42 Z', '#cfa080', '#8a5f46', '0.8'),
        // Kepala & kontur pipi
        path('M25,26 Q25,14 40,14 Q55,14 55,26 L54,39 Q53,48 40,51 Q27,48 26,39 Z', '#e7bc9e', '#8a5f46', '0.9'),
        path('M46,16 Q54,18 54.5,27 L53.5,39 Q52,47 41,50 Q49,45 50,37 V24 Z', '#d5a383', 'none', '0', { opacity: '0.5' }),
        // Rambut rapi beruban di pelipis
        path('M24,31 Q23,14 40,12 Q57,14 56,31 Q54,22 48,20 Q41,22 33,20 Q27,21 24,31 Z', '#2d2a32', '#18181b', '0.8'),
        path('M28,18 Q38,11 52,17 Q46,18 39,17 Q33,17 28,18 Z', '#475569', 'none', '0', { opacity: '0.65' }),
        path('M24.5,27 L27,24 V30 Z M55.5,27 L53,24 V30 Z', '#cbd5e1', 'none', '0', { opacity: '0.85' }),
        // Alis & mata
        path('M29,29 Q33,27.5 37,29 M43,29 Q47,27.5 51,29', 'none', '#2d2a32', '1.5'),
        svgEl('circle', { cx: '33.5', cy: '33.5', r: '1.7', fill: '#1e293b' }),
        svgEl('circle', { cx: '46.5', cy: '33.5', r: '1.7', fill: '#1e293b' }),
        svgEl('circle', { cx: '33', cy: '33', r: '0.6', fill: '#ffffff' }),
        svgEl('circle', { cx: '46', cy: '33', r: '0.6', fill: '#ffffff' }),
        // Kacamata & kilap lensa
        svgEl('rect', { x: '27.5', y: '30.5', width: '11', height: '6.5', rx: '1.8', fill: '#bae6fd', 'fill-opacity': '0.18', stroke: '#1e293b', 'stroke-width': '1.2' }),
        svgEl('rect', { x: '41.5', y: '30.5', width: '11', height: '6.5', rx: '1.8', fill: '#bae6fd', 'fill-opacity': '0.18', stroke: '#1e293b', 'stroke-width': '1.2' }),
        path('M38.5,33 H41.5 M25,32.5 H27.5 M52.5,32.5 H55', 'none', '#1e293b', '1.2'),
        path('M29.5,32 L32,35.5 M43.5,32 L46,35.5', 'none', '#ffffff', '0.9', { opacity: '0.45' }),
        // Hidung & senyum tenang
        path('M40,34 L39,40 L41.5,40.5', 'none', '#b57f61', '1.1'),
        path('M35.5,44 Q40,46.5 44.5,44', 'none', '#8f5642', '1.3'),
        // Headset komunikasi tipis
        svgEl('rect', { x: '20.5', y: '34', width: '3.5', height: '6', rx: '1.5', fill: '#334155', stroke: '#38bdf8', 'stroke-width': '0.8' }),
        path('M22,39 Q26,45 34,45.5', 'none', '#475569', '1.1'),
        svgEl('circle', { cx: '34.5', cy: '45.5', r: '1.1', fill: '#38bdf8', class: 'portrait-core' }),
      );
      break;

    case 'ground':
      svg.append(
        path('M13,80 L18,61 Q22,56 32,56 H48 Q58,56 62,61 L67,80 Z', '#1e3a5f', '#0f172a', '1'),
        path('M33,56 L40,70 L47,56 Z', '#475569'),
        path('M19,63 L29,57 M61,63 L51,57', 'none', '#60a5fa', '1.8'),
        path('M35,48 V57 H45 V48 Z', '#c49372'),
        path('M27,27 Q27,15 40,15 Q53,15 53,27 L52,40 Q51,48 40,51 Q29,48 28,40 Z', '#dba986', '#8a5f46', '0.9'),
        path('M27,29 Q27,13 40,13 Q53,13 53,29 Q50,20 40,21 Q30,20 27,29 Z', '#1e293b'),
        path('M31,30 Q34,29 37,30 M43,30 Q46,29 49,30', 'none', '#1e293b', '1.3'),
        svgEl('circle', { cx: '34', cy: '34', r: '1.6', fill: '#1e293b' }),
        svgEl('circle', { cx: '46', cy: '34', r: '1.6', fill: '#1e293b' }),
        path('M40,35 L39.5,39.5 L41,40 M36,44 Q40,46 44,44', 'none', '#8f5642', '1.2'),
        // Headset pengendali misi ganda
        path('M24,33 Q24,11 40,11 Q56,11 56,33', 'none', '#475569', '2.5'),
        svgEl('rect', { x: '22', y: '31', width: '5', height: '10', rx: '2', fill: '#334155', stroke: '#60a5fa', 'stroke-width': '1' }),
        svgEl('rect', { x: '53', y: '31', width: '5', height: '10', rx: '2', fill: '#334155', stroke: '#60a5fa', 'stroke-width': '1' }),
        path('M24,39 Q28,46 36,46', 'none', '#64748b', '1.3'),
        svgEl('circle', { cx: '36.5', cy: '46', r: '1.2', fill: '#60a5fa', class: 'portrait-core' }),
      );
      break;

    default: // Beacon — kapsul relai antariksa purba
      svg.append(
        poly('10,36 27,41 27,48 10,43', '#1d4ed8', '#60a5fa', '0.9'),
        poly('70,36 53,41 53,48 70,43', '#1d4ed8', '#60a5fa', '0.9'),
        poly('31,36 49,36 52,44 48,58 32,58 28,44', '#d97706', '#facc15', '1.1'),
        poly('34,58 46,58 44,64 36,64', '#64748b', '#94a3b8', '0.9'),
        path('M28,32 Q40,38 52,32 L48,36 H32 Z', '#cbd5e1', '#94a3b8', '0.9'),
        path('M40,34 V21', 'none', '#e2e8f0', '1.8'),
        svgEl('circle', { cx: '40', cy: '19', r: '3.8', fill: '#facc15', class: 'portrait-core' }),
        path('M29,19 A11,11 0 0 1 51,19', 'none', '#facc15', '1.5', { opacity: '0.85' }),
        path('M21,19 A19,19 0 0 1 59,19', 'none', '#c084fc', '1.3', { opacity: '0.6' }),
      );
  }
  return svg;
}

export interface DialogSequence {
  skip(): void;
  refreshLocale(nextLines?: DialogLine[]): void;
}

/**
 * Panel dialog cerita: potret, nama pembicara, teks mengetik dengan bunyi bip. Klik Lanjut (atau Enter/Spasi)
 * menyelesaikan baris lalu maju; setelah baris terakhir `onDone` dipanggil.
 */
export function showDialogSequence(host: HTMLElement, lines: DialogLine[], onDone: () => void): DialogSequence {
  if (lines.length === 0) {
    onDone();
    return { skip: () => undefined, refreshLocale: () => undefined };
  }
  let currentLines = lines;
  const card = el('div', 'dialog story-dialog');
  const portraitBox = el('div', 'portrait-box');
  const body = el('div', 'story-body');
  const name = el('div', 'dialog-name');
  const text = el('p', 'dialog-text story-text');
  const next = el('button', 'dialog-next', STORY_UI.next);
  const skip = el('button', 'choice story-skip', STORY_UI.skip);
  next.type = skip.type = 'button';
  body.append(name, text, next);
  card.append(portraitBox, body, skip);
  host.appendChild(card);

  let index = 0;
  let typed = 0;
  let timer = 0;
  let finished = false;

  const stopTyping = (): void => { window.clearInterval(timer); timer = 0; };
  const finish = (): void => {
    if (finished) return;
    finished = true;
    stopTyping();
    window.removeEventListener('keydown', onKey);
    card.remove();
    onDone();
  };
  const showLine = (): void => {
    const line = currentLines[index];
    portraitBox.replaceChildren(createPortrait(line.speaker));
    portraitBox.dataset.speaking = 'true';
    card.dataset.speaker = line.speaker;
    name.textContent = SPEAKER_NAMES[line.speaker];
    text.textContent = '';
    typed = 0;
    stopTyping();
    timer = window.setInterval(() => {
      const active = currentLines[index];
      typed += 1;
      text.textContent = active.text.slice(0, typed);
      if (typed % BLIP_EVERY === 0) audio.blip();
      if (typed >= active.text.length) {
        stopTyping();
        portraitBox.dataset.speaking = 'false';
      }
    }, TYPE_MS);
    next.textContent = STORY_UI.next;
    next.focus();
  };
  const advance = (): void => {
    const line = currentLines[index];
    if (typed < line.text.length) {
      stopTyping();
      typed = line.text.length;
      text.textContent = line.text;
      portraitBox.dataset.speaking = 'false';
      return;
    }
    index += 1;
    if (index >= currentLines.length) finish();
    else showLine();
  };
  function onKey(e: KeyboardEvent): void {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      advance();
    }
  }
  next.addEventListener('click', advance);
  skip.addEventListener('click', finish);
  window.addEventListener('keydown', onKey);
  showLine();
  return {
    skip: finish,
    refreshLocale: (nextLines) => {
      if (finished) return;
      if (nextLines && nextLines.length === currentLines.length) currentLines = nextLines;
      const line = currentLines[index];
      name.textContent = SPEAKER_NAMES[line.speaker];
      next.textContent = STORY_UI.next;
      skip.textContent = STORY_UI.skip;
      if (timer === 0) {
        typed = line.text.length;
        text.textContent = line.text;
      } else {
        text.textContent = line.text.slice(0, typed);
      }
    },
  };
}

/** Gelembung NOVA non-blokir yang hilang sendiri. */
export function showNovaBubble(host: HTMLElement, text: string, ms = BUBBLE_MS): void {
  const bubble = el('div', 'nova-bubble');
  bubble.append(createPortrait('nova'), el('div', 'nova-bubble-text', `${SPEAKER_NAMES.nova}: ${text}`));
  host.appendChild(bubble);
  audio.blip();
  window.setTimeout(() => bubble.remove(), ms);
}
