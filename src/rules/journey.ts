/**
 * Perjalanan transfer (visual murni): seberapa jauh wahana sudah meninggalkan Bumi, dan skala tampilan Bumi
 * serta planet tujuan. Bumi mengecil dan menjauh bertahap; planet tujuan tumbuh dari titik kecil.
 */
export type JourneyPhase = 'launch' | 'orbit' | 'transfer' | 'capture' | 'landing' | 'ended';

export const EARTH_FAR_SCALE = 0.08;
export const DEST_SCALE_START = 0.12;
/** Planet tujuan mulai tampak (tumbuh dari titik) saat peluncuran melewati `DEST_REVEAL_FROM`, penuh di `DEST_REVEAL_TO` (porsi lintasan). */
export const DEST_REVEAL_FROM = 0.55;
export const DEST_REVEAL_TO = 0.95;
export const DEST_SCALE_END = 1.6;
export const DEST_SCALE_CAPTURE = 2.0;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const smooth01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Kurva sinus kuadran I: langsung bergerak halus sejak awal tanpa jeda mati lalu melandai tenang saat tiba. */
const easeOutSine = (x: number): number => Math.sin(clamp01(x) * Math.PI * 0.5);

/** 0 = masih di orbit Bumi, 1 = transfer selesai; `burned` = bagian kemajuan burn/coast transfer yang sudah ditempuh. */
export function departureProgress(phase: JourneyPhase, burned: number): number {
  if (phase === 'transfer') return easeOutSine(burned);
  return phase === 'capture' || phase === 'landing' || phase === 'ended' ? 1 : 0;
}

/** Skala Bumi menurun dengan kurva perspektif (cepat menyusut saat meninggalkan LEO lalu melandai ke titik jauh). */
export const earthScale = (departure: number): number =>
  EARTH_FAR_SCALE + (1 - EARTH_FAR_SCALE) * Math.pow(1 - clamp01(departure), 1.8);

/** Skala planet tujuan: tumbuh sepanjang transfer, lalu membesar lagi saat penangkapan orbit. */
export function destScale(phase: JourneyPhase, departure: number, burned: number, launchProgress = 1): number {
  if (phase === 'launch') return DEST_SCALE_START * smooth01((launchProgress - DEST_REVEAL_FROM) / (DEST_REVEAL_TO - DEST_REVEAL_FROM));
  if (phase === 'capture') return DEST_SCALE_END + Math.min(1, Math.max(0, burned)) * (DEST_SCALE_CAPTURE - DEST_SCALE_END);
  return DEST_SCALE_START + (DEST_SCALE_END - DEST_SCALE_START) * departure;
}
