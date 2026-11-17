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

const SAS_OPTIONS: { mode: SasMode; label: string }[] = [
  { mode: 'ascent', label: 'ASC' },
  { mode: 'stability', label: 'STAB' },
  { mode: 'prograde', label: 'PRO' },
  { mode: 'retrograde', label: 'RET' },
  { mode: 'normal', label: 'NRM' },
  { mode: 'antiNormal', label: 'ANM' },
  { mode: 'maneuver', label: 'TGT' },
  { mode: 'off', label: 'OFF' },
];

interface StageRow { row: HTMLElement; fill: HTMLElement }

function formatDist(m: number): string {
  const abs = Math.abs(m);
  if (abs >= 1e9) return `${(m / 1e9).toFixed(2)} ${FLIGHT_UI.units.millionKm}`;
  if (abs >= 1e6) return `${(m / 1e3).toFixed(0)} km`;
  if (abs >= 10_000) return `${(m / 1e3).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}

function formatTimeShort(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  const s = Math.round(sec);
  const U = FLIGHT_UI.units;
  if (s >= 86400) return `${Math.floor(s / 86400)}${U.dayShort} ${Math.floor((s % 86400) / 3600)}${U.hourShort}`;
  if (s >= 3600) return `${Math.floor(s / 3600)}${U.hourShort} ${Math.floor((s % 3600) / 60)}${U.minShort}`;
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
  private readonly cushionBadge = el('div', 'cushion-badge', FLIGHT_UI.cushionBadge);
  private readonly result = el('div', 'result-panel');
  private readonly navball = new NavballWidget(132);
  private readonly navReadout = el('div', 'nav-readout');
  private readonly sasButtons = new Map<SasMode, HTMLElement>();
  private readonly warpButtons: HTMLButtonElement[] = [];
  private readonly warpTargetBtn = document.createElement('button');
  private readonly localizers: (() => void)[] = [];
  private pendingWarpIndex: number | undefined;
  private pendingWarpToTarget = false;
  private lastFuelStart = 0;
  private lastResult: { summary: FlightSummary; onContinue: () => void; instrumentName?: (id: string) => string } | null = null;

  constructor(ui: HTMLElement, private rocket: Rocket) {
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

  refreshLocale(rocket: Rocket, instrumentName?: (id: string) => string): void {
    this.rocket = rocket;
    for (const fn of this.localizers) fn();
    if (this.lastResult && !this.result.hidden) {
      this.showResult(this.lastResult.summary, this.lastResult.onContinue, instrumentName ?? this.lastResult.instrumentName);
    }
  }

  private buildTop(): HTMLElement {
    const top = el('div', 'hud-top');
    const bar = el('div', 'hud-top-bar');
    const warpWrap = el('div', 'warp-bar');
    this.localizers.push(() => { warpWrap.title = `${FLIGHT_UI.telemetry.warp} ([.] / [,])`; });
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
    this.localizers.push(() => { this.warpTargetBtn.textContent = FLIGHT_UI.telemetry.warpToTarget; });
    this.warpTargetBtn.hidden = true;
    this.warpTargetBtn.addEventListener('click', () => { this.pendingWarpToTarget = true; });
    bar.append(this.phase, warpWrap, this.warpTargetBtn);
    top.append(bar, this.message);
    for (const fn of this.localizers.slice(-2)) fn();
    return top;
  }

  private buildStages(): HTMLElement {
    const panel = el('div', 'hud-panel hud-left');
    const lander = el('div', 'stage-row lander-row');
    const landerName = el('span', 'stage-name', FLIGHT_UI.lander);
    this.localizers.push(() => { landerName.textContent = FLIGHT_UI.lander; });
    lander.append(landerName);
    panel.appendChild(lander);
    for (let i = this.rocket.stages.length - 1; i >= 0; i--) {
      const row = el('div', 'stage-row');
      const stageName = el('span', 'stage-name', `${FLIGHT_UI.stage} ${i + 1}`);
      const stageSub = el('span', 'stage-sub', this.rocket.stages[i].name);
      this.localizers.push(() => {
        stageName.textContent = `${FLIGHT_UI.stage} ${i + 1}`;
        stageSub.textContent = this.rocket.stages[i]?.name ?? '';
      });
      row.append(stageName, stageSub);
      const bar = el('div', 'bar');
      const fill = el('div', 'bar-fill');
      bar.appendChild(fill);
      row.appendChild(bar);
      panel.appendChild(row);
      this.stageRows[i] = { row, fill };
    }
    this.line(panel, 'dist', () => FLIGHT_UI.telemetry.distance);
    this.line(panel, 'burn', () => FLIGHT_UI.telemetry.burnTime);
    return panel;
  }

  private line(panel: HTMLElement, key: string, getLabel: () => string, term?: GlossaryKey): void {
    const row = el('div', 'tele-row');
    const value = el('span', 'tele-value', '-');
    const lab = el('span', 'tele-label', getLabel());
    this.localizers.push(() => { lab.textContent = getLabel(); });
    if (term) attachTooltip(lab, term);
    row.append(lab, value);
    panel.appendChild(row);
    this.values[key] = value;
  }

  private buildTelemetry(): HTMLElement {
    const panel = el('div', 'hud-panel hud-right');
    this.line(panel, 'alt', () => FLIGHT_UI.telemetry.altitude);
    this.line(panel, 'apo', () => FLIGHT_UI.telemetry.apoapsis);
    this.line(panel, 'peri', () => FLIGHT_UI.telemetry.periapsis);
    this.line(panel, 'surf', () => FLIGHT_UI.telemetry.surfaceSpeed);
    this.line(panel, 'vx', () => FLIGHT_UI.telemetry.vx);
    this.line(panel, 'vy', () => FLIGHT_UI.telemetry.vy);
    this.line(panel, 'inc', () => FLIGHT_UI.telemetry.inclination);
    this.line(panel, 'ecc', () => FLIGHT_UI.telemetry.eccentricity);
    this.line(panel, 'twr', () => FLIGHT_UI.telemetry.twr);
    this.line(panel, 'maxq', () => FLIGHT_UI.telemetry.maxQ);
    const thr = el('div', 'tele-row');
    const bar = el('div', 'bar');
    bar.appendChild(this.throttleFill);
    this.values.throttle = el('span', 'tele-value', '0%');
    const thrLabel = el('span', 'tele-label', FLIGHT_UI.telemetry.throttle);
    this.localizers.push(() => { thrLabel.textContent = FLIGHT_UI.telemetry.throttle; });
    thr.append(thrLabel, bar, this.values.throttle);
    panel.appendChild(thr);
    this.line(panel, 'fuel', () => FLIGHT_UI.telemetry.fuel);
    this.line(panel, 'handling', () => FLIGHT_UI.telemetry.handling, 'handling');
    return panel;
  }

  private buildBottom(): HTMLElement {
    const bottom = el('div', 'hud-bottom');
    const z1 = el('div', 'speed-zone z1');
    const z2 = el('div', 'speed-zone z2');
    const z3 = el('div', 'speed-zone z3');
    const z4 = el('div', 'speed-zone z4');
    const syncZones = (): void => {
      z1.title = FLIGHT_UI.zones.perfect;
      z2.title = FLIGHT_UI.zones.success;
      z3.title = FLIGHT_UI.zones.damaged;
      z4.title = FLIGHT_UI.zones.crash;
      this.cushionBadge.textContent = FLIGHT_UI.cushionBadge;
    };
    syncZones();
    this.localizers.push(syncZones);
    this.speedGauge.append(z1, z2, z3, z4, this.speedPointer);
    renderKeyHints(this.prompt, FLIGHT_UI.prompt);
    this.localizers.push(() => { renderKeyHints(this.prompt, FLIGHT_UI.prompt); });
    this.prompt.hidden = true;
    this.cushionBadge.hidden = true;

    const navCluster = el('div', 'navball-cluster');
    const sasCol = el('div', 'sas-panel');
    const sasTitle = el('div', 'sas-title', `${FLIGHT_UI.telemetry.sas} · ${FLIGHT_UI.auto}`);
    this.localizers.push(() => { sasTitle.textContent = `${FLIGHT_UI.telemetry.sas} · ${FLIGHT_UI.auto}`; });
    sasCol.appendChild(sasTitle);
    const sasGrid = el('div', 'sas-grid');
    for (const opt of SAS_OPTIONS) {
      const tag = el('span', 'sas-btn', opt.label);
      const updateTitle = (): void => { tag.title = `${FLIGHT_UI.sasOptions[opt.mode]} (${FLIGHT_UI.autopilotControlled})`; };
      updateTitle();
      this.localizers.push(updateTitle);
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
      this.values.maxq.textContent = sim.mach > 0.05 ? `${qKpa.toFixed(1)} kPa · M${sim.mach.toFixed(1)}` : FLIGHT_UI.vacuum;
      this.values.fuel.textContent = `${sim.fuelDisplayKg.toFixed(0)} kg`;
      this.navReadout.textContent = `HDG ${sim.lvlh.headingDeg.toFixed(0)}° | PIT ${sim.lvlh.pitchDeg.toFixed(0)}°`;
    }

    this.speedGauge.hidden = !inLanding;
    this.cushionBadge.hidden = !sim.landingCushionActive;
    this.navball.render(sim.r, sim.att, sim.navball, sim.phase === 'orbit' || sim.phase === 'transfer' || sim.phase === 'capture');
  }

  /** Panel hasil di akhir penerbangan; mengembalikan tombol lanjut. */
  showResult(summary: FlightSummary, onContinue: () => void, instrumentName?: (id: string) => string): void {
    this.lastResult = { summary, onContinue, instrumentName };
    clear(this.result);
    const R = FLIGHT_UI.result;
    const title = summary.failed ? R.failed : summary.touchdown ? R[summary.touchdown] : R.failed;
    this.result.dataset.failed = String(summary.failed);
    this.result.appendChild(el('h2', '', title));
    for (const code of summary.failCodes) this.result.appendChild(el('p', 'result-code', FLIGHT_UI.codes[code]));
    if (summary.touchdown) {
      const lostNames = summary.instrumentsLost.map((id) => instrumentName?.(id) ?? id);
      this.result.appendChild(el('p', '', `${R.lost}: ${lostNames.length > 0 ? lostNames.join(', ') : R.none}`));
    }
    const button = el('button', 'launch-button', summary.failed ? R.toReview : R.toSurface);
    button.type = 'button';
    button.addEventListener('click', onContinue);
    this.result.appendChild(button);
    this.result.hidden = false;
  }
}
