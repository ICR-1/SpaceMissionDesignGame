import { LOADING_UI, TITLE_UI } from '../core/strings';
import { createLogo } from './logo';

const FADE_MS = 600;

/**
 * Layar memuat yang sudah ada di index.html (tampil sebelum skrip dimuat). Kelas ini mengganti judul cadangan dengan
 * logo SVG, lalu memperbarui bilah progres, persentase, dan langkah secara halus setiap frame.
 */
export class LoadingScreen {
  private readonly fill: HTMLElement | null;
  private readonly step: HTMLElement | null;
  private readonly pct: HTMLElement | null;
  private target = 0;
  private shown = 0;
  private lastTick = 0;
  private rafId = 0;
  private closed = false;

  constructor(private readonly root: HTMLElement | null = document.getElementById('loading')) {
    this.fill = root?.querySelector<HTMLElement>('.loading-fill') ?? null;
    this.step = root?.querySelector<HTMLElement>('.loading-step') ?? null;
    this.pct = root?.querySelector<HTMLElement>('.loading-pct') ?? null;
    const title = root?.querySelector<HTMLElement>('.loading-title');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    title?.replaceChildren(createLogo(TITLE_UI.logo, !reduced));
    const kicker = root?.querySelector<HTMLElement>('.loading-kicker');
    if (kicker) {
      const extra = document.createElement('span');
      extra.className = 'loading-kicker-extra';
      extra.textContent = LOADING_UI.kickerExtra;
      kicker.replaceChildren(document.createTextNode(LOADING_UI.kickerMain), extra);
    }
    if (this.step) this.step.textContent = LOADING_UI.subtitle;
    if (root) {
      this.lastTick = performance.now();
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    }
  }

  private tick(now: number): void {
    if (this.closed) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const diff = this.target - this.shown;
    if (Math.abs(diff) < 0.001) {
      this.shown = this.target;
    } else {
      this.shown += diff * (1 - Math.exp(-12 * dt));
    }
    this.render();
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  private render(): void {
    const f = Math.min(1, Math.max(0, this.shown));
    if (this.fill) this.fill.style.transform = `scaleX(${f.toFixed(4)})`;
    if (this.pct) this.pct.textContent = `${Math.round(f * 100)}%`;
  }

  set(fraction01: number, label: string): void {
    const f = Math.min(1, Math.max(0, fraction01));
    this.target = f;
    if (f >= 1) {
      this.shown = 1;
      this.render();
    }
    if (this.step) this.step.textContent = f >= 1 ? LOADING_UI.ready : label;
  }

  /** Tampilkan pesan bila ada langkah yang gagal (permainan tetap lanjut). */
  warn(message: string = LOADING_UI.failed): void {
    if (this.step) this.step.textContent = message;
  }

  /** Pudarkan lalu lepas dari DOM. */
  hide(): void {
    this.closed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.shown = 1;
    this.render();
    const root = this.root;
    if (!root) return;
    root.classList.add('hide');
    window.setTimeout(() => root.remove(), FADE_MS);
  }
}
