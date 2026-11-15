import { FLIGHT, ORBITAL } from '../core/constants';
import { clamp } from './margin';
import { coastWarpIndex, NO_INPUT, type FlightInput, type FlightSim } from './flightSim';

/** Parameter batas kecepatan turun autopilot pendaratan (lokal untuk pilot otomatis; bukan konstanta aturan permainan). */
const LANDING_AP = {
  /** Porsi daya rem nyata yang boleh dipakai profil turun (< 1 menyisakan margin untuk lag kontrol dan kemiringan). */
  safetyFactor: 0.55,
  /** Kemiringan terburuk (derajat) yang dipakai untuk menghitung daya rem vertikal (sama dengan batas targetTilt). */
  worstCosTilt: Math.cos((25 * Math.PI) / 180),
  /** Lantai daya rem bersih (m/s^2) agar profil tidak runtuh ke nol pada wahana yang nyaris tidak bisa melayang. */
  minBrakeAccel: 0.2,
  /** Kecepatan sentuh yang ditambahkan pada batas kinematik agar wahana tetap turun mendekati permukaan (m/s). */
  touchdownSpeed: 1.2,
  /** Kemiringan target maksimum (derajat) dan penguatan terhadap kecepatan horizontal saat membatalkan vx. */
  maxTiltDeg: 25,
  /** Derajat kemiringan per m/s kecepatan horizontal: tinggi agar vx cepat habis (jenuh di batas kemiringan untuk vx besar). */
  tiltPerVx: 2,
  /**
   * Fase "tahan" menjelang pembakaran: bila pembakaran vertikal (suicide burn) terlalu singkat untuk membatalkan vx dengan tilt
   * biasa, wahana turun landai (kecepatan turun awal) dengan kemiringan besar sampai vx cukup kecil. Jatuh bebas tidak
   * membatalkan vx (throttle 0), jadi tanpa fase ini vx masih besar saat touchdown pada wahana ber-TWR tinggi seperti di Bulan.
   */
  holdTiltMaxDeg: 40,
  holdMinTiltDeg: 10,
  /** Kemiringan tahan harus tetap bisa melayang: T/m * cos(tilt) >= pengali * g. */
  holdHoverMargin: 1.15,
  holdMinVx: 6,
  holdMinAltM: 2_000,
  /** Fase tahan aktif selama waktu pembakaran < pengali * waktu membatalkan vx dengan tilt biasa. */
  holdMargin: 2.5,
  holdSpeed: Math.abs(FLIGHT.landing.startVy),
  /** Di atas ketinggian ini kemiringan penuh boleh dipakai; di bawah `levelEndAltM` wahana diluruskan (smoothstep di antaranya). */
  levelStartAltM: 60,
  levelEndAltM: 15,
  /** Sisa kemiringan (derajat) yang masih diizinkan di bawah `levelEndAltM` hanya bila vx masih besar: min(batas, |vx| * pengali). */
  residualTiltMaxDeg: 8,
  residualTiltPerVx: 1.2,
  /** Batas atas kecepatan turun (m/s); di bawahnya batas kinematik daya rem yang menentukan profil. */
  maxDescentSpeed: 220,
  /** Pita physics warp pendaratan menurut ketinggian (m): >= warpTenAltM 10x, >= warpFiveAltM 5x, >= FLIGHT.landing.warpMinAltM 2x, selebihnya 1x. */
  warpTenAltM: 2_500,
  warpFiveAltM: 800,
} as const;

/** Indeks `ORBITAL.warpSteps` untuk pendaratan: 3 = 10x, 2 = 5x, 1 = 2x, 0 = 1x (selalu 1x di bawah `FLIGHT.landing.warpMinAltM`). */
function landingWarpIndex(altitudeM: number): number {
  if (altitudeM >= LANDING_AP.warpTenAltM) return 3;
  if (altitudeM >= LANDING_AP.warpFiveAltM) return 2;
  if (altitudeM >= FLIGHT.landing.warpMinAltM) return 1;
  return 0;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Cara autopilot mengatur Time Warp:
 * - 'always'        : mengirim indeks warp di setiap tick (bawaan; perilaku tes lama).
 * - 'onPhaseChange' : mengirim indeks warp hanya sekali saat fase atau sub-fase berganti (launch, orbit, burn transfer,
 *                     coast transfer, capture, landing). Warp yang diatur pemain (tombol Time Warp, [H], [.] / [,])
 *                     tidak lagi ditimpa di setiap frame dan bertahan sampai fase berikutnya.
 */
export type AutopilotWarpMode = 'always' | 'onPhaseChange';

export interface AutopilotOptions {
  /** Tunda penekanan F (detik) setelah tahap habis. */
  fDelaySec?: number;
  skipPitch?: boolean;
  skipLanding?: boolean;
  warp?: AutopilotWarpMode;
}

/**
 * Pilot otomatis (kontrol penerbangan utama game, juga dipakai tes):
 * - Menggunakan SAS 'ascent' tertutup (gravity turn Timur + PEG apoapsis) menuju orbit LEO 200 km
 * - Memakai Time Warp & SAS Navball selama orbit parkir, burn TLI/TMI, coast jarak nyata, dan capture
 * - Melakukan powered descent & pembatalan kecepatan horizontal hingga touchdown aman
 */
export function makeAutopilot(sim: FlightSim, opts: AutopilotOptions = {}): () => FlightInput {
  const delay = opts.fDelaySec ?? 0;
  const warpMode: AutopilotWarpMode = opts.warp ?? 'always';
  let promptSince = -1;
  let warpKey = '';
  const maxWarpIdx = ORBITAL.warpSteps.length - 1;
  /** Anak tangga warp coast yang sedang dipakai saat menanjak (-1 = coast belum dimulai) dan waktu nyata kenaikan terakhir. */
  let coastRampIdx = -1;
  let coastRampAt = 0;

  /** Indeks warp yang diinginkan autopilot untuk fase/sub-fase saat ini, dan kuncinya (berubah saat fase berganti). */
  const wantedWarp = (): { key: string; index: number | undefined } => {
    if (!(sim.phase === 'transfer' && sim.coastSubPhase)) coastRampIdx = -1;
    switch (sim.phase) {
      case 'launch': return { key: 'launch', index: 2 }; // 5x physics warp saat peluncuran
      case 'orbit': return { key: 'orbit', index: 2 }; // 5x: orbit parkir 60 dtk berlangsung sekitar 12 dtk nyata (bukan sepersekian detik)
      case 'transfer': {
        if (sim.coastSubPhase) {
          // Tangga berbasis ETA: cepat di tengah perjalanan, lalu turun bertahap (kunci berubah di tiap anak tangga).
          // ETA belum terhitung pada tick pertama coast: biarkan warp burn berlaku satu tick.
          if (!(sim.coastEtaSec > 0)) return { key: 'transfer-coast-start', index: undefined };
          const target = Math.min(maxWarpIdx, coastWarpIndex(sim.coastEtaSec));
          // Naik satu anak tangga setiap coastWarpRampStepSec detik nyata dari warp burn (5x) sampai target, tidak pernah
          // melompat langsung ke puncak; turun mengikuti tangga ETA seketika.
          if (coastRampIdx < 0) {
            coastRampIdx = Math.min(sim.timeWarpIndex, target);
            coastRampAt = sim.elapsedSec;
          }
          if (target < coastRampIdx) {
            coastRampIdx = target;
            coastRampAt = sim.elapsedSec;
          } else if (coastRampIdx < target && sim.elapsedSec - coastRampAt >= FLIGHT.coastWarpRampStepSec) {
            coastRampIdx += 1;
            coastRampAt = sim.elapsedSec;
          }
          return { key: `transfer-coast-${coastRampIdx}`, index: coastRampIdx };
        }
        // Hitung mundur 1x sebelum TLI/TMI menyala, lalu 10x physics warp saat burn agar transfer terasa sigap.
        return sim.phaseTimeSec < FLIGHT.tliCountdownSec
          ? { key: 'transfer-countdown', index: 0 }
          : { key: 'transfer-burn', index: 3 };
      }
      case 'capture':
        // Detik pertama capture 1x agar kedatangan terasa halus, lalu 5x untuk burn penangkapan.
        return sim.phaseTimeSec < FLIGHT.captureSettleSec
          ? { key: 'capture-settle', index: 0 }
          : { key: 'capture', index: 2 };
      case 'landing': {
        // Warp bertahap menurut ketinggian (10x -> 5x -> 2x) lalu 1x untuk 350 m terakhir sampai touchdown.
        if (opts.skipLanding || !sim.landing) return { key: 'landing', index: undefined };
        const idx = landingWarpIndex(sim.landing.altitudeM);
        return { key: `landing-${idx}`, index: idx };
      }
      default: return { key: sim.phase, index: undefined };
    }
  };

  return (): FlightInput => {
    const input: FlightInput = { ...NO_INPUT };
    if (sim.jettisonPrompt) {
      if (promptSince < 0) promptSince = sim.elapsedSec;
      if (sim.elapsedSec - promptSince >= delay) {
        input.jettison = true;
        promptSince = -1;
      }
    } else {
      promptSince = -1;
    }

    const warp = wantedWarp();
    if (warp.index !== undefined) {
      // Kunci baru dicatat hanya saat indeks benar-benar dikirim, agar fase yang indeksnya belum tersedia (mis. 'landing' sebelum
      // `sim.landing` ada) tetap mengatur warp begitu siap.
      if (warpMode === 'always' || warp.key !== warpKey) input.setWarpIndex = warp.index;
      warpKey = warp.key;
    }

    switch (sim.phase) {
      case 'launch':
        input.setThrottle = 1;
        input.sasMode = opts.skipPitch ? 'off' : 'ascent';
        break;
      case 'orbit':
        input.sasMode = 'prograde';
        input.setThrottle = 0;
        break;
      case 'transfer':
        if (!sim.coastSubPhase) {
          input.sasMode = 'maneuver';
          // Gas menunggu hitung mundur selesai (SAS sudah mantap menghadap arah manuver) agar tidak langsung menyala.
          input.setThrottle = sim.phaseTimeSec >= FLIGHT.tliCountdownSec && sim.deviationDeg < 15 ? 1 : 0;
        } else {
          input.setThrottle = 0;
          input.sasMode = 'prograde';
        }
        break;
      case 'capture':
        input.sasMode = 'retrograde';
        input.setThrottle = sim.captureDoneDvMs < sim.captureTargetDvMs ? 1 : 0;
        break;
      case 'landing': {
        if (opts.skipLanding || !sim.landing) break;
        const l = sim.landing;
        const g = sim.cfg.gravity;
        const mass = sim.cfg.mfKg + l.fuelKg;
        const thrustAccel = sim.cfg.thrustN > 0 ? sim.cfg.thrustN / mass : 0;
        // Profil turun "suicide burn" dari daya rem nyata: dari ketinggian h, wahana yang mampu memperlambat a (m/s^2) berhenti
        // dengan kecepatan sentuh c bila v^2 = c^2 + 2 * k * a * h (k < 1 = margin); deselerasi profil konstan = k * a. Memakai
        // profil ini (bukan profil landai tetap 1,2 + 0,022 h yang merayap ~150 detik di 1.500 m terakhir) pendaratan singkat
        // tetapi tetap aman untuk wahana bertarik rendah (mis. Mars, a ~ 1,2 m/s^2), karena batasnya mengikuti daya rem sebenarnya.
        const brakeAccel = Math.max(LANDING_AP.minBrakeAccel, thrustAccel * LANDING_AP.worstCosTilt - g);
        const kBrake = LANDING_AP.safetyFactor * brakeAccel;
        const kinematicSpeed = Math.sqrt(LANDING_AP.touchdownSpeed ** 2 + 2 * kBrake * Math.max(0, l.altitudeM));

        // Fase tahan: jatuh bebas tidak membatalkan vx (throttle 0). Bila pembakaran vertikal lebih singkat daripada waktu yang
        // dibutuhkan tilt biasa untuk membatalkan vx (dengan margin), turun landai dahulu dengan kemiringan besar sampai vx kecil.
        // Wahana bertarik rendah (Mars) pembakarannya panjang, jadi tidak pernah masuk fase ini.
        const vFall = Math.min(LANDING_AP.maxDescentSpeed, Math.sqrt(l.vy ** 2 + 2 * g * Math.max(0, l.altitudeM)));
        const tBurn = vFall / kBrake;
        const tHorizontal = Math.abs(l.vx) / (Math.tan((LANDING_AP.maxTiltDeg * Math.PI) / 180) * (g + kBrake));
        const holdTiltDeg = thrustAccel > 0
          ? Math.min(LANDING_AP.holdTiltMaxDeg, (Math.acos(clamp((LANDING_AP.holdHoverMargin * g) / thrustAccel, 0, 1)) * 180) / Math.PI)
          : 0;
        const hold = Math.abs(l.vx) > LANDING_AP.holdMinVx
          && l.altitudeM > LANDING_AP.holdMinAltM
          && holdTiltDeg >= LANDING_AP.holdMinTiltDeg
          && tBurn < LANDING_AP.holdMargin * tHorizontal;

        // Batalkan vx dengan kemiringan penuh; mendekati tanah batas kemiringan menyusut ke 0 (wahana tegak saat touchdown).
        // Di bawah levelEndAltM hanya sisa kecil yang diizinkan, sebanding dengan vx yang belum habis.
        const level = smoothstep(LANDING_AP.levelEndAltM, LANDING_AP.levelStartAltM, l.altitudeM);
        const residualCap = Math.min(LANDING_AP.residualTiltMaxDeg, Math.abs(l.vx) * LANDING_AP.residualTiltPerVx);
        const tiltCap = hold ? holdTiltDeg : LANDING_AP.maxTiltDeg * level + residualCap * (1 - level);
        const targetTilt = clamp(-l.vx * LANDING_AP.tiltPerVx, -tiltCap, tiltCap);
        input.roll = clamp((targetTilt - l.tiltDeg) * 0.25, -1, 1);

        const targetSpeed = hold
          ? Math.min(kinematicSpeed, LANDING_AP.holdSpeed)
          : Math.min(LANDING_AP.maxDescentSpeed, kinematicSpeed);
        const targetVy = -targetSpeed;
        // Feed-forward deselerasi profil: kontroler P murni tertinggal sebesar deselerasi / penguatan (sekitar 2,5 m/s di Bulan),
        // sehingga touchdown terlalu cepat. Dengan feed-forward galat tunak ~ 0 dan kecepatan sentuh mendekati touchdownSpeed.
        const braking = !hold && kinematicSpeed < LANDING_AP.maxDescentSpeed;
        const wantAccel = clamp((braking ? kBrake : 0) + 2.4 * (targetVy - l.vy), -g, 40);
        const cosTilt = Math.max(0.5, Math.cos((l.tiltDeg * Math.PI) / 180));
        const want = sim.cfg.thrustN > 0
          ? clamp(((wantAccel + g) * mass) / (sim.cfg.thrustN * cosTilt), 0, 1)
          : 0;
        // Throttle target absolut: sim menggesernya dengan laju naik/turun pendaratan di setiap sub-step, sehingga stabil
        // pada physics warp (kendali berbasis laju akan overshoot karena input yang sama dipakai beberapa sub-step).
        input.setThrottle = want;
        break;
      }
    }
    return input;
  };
}
