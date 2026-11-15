import * as THREE from 'three';
import { LANDER_IN_FAIRING_SCALE, ROCKET_RADIUS_REF_PAYLOAD_KG } from '../core/constants';
import type { Rocket } from '../rules/types';
import { box, column, part, shellMaterial } from './mesh';
import { seg } from './detail';

const C = {
  hull: 0xe9edf3, stripe: 0xf08a24, dark: 0x30333c, steel: 0x9aa3b0, nozzle: 0x1a1b20,
  rim: 0x6b7280, cyan: 0x4fd1ff,
  orangeFoam: 0xc85d1e, copper: 0x9e633b, soot: 0x20232a, red: 0xc93b32,
  foil: 0xc9a227, solar: 0x1b2a6b,
};
/** Aksen warna tiap tahap agar mudah dibedakan di preview. */
export const STAGE_ACCENTS = [0xf08a24, 0xd94f4f, 0xe0b73a, 0x4f8fe0];

export type RocketStyle = Rocket['visualStyle'];

/** Dimensi tampilan (satuan scene). */
const LOWER_STAGE_HEIGHT = 7;
const STAGE_HEIGHT_STEP = 0.9;
const MIN_STAGE_HEIGHT = 4;
/** Modul transfer: tahap yang tersisa menuju Bulan/Mars, dibuat tinggi dan kokoh agar tidak terlihat sisa. */
const TRANSFER_HEIGHT = 5.2;
const FAIRING_CYLINDER_HEIGHT = 3.2;
const FAIRING_CONE_HEIGHT = 2.4;
const BOOSTER_COUNT = 4;
/** Panjang nosel di bawah dasar tahap; dasar roket sebenarnya berada sekian satuan di bawah y = 0. */
export const NOZZLE_LENGTH = 0.9;

export interface RocketModel {
  root: THREE.Group;
  /** Indeks sama dengan indeks tahap pada data roket (0 = paling bawah). */
  stageGroups: THREE.Group[];
  fairingLeft: THREE.Group;
  fairingRight: THREE.Group;
  /** Slot untuk lander di bagian atas tumpukan. */
  landerSlot: THREE.Group;
  /** Cincin batas tahap (untuk preview Desain). */
  boundaryRings: THREE.Mesh[];
  radius: number;
  totalHeight: number;
  /** Tinggi puncak badan roket (tanpa fairing) per tahap yang masih menempel. */
  stageTopY: number[];
}

const isBooster = (name: string): boolean => /booster/i.test(name);

function nozzle(r: number, y0: number, x = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(column(r * 0.35, r * 0.62, y0 - 0.9, 0.9, C.rim, 8, x, z));
  g.add(column(r * 0.28, r * 0.52, y0 - 0.88, 0.85, C.nozzle, 8, x, z));
  return g;
}

function nozzleCluster(coreR: number, ringCount: number, withCenter: boolean, bellR: number, ringR: number): THREE.Group {
  const g = new THREE.Group();
  if (withCenter) g.add(nozzle(bellR, 0, 0, 0));
  for (let k = 0; k < ringCount; k++) {
    const a = (k / ringCount) * Math.PI * 2 + (ringCount === 4 ? Math.PI / 4 : 0);
    g.add(nozzle(bellR, 0, Math.cos(a) * coreR * ringR, Math.sin(a) * coreR * ringR));
  }
  return g;
}

function buildStageBody(index: number, r: number, h: number, style?: RocketStyle): THREE.Group {
  const g = new THREE.Group();
  g.name = `stage-${index}`;
  const accent = STAGE_ACCENTS[index % STAGE_ACCENTS.length];

  if (style === 'falcon9') {
    // Falcon 9 Block 5: tangki putih, interstage komposit hitam, 4 sirip kisi, 4 kaki pendaratan terlipat, octaweb 9x Merlin 1D
    g.add(column(r * 0.98, r, 0, h * 0.78, C.hull, 10));
    g.add(column(r * 1.01, r * 1.01, h * 0.78, h * 0.22, C.soot, 10));
    g.add(column(r * 1.03, r * 1.03, 0, h * 0.08, C.soot, 10));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const ca = Math.cos(a), sa = Math.sin(a);
      // 4 kaki pendaratan karbon terlipat ke atas
      g.add(box(r * 0.16, h * 0.36, r * 0.08, C.soot, [ca * r * 1.02, h * 0.19, sa * r * 1.02], [0, -a + Math.PI / 2, 0]));
      // 4 sirip kisi titanium di bawah interstage
      g.add(box(r * 0.3, r * 0.06, r * 0.24, C.steel, [ca * r * 1.15, h * 0.73, sa * r * 1.15], [0, -a, 0]));
    }
    g.add(nozzleCluster(r, 8, true, r * 0.28, 0.56));
    return g;
  }

  if (style === 'atlas5') {
    // Atlas V Common Core Booster: tangki perunggu anodisasi tembaga + RD-180 twin nozzle
    g.add(column(r * 0.98, r, 0, h, C.copper, 10));
    g.add(column(r * 1.02, r * 1.02, h * 0.86, h * 0.14, C.hull, 10));
    g.add(column(r * 1.02, r * 1.02, 0, h * 0.08, C.dark, 10));
    g.add(nozzleCluster(r, 2, false, r * 0.45, 0.42));
    return g;
  }

  if (style === 'sls') {
    // SLS Core Stage: tangki busa jingga NASA (SOFI) + intertank bergaris + 4x RS-25 SSME
    g.add(column(r * 0.98, r, 0, h, C.orangeFoam, 12));
    g.add(column(r * 1.02, r * 1.02, h * 0.62, h * 0.12, C.orangeFoam, 12));
    g.add(column(r * 1.02, r * 1.02, 0, h * 0.09, C.hull, 12));
    g.add(column(r * 1.02, r * 1.02, h - 0.26, 0.26, C.dark, 12));
    for (const side of [-1, 1]) {
      g.add(box(r * 0.08, h * 0.78, r * 0.08, C.hull, [side * r * 1.02, h * 0.45, 0]));
    }
    g.add(nozzleCluster(r, 4, false, r * 0.36, 0.46));
    return g;
  }

  if (style === 'saturn5') {
    // Saturn V: S-IC putih dengan pola roll hitam ikonik & 4 sirip + 5x F-1; S-II putih/hitam + 5x J-2
    g.add(column(r * 0.98, r, 0, h, C.hull, 12));
    g.add(column(r * 1.03, r * 1.03, h - 0.35, 0.35, C.soot, 12));
    if (index === 0) {
      g.add(column(r * 1.02, r * 1.02, 0, h * 0.14, C.soot, 12));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        // Garis roll hitam vertikal & sirip stabilisator S-IC
        g.add(box(r * 0.26, h * 0.35, r * 0.08, C.soot, [ca * r * 0.96, h * 0.34, sa * r * 0.96], [0, -a + Math.PI / 2, 0]));
        g.add(box(r * 0.55, r * 0.72, r * 0.07, C.hull, [ca * r * 1.18, h * 0.08, sa * r * 1.18], [0, -a, 0]));
      }
    } else {
      g.add(column(r * 1.02, r * 1.02, h * 0.12, 0.28, C.red, 12));
    }
    g.add(nozzleCluster(r, 4, true, r * 0.34, 0.55));
    return g;
  }

  g.add(column(r * 0.97, r, 0, h, C.hull, 8));
  g.add(column(r * 1.01, r * 1.01, h * 0.12, 0.38, accent, 8));
  g.add(column(r * 1.01, r * 1.01, h * 0.55, 0.12, C.dark, 8));
  g.add(column(r * 1.05, r * 1.05, h - 0.25, 0.25, C.dark, 8));
  g.add(nozzle(r, 0));
  return g;
}

/**
 * Modul transfer (tahap terakhir): tangki propelan besar berkubah ganda dengan cincin penguat, rok antar-tahap,
 * rangka struktur, empat pod RCS, dan nosel berukuran lebih besar daripada tahap bawah.
 */
function buildTransferStage(index: number, r: number, h: number, style?: RocketStyle): THREE.Group {
  const g = new THREE.Group();
  g.name = `stage-${index}`;
  const accent = style === 'sls' ? C.orangeFoam : style === 'saturn5' ? C.soot : STAGE_ACCENTS[index % STAGE_ACCENTS.length];
  const tankColor = style === 'atlas5' ? C.steel : C.hull;
  // Rok mesin di bawah, badan tangki, dan rok atas
  g.add(column(r * 0.9, r * 1.0, 0, h * 0.14, C.dark, 12));
  g.add(column(r * 0.98, r * 0.98, h * 0.14, h * 0.72, tankColor, 12));
  g.add(column(r * 1.0, r * 0.9, h * 0.86, h * 0.14, C.dark, 12));
  // Adaptor melingkar dudukan lander (menempel pada tahap transfer agar ikut terlepas saat separasi)
  g.add(column(r * 0.88, r * 0.64, h, 0.12, C.steel, 12));
  // Kubah tangki tersembul di antara cincin
  g.add(part(new THREE.SphereGeometry(r * 0.97, seg(12), seg(6), 0, Math.PI * 2, 0, Math.PI / 2), tankColor, [0, h * 0.86, 0]));
  // Cincin penguat dan aksen tahap
  for (const f of [0.3, 0.5, 0.7]) g.add(column(r * 1.03, r * 1.03, h * f, 0.1, f === 0.5 ? accent : C.steel, 12));
  // Rangka struktur vertikal di sekeliling tangki
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    g.add(box(0.1, h * 0.72, 0.1, C.steel, [Math.cos(a) * r * 1.02, h * 0.5, Math.sin(a) * r * 1.02]));
  }
  // Pod RCS (empat sudut) dengan nosel kecil
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * r * 1.12, z = Math.sin(a) * r * 1.12;
    g.add(box(0.34, 0.5, 0.34, C.dark, [x, h * 0.82, z]));
    g.add(column(0.05, 0.12, h * 0.82 - 0.4, 0.22, C.rim, 6, x, z));
  }
  g.add(nozzle(r * 1.2, 0));
  return g;
}

/** Konfigurasi geometri booster samping berdasarkan gaya roket NASA. */
export function boosterSpec(style?: RocketStyle): { count: number; angleOffset: number; radiusRatio: number; offsetGap: number } {
  if (style === 'sls') return { count: 2, angleOffset: 0, radiusRatio: 0.46, offsetGap: 0.08 };
  if (style === 'atlas5') return { count: 5, angleOffset: Math.PI / 5, radiusRatio: 0.3, offsetGap: 0.05 };
  return { count: BOOSTER_COUNT, angleOffset: Math.PI / 4, radiusRatio: 0.38, offsetGap: 0.05 };
}

/** Posisi dan radius tiap booster samping (lokal terhadap grup tahap booster); dipakai badan dan api mesin. */
export function boosterLayout(coreR: number, style?: RocketStyle): { x: number; z: number; r: number }[] {
  const spec = boosterSpec(style);
  const br = coreR * spec.radiusRatio;
  return Array.from({ length: spec.count }, (_, k) => {
    const a = (k / spec.count) * Math.PI * 2 + spec.angleOffset;
    const dist = coreR + br + spec.offsetGap;
    return { x: Math.cos(a) * dist, z: Math.sin(a) * dist, r: br };
  });
}

/** Apakah tahap ini berupa booster samping (api mesinnya di empat titik, bukan di tengah). */
export const isBoosterStage = (name: string): boolean => isBooster(name);

function buildBoosters(index: number, coreR: number, h: number, style?: RocketStyle): THREE.Group {
  const g = new THREE.Group();
  g.name = `stage-${index}`;
  const accent = style === 'sls' ? C.red : STAGE_ACCENTS[index % STAGE_ACCENTS.length];
  for (const b of boosterLayout(coreR, style)) {
    g.add(column(b.r, b.r, 0, h, C.hull, 8, b.x, b.z));
    g.add(column(b.r * 1.03, b.r * 1.03, h * 0.16, 0.28, accent, 8, b.x, b.z));
    if (style === 'sls') {
      g.add(column(b.r * 1.03, b.r * 1.03, h * 0.72, 0.24, C.soot, 8, b.x, b.z));
    }
    g.add(part(new THREE.ConeGeometry(b.r, b.r * 2.3, seg(8)), style === 'sls' ? C.hull : C.dark, [b.x, h + b.r * 1.15, b.z]));
    g.add(nozzle(b.r * 1.3, 0, b.x, b.z));
  }
  return g;
}

function buildFairingHalf(side: 1 | -1, radius: number, y0: number): THREE.Group {
  const g = new THREE.Group();
  g.name = side === 1 ? 'fairing-right' : 'fairing-left';
  const thetaStart = side === 1 ? 0 : Math.PI; // belahan +x / -x
  const cyl = new THREE.CylinderGeometry(radius, radius, FAIRING_CYLINDER_HEIGHT, seg(8), 1, true, thetaStart, Math.PI);
  g.add(part(cyl, C.hull, [0, y0 + FAIRING_CYLINDER_HEIGHT / 2, 0], [0, 0, 0], shellMaterial));
  const cone = new THREE.CylinderGeometry(radius * 0.08, radius, FAIRING_CONE_HEIGHT, seg(8), 1, true, thetaStart, Math.PI);
  g.add(part(cone, C.hull, [0, y0 + FAIRING_CYLINDER_HEIGHT + FAIRING_CONE_HEIGHT / 2, 0], [0, 0, 0], shellMaterial));
  g.add(part(new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, 0.12, seg(8), 1, true, thetaStart, Math.PI), C.stripe, [0, y0 + 0.5, 0], [0, 0, 0], shellMaterial));
  return g;
}

/** Roket modular: satu THREE.Group per tahap, fairing kiri/kanan, dan slot lander (PRD 12). */
export function buildRocket(rocket: Rocket): RocketModel {
  const root = new THREE.Group();
  root.name = `rocket-${rocket.id}`;
  const n = rocket.stages.length;
  const radius = Math.cbrt(rocket.payloadToLeoKg / ROCKET_RADIUS_REF_PAYLOAD_KG);
  const stageGroups: THREE.Group[] = [];
  const stageTopY: number[] = [];
  const boundaryRings: THREE.Mesh[] = [];
  let y = 0;

  const bodyHeight = (i: number): number => Math.max(MIN_STAGE_HEIGHT, LOWER_STAGE_HEIGHT - STAGE_HEIGHT_STEP * i);

  const style = rocket.visualStyle;
  rocket.stages.forEach((stage, i) => {
    const last = i === n - 1;
    let group: THREE.Group;
    if (isBooster(stage.name)) {
      const h = bodyHeight(i) + 0.5;
      group = buildBoosters(i, radius, h, style);
      group.position.y = y;
      stageTopY.push(y + h);
    } else {
      const h = last ? TRANSFER_HEIGHT : bodyHeight(i);
      group = last ? buildTransferStage(i, radius, h, style) : buildStageBody(i, radius, h, style);
      group.position.y = y;
      y += h;
      stageTopY.push(y);
      // Cincin batas dipasang pada grup tahapnya sendiri (koordinat lokal = puncak tahap) agar ikut terlepas
      // saat tahap dilepas; di root cincin tertinggal melayang sebagai cakram biru setelah separasi.
      const ring = part(new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, 0.08, seg(16)), C.cyan, [0, h, 0]);
      ring.name = `boundary-${i}`;
      boundaryRings.push(ring);
      group.add(ring);
    }
    root.add(group);
    stageGroups.push(group);
  });

  const landerSlot = new THREE.Group();
  landerSlot.name = 'lander-slot';
  landerSlot.position.y = y;
  root.add(landerSlot);

  const fairingR = Math.max(radius * 0.97, 0.9);
  const fairingLeft = buildFairingHalf(-1, fairingR, y);
  const fairingRight = buildFairingHalf(1, fairingR, y);
  root.add(fairingLeft, fairingRight);

  return {
    root, stageGroups, fairingLeft, fairingRight, landerSlot, boundaryRings, radius,
    totalHeight: y + FAIRING_CYLINDER_HEIGHT + FAIRING_CONE_HEIGHT, stageTopY,
  };
}

export interface CruiseShell {
  root: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
}

/**
 * Kapsul jelajah + aeroshell pelindung wahana pendarat: menutup rapat lander berkaki empat selama berada
 * di orbit, burn transfer, dan coast antarplanet; dilepas bersama tahap transfer saat penangkapan orbit.
 */
export function buildCruiseShell(rocketRadius: number): CruiseShell {
  const root = new THREE.Group();
  root.name = 'cruise-shell';
  const r = Math.max(rocketRadius * 0.84, 0.78);

  // Adaptor docking bawah, badan bus jelajah berinsulasi emas, dan kerah aeroshell karbon
  root.add(column(r * 0.94, r * 0.9, 0, 0.22, C.dark, 12));
  root.add(column(r * 0.88, r * 0.88, 0.22, 1.2, C.hull, 12));
  root.add(column(r * 0.91, r * 0.91, 0.42, 0.42, C.foil, 12));
  root.add(column(r * 0.92, r * 0.92, 0.98, 0.14, C.stripe, 12));
  root.add(column(r * 0.96, r * 0.92, 1.38, 0.18, C.soot, 12));

  // Kerucut aeroshell pelindung & hidung sensor kapsul
  root.add(column(r * 0.9, r * 0.56, 1.56, 1.05, C.hull, 12));
  root.add(column(r * 0.56, r * 0.26, 2.61, 0.55, C.dark, 12));
  root.add(column(r * 0.24, r * 0.08, 3.16, 0.3, C.steel, 10));

  const wingLen = Math.max(1.25, r * 1.45);
  const wingW = Math.max(0.45, r * 0.54);
  const makeWing = (side: 1 | -1): THREE.Group => {
    const g = new THREE.Group();
    g.name = side < 0 ? 'cruise-wing-left' : 'cruise-wing-right';
    g.position.set(side * r * 0.91, 0.95, 0);
    g.add(box(0.05, wingLen, wingW * 0.2, C.steel, [0, wingLen * 0.5, 0]));
    g.add(box(0.035, wingLen * 0.86, wingW, C.solar, [0, wingLen * 0.56, 0]));
    g.add(box(0.04, 0.08, wingW * 0.96, C.hull, [0, wingLen * 0.56, 0]));
    return g;
  };
  const leftWing = makeWing(-1);
  const rightWing = makeWing(1);
  root.add(leftWing, rightWing);
  return { root, leftWing, rightWing };
}

/** Pasang lander (sudah dibangun) pada slot dan skalakan agar muat di dalam fairing. */
export function mountLander(model: RocketModel, lander: THREE.Group): void {
  const foot = (lander.userData.reach as number | undefined) ?? (lander.userData.footRadius as number | undefined) ?? 1.7;
  const fairingR = Math.max(model.radius * 0.97, 0.9);
  const scale = Math.min(LANDER_IN_FAIRING_SCALE, (fairingR * 0.92) / foot);
  lander.scale.setScalar(scale);
  lander.position.y = 0.12;
  model.landerSlot.add(lander);
}

/** Titik pivot kamera/rotasi roket berada sekian satuan di atas slot lander (puncak badan). */
export const PIVOT_LIFT = 0.5;

/**
 * Tata letak peluncuran: `rootY` menaruh pivot (puncak roket) di y = 0, dan `padY` adalah tinggi tanah yang
 * tepat menyentuh dasar nosel. Tanah harus berada di `padY`, bukan y = 0, agar roket berdiri di atasnya.
 */
export function launchLayout(model: RocketModel): { rootY: number; padY: number } {
  const rootY = -(model.landerSlot.position.y + PIVOT_LIFT);
  return { rootY, padY: rootY - NOZZLE_LENGTH };
}
