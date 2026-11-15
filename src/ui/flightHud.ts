import { FLIGHT, ORBITAL } from '../core/constants';
import { FLIGHT_UI } from '../core/strings';
import type { FlightSim } from '../rules/flightSim';
import type { FlightSummary } from '../rules/missionResult';
import type { SasMode } from '../rules/orbital';
import type { Rocket } from '../rules/types';
import { clear, el } from './dom';
import { renderKeyHints } from './keyHints';
import { NavballWidget } from './navball';
import { attachTooltip } from './tooltip';
import type { GlossaryKey } from './tooltip';

const SPEED_BAR_MAX = 20;

const SAS_OPTIONS: { mode: SasMode; label: string; title: string }[] = [
  { mode: 'ascent', label: 'ASC', title: 'Ascent Guidance (Gravity Turn Otomatis)' },
  { mode: 'stability', label: 'STAB', title: 'Stability Assist' },
  { mode: 'prograde', label: 'PRO', title: 'Kunci Prograde' },
  { mode: 'retrograde', label: 'RET', title: 'Kunci Retrograde' },
  { mode: 'normal', label: 'NRM', title: 'Kunci Normal' },
  { mode: 'antiNormal', label: 'ANM', title: 'Kunci Anti-Normal' },
  { mode: 'maneuver', label: 'TGT', title: 'Kunci Target Manuver' },
  { mode: 'off', label: 'OFF', title: 'SAS Nonaktif' },
];

interface StageRow { row: HTMLElement; fill: HTMLElement }

function formatDist(m: number): string {
  const abs = Math.abs(m);
  if (abs >= 1e9) return `${(m / 1e9).toFixed(2)} jt km`;
  if (abs >= 1e6) return `${(m / 1e3).toFixed(0)} km`;
  if (abs >= 10_000) return `${(m / 1e3).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}

function formatTimeShort(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  const s = Math.round(sec);
  if (s >= 86400) return `${Math.floor(s / 86400)}h ${Math.floor((s % 86400) / 3600)}j`;
  if (s >= 3600) return `${Math.floor(s / 3600)}j ${Math.floor((s % 3600) / 60)}m`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function formatWarpLabel(w: number): string {
  if (w >= 1_000_000) return `${w / 1_000_000}Mx`;
  if (w >= 1_000) return `${w / 1_000}kx`;
  return `${w}x`;
}

/** HUD kokpit 3D Keplerian: Navball, SAS (termasuk Ascent Guidance), Time Warp, diagram stage, telemetri orbit. */
export class FlightHud {
  private readonly stageRows: StageRow[] = [];
  private readonly message = el('div', 'hud-message');
  private readonly phase = el('div', 'hud-phase');
  private readonly prompt = el('div', 'hud-prompt');
  private readonly values: Record<string, HTMLElement> = {};
  private readonly throttleFill = el('div', 'bar-fill');
  private readonly speedGauge = el('div', 'gauge gauge-speed');
  private readonly speedPointer = el('div', 'speed-pointer');
  private readonly cushionBadge = el('div', 'cushion-badge', 'BANTUAN PENDARATAN AKTIF (< 2 m/s)');
  private readonly result = el('div', 'result-panel');
  private readonly navball = new NavballWidget(132);
  private readonly navReadout = el('div', 'nav-readout');
  private readonly sasButtons = new Map<SasMode, HTMLElement>();
  private readonly warpButtons: HTMLButtonElement[] = [];
  private readonly warpTargetBtn = document.createElement('button');
  private pendingWarpIndex: number | undefined;
  private pendingWarpToTarget = false;
  private lastFuelStart = 0;

  constructor(ui: HTMLElement, private readonly rocket: Rocket) {
    const root = el('div', 'flight-hud');
    root.append(this.buildTop(), this.buildStages(), this.buildTelemetry(), this.buildBottom(), this.result);
    ui.appendChild(root);
    this.result.hidden = true;
  }

  consumeWarpIndex(): number | undefined {
    const idx = this.pendingWarpIndex;
    this.pendingWarpIndex = undefined;
    return idx;
  }

  consumeWarpToTarget(): boolean {
    const val = this.pendingWarpToTarget;
    this.pendingWarpToTarget = false;
    return val;
  }

  private buildTop(): HTMLElement {
    const top = el('div', 'hud-top');
    const bar = el('div', 'hud-top-bar');
    const warpWrap = el('div', 'warp-bar');
    warpWrap.title = `${FLIGHT_UI.telemetry.warp} ([.] / [,])`;
    ORBITAL.warpSteps.forEach((w, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'warp-btn';
      btn.textContent = formatWarpLabel(w);
      btn.addEventListener('click', () => { this.pendingWarpIndex = i; });
      this.warpButtons.push(btn);
      warpWrap.appendChild(btn);
    });
    this.warpTargetBtn.type = 'button';
    this.warpTargetBtn.className = 'warp-btn warp-target-btn';
    this.warpTargetBtn.textContent = FLIGHT_UI.telemetry.warpToTarget;
    this.warpTargetBtn.hidden = true;
    this.warpTargetBtn.addEventListener('click', () => { this.pendingWarpToTarget = true; });
    bar.append(this.phase, warpWrap, this.warpTargetBtn);
    top.append(bar, this.message);
    return top;
  }

  private buildStages(): HTMLElement {
    const panel = el('div', 'hud-panel hud-left');
    const lander = el('div', 'stage-row lander-row');
    lander.append(el('span', 'stage-name', FLIGHT_UI.lander));
    panel.appendChild(lander);
    for (let i = this.rocket.stages.length - 1; i >= 0; i--) {
      const row = el('div', 'stage-row');
      row.append(el('span', 'stage-name', `${FLIGHT_UI.stage} ${i + 1}`), el('span', 'stage-sub', this.rocket.stages[i].name));
      const bar = el('div', 'bar');
      const fill = el('div', 'bar-fill');
      bar.appendChild(fill);
      row.appendChild(bar);
      panel.appendChild(row);
      this.stageRows[i] = { row, fill };
    }
    const t = FLIGHT_UI.telemetry;
    this.line(panel, 'dist', t.distance);
    this.line(panel, 'burn', t.burnTime);
    return panel;
  }

  private line(panel: HTMLElement, key: string, label: string, term?: GlossaryKey): void {
    const row = el('div', 'tele-row');
    const value = el('span', 'tele-value', '-');
    const lab = el('span', 'tele-label', label);
    if (term) attachTooltip(lab, term);
    row.append(lab, value);
    panel.appendChild(row);
    this.values[key] = value;
  }

  private buildTelemetry(): HTMLElement {
    const panel = el('div', 'hud-panel hud-right');
    const t = FLIGHT_UI.telemetry;
    this.line(panel, 'alt', t.altitude);
    this.line(panel, 'apo', t.apoapsis);
    this.line(panel, 'peri', t.periapsis);
    this.line(panel, 'surf', t.surfaceSpeed);
    this.line(panel, 'vx', t.vx);
    this.line(panel, 'vy', t.vy);
    this.line(panel, 'inc', t.inclination);
    this.line(panel, 'ecc', t.eccentricity);
    this.line(panel, 'twr', t.twr);
    this.line(panel, 'maxq', t.maxQ);
    const thr = el('div', 'tele-row');
    const bar = el('div', 'bar');
    bar.appendChild(this.throttleFill);
    this.values.throttle = el('span', 'tele-value', '0%');
    thr.append(el('span', 'tele-label', t.throttle), bar, this.values.throttle);
    panel.appendChild(thr);
    this.line(panel, 'fuel', t.fuel);
    this.line(panel, 'handling', t.handling, 'handling');
    return panel;
  }

  private buildBottom(): HTMLElement {
    const bottom = el('div', 'hud-bottom');
    const z1 = el('div', 'speed-zone z1');
    z1.title = 'Zona Sempurna: 0 - 2 m/s';
    const z2 = el('div', 'speed-zone z2');
    z2.title = 'Zona Sukses: 2 - 5 m/s';
    const z3 = el('div', 'speed-zone z3');
    z3.title = 'Zona Kerusakan: 5 - 12 m/s';
    const z4 = el('div', 'speed-zone z4');
    z4.title = 'Zona Hancur: > 12 m/s';
    this.speedGauge.append(z1, z2, z3, z4, this.speedPointer);
    renderKeyHints(this.prompt, FLIGHT_UI.prompt);
    this.prompt.hidden = true;
    this.cushionBadge.hidden = true;

    const navCluster = el('div', 'navball-cluster');
    const sasCol = el('div', 'sas-panel');
    sasCol.appendChild(el('div', 'sas-title', `${FLIGHT_UI.telemetry.sas} · Otomatis`));
    const sasGrid = el('div', 'sas-grid');
    for (const opt of SAS_OPTIONS) {
      const tag = el('span', 'sas-btn', opt.label);
      tag.title = `${opt.title} (dikendalikan autopilot)`;
      this.sasButtons.set(opt.mode, tag);
      sasGrid.appendChild(tag);
    }
    sasCol.append(sasGrid, this.navReadout);
    navCluster.append(this.navball.canvas, sasCol);

    bottom.append(this.prompt, this.cushionBadge, this.speedGauge, navCluster);
    return bottom;
  }

  private messageFor(sim: FlightSim): string {
    const m = FLIGHT_UI.messages;
    if (sim.falling) return m.falling;
    if (sim.jettisonPrompt) return m.stageDepleted;
    switch (sim.phase) {
      case 'launch': return sim.throttle <= 0 && sim.progress <= 0 ? m.launchIdle : m.launch;
      case 'orbit': return m.orbit;
      case 'transfer': return sim.coastSubPhase ? m.transferCoast : m.transfer;
      case 'capture': return m.capture;
      case 'landing': return sim.landingCushionActive ? m.cushionActive : m.landing;
      default: return '';
    }
  }

  /** Sinkronkan seluruh HUD dengan keadaan simulasi (dipanggil sekali per frame). */
  update(sim: FlightSim, suspended = false): void {
    this.phase.textContent = FLIGHT_UI.phases[sim.phase];
    const msg = suspended ? FLIGHT_UI.messages.eventPending : this.messageFor(sim);
    renderKeyHints(this.message, msg);
    this.message.classList.toggle('alert', sim.falling && !suspended);
    this.prompt.hidden = true;

    const canAutoWarp = (sim.phase === 'orbit' || (sim.phase === 'transfer' && sim.coastSubPhase)) && !suspended;
    this.warpTargetBtn.hidden = !canAutoWarp;
    this.warpTargetBtn.classList.toggle('active', sim.warpToTargetActive);

    this.rocket.stages.forEach((s, i) => {
      const st = sim.staging.stages[i];
      const r = this.stageRows[i];
      r.fill.style.width = `${(Math.max(0, st.burnRemainingSec) / s.burnSec) * 100}%`;
      r.row.dataset.state = st.phase;
    });

    this.warpButtons.forEach((btn, i) => btn.classList.toggle('active', i === sim.timeWarpIndex));
    this.sasButtons.forEach((btn, mode) => btn.classList.toggle('active', mode === sim.sasMode));

    this.values.throttle.textContent = `${Math.round(sim.throttle * 100)}%`;
    this.throttleFill.style.width = `${sim.throttle * 100}%`;
    this.values.handling.textContent = sim.handling.toFixed(2);
    this.values.dist.textContent = sim.coastSubPhase && sim.coastEtaSec > 0
      ? `${formatDist(sim.distanceToTargetM)} (${formatTimeShort(sim.coastEtaSec)})`
      : formatDist(sim.distanceToTargetM);
    this.values.burn.textContent = sim.burnTimeRemainingSec > 0 && Number.isFinite(sim.burnTimeRemainingSec)
      ? `${sim.burnTimeRemainingSec.toFixed(1)} s`
      : '-';

    const landing = sim.landing;
    const inLanding = sim.phase === 'landing' || (sim.phase === 'ended' && landing);
    if (inLanding && landing) {
      this.values.alt.textContent = `${landing.altitudeM.toFixed(0)} m`;
      this.values.apo.textContent = '-';
      this.values.peri.textContent = '-';
      this.values.surf.textContent = `${Math.hypot(landing.vx, landing.vy).toFixed(1)} m/s`;
      this.values.vx.textContent = `${landing.vx.toFixed(1)} m/s`;
      this.values.vy.textContent = `${landing.vy.toFixed(1)} m/s`;
      this.values.inc.textContent = '-';
      this.values.ecc.textContent = '-';
      this.values.twr.textContent = `${sim.twr.toFixed(2)}`;
      this.values.maxq.textContent = `${landing.tiltDeg.toFixed(0)}° tilt`;
      if (this.lastFuelStart === 0) this.lastFuelStart = Math.max(landing.fuelKg, 1);
      this.values.fuel.textContent = `${landing.fuelKg.toFixed(0)} kg`;
      const speed = Math.abs(landing.vy);
      this.values.vy.dataset.zone = speed <= FLIGHT.touchdown.perfectVy ? 'a' : speed <= FLIGHT.touchdown.successVy ? 'b' : speed <= FLIGHT.touchdown.crashVy ? 'c' : 'd';
      this.speedPointer.style.left = `${Math.min(1, speed / SPEED_BAR_MAX) * 100}%`;
      this.navReadout.textContent = `Tilt ${landing.tiltDeg.toFixed(0)}° | Vy ${landing.vy.toFixed(1)} m/s`;
    } else {
      const k = sim.kepler;
      this.values.alt.textContent = formatDist(k.altitudeM);
      this.values.apo.textContent = k.hyperbolic
        ? 'ESCAPE'
        : `${formatDist(Math.max(0, k.apoapsisAltM))} · T-${formatTimeShort(k.timeToApoapsisSec)}`;
      this.values.peri.textContent = formatDist(k.periapsisAltM);
      this.values.surf.textContent = `${sim.surfaceSpeedMs.toFixed(0)} m/s`;
      this.values.vx.textContent = `${k.speedMs.toFixed(0)} m/s`;
      this.values.vy.textContent = `${sim.verticalSpeedMs.toFixed(0)} m/s`;
      this.values.vy.dataset.zone = '';
      this.values.inc.textContent = `${k.inclinationDeg.toFixed(1)}°`;
      this.values.ecc.textContent = k.eccentricity.toFixed(3);
      this.values.twr.textContent = sim.twr.toFixed(2);
      const qKpa = sim.dynamicPressurePa / 1000;
      this.values.maxq.textContent = sim.mach > 0.05 ? `${qKpa.toFixed(1)} kPa · M${sim.mach.toFixed(1)}` : 'Vakum';
      this.values.fuel.textContent = `${sim.fuelDisplayKg.toFixed(0)} kg`;
      this.navReadout.textContent = `HDG ${sim.lvlh.headingDeg.toFixed(0)}° | PIT ${sim.lvlh.pitchDeg.toFixed(0)}°`;
    }

    this.speedGauge.hidden = !inLanding;
    this.cushionBadge.hidden = !sim.landingCushionActive;
    this.navball.render(sim.r, sim.att, sim.navball, sim.phase === 'orbit' || sim.phase === 'transfer' || sim.phase === 'capture');
  }

  /** Panel hasil di akhir penerbangan; mengembalikan tombol lanjut. */
  showResult(summary: FlightSummary, onContinue: () => void): void {
    clear(this.result);
    const R = FLIGHT_UI.result;
    const title = summary.failed ? R.failed : summary.touchdown ? R[summary.touchdown] : R.failed;
    this.result.dataset.failed = String(summary.failed);
    this.result.appendChild(el('h2', '', title));
    for (const code of summary.failCodes) this.result.appendChild(el('p', 'result-code', FLIGHT_UI.codes[code]));
    if (summary.touchdown) {
      this.result.appendChild(el('p', '', `${R.lost}: ${summary.instrumentsLost.length > 0 ? summary.instrumentsLost.join(', ') : R.none}`));
    }
    const button = el('button', 'launch-button', summary.failed ? R.toReview : R.toSurface);
    button.type = 'button';
    button.addEventListener('click', onContinue);
    this.result.appendChild(button);
    this.result.hidden = false;
  }
}
