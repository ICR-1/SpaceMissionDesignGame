import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import rocketsData from '../../data/rockets.json';
import modulesData from '../../data/modules.json';
import instrumentsData from '../../data/instruments.json';
import { buildLander, type LanderPartBox } from '../../src/gen/lander';
import { buildRocket, mountLander } from '../../src/gen/rocket';
import { buildFacilityComplex } from '../../src/gen/facilities';
import { createTerrain } from '../../src/gen/terrain';
import { rockColliders, scatterRocks } from '../../src/gen/props';
import type { Instrument, Module, Rocket } from '../../src/rules/types';

const rockets = rocketsData as unknown as Rocket[];
const modules = modulesData as unknown as Module[];
const instruments = instrumentsData as unknown as Instrument[];

const LANDER_IDS = ['apollo_lm', 'artemis_hls', 'mars_edl'] as const;

function worldBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj);
}

function toBox3(p: LanderPartBox): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(...p.min), new THREE.Vector3(...p.max));
}

describe('Pencegahan tumpang tindih model 3D (noOverlap)', () => {
  it('kaki, tangki, baterai, RTG, rover, panel surya, instrumen, dan antena lander tidak saling menimpa', () => {
    const nonLanderModules: Module[] = [
      ...modules.filter((m) => m.kind === 'engine').slice(0, 1),
      ...modules.filter((m) => m.kind === 'tank').slice(0, 2),
      ...modules.filter((m) => m.kind === 'solar').slice(0, 2),
      ...modules.filter((m) => m.kind === 'battery').slice(0, 2),
      ...modules.filter((m) => m.kind === 'rtg').slice(0, 1),
      ...modules.filter((m) => m.kind === 'rover').slice(0, 1),
      ...modules.filter((m) => m.kind === 'antenna'), // ant_hga, ant_lga, relay_link
    ];

    for (const landerId of LANDER_IDS) {
      const landerMod = modules.find((m) => m.id === landerId);
      expect(landerMod).toBeDefined();
      const lm = buildLander([landerMod!, ...nonLanderModules], instruments.slice(0, 6), true);
      const parts = (lm.userData.parts ?? []) as LanderPartBox[];
      expect(parts.length).toBeGreaterThanOrEqual(10);

      const legs = parts.filter((p) => p.kind.startsWith('leg-'));
      const tanks = parts.filter((p) => p.kind.startsWith('tank-'));
      const batteries = parts.filter((p) => p.kind.startsWith('battery-'));
      const rtg = parts.filter((p) => p.kind === 'rtg');
      const solars = parts.filter((p) => p.kind.startsWith('solar-'));
      const rover = parts.filter((p) => p.kind === 'rover');
      const antennas = parts.filter((p) => p.kind.startsWith('antenna-'));
      const insts = parts.filter((p) => p.kind.startsWith('instrument-'));

      // 1. Baterai & RTG bebas dari keempat kaki pendarat, tangki, dan rover
      for (const attach of [...batteries, ...rtg]) {
        const ab = toBox3(attach);
        for (const other of [...legs, ...tanks, ...rover]) {
          expect(
            ab.intersectsBox(toBox3(other)),
            `${landerId}: ${attach.kind} menimpa ${other.kind}`,
          ).toBe(false);
        }
      }

      // 2. Instrumen dek bebas dari panel surya, antena, dan instrumen lain
      for (let i = 0; i < insts.length; i++) {
        const ib = toBox3(insts[i]);
        for (let j = i + 1; j < insts.length; j++) {
          expect(
            ib.intersectsBox(toBox3(insts[j])),
            `${landerId}: ${insts[i].kind} menimpa ${insts[j].kind}`,
          ).toBe(false);
        }
        for (const other of [...solars, ...antennas]) {
          expect(
            ib.intersectsBox(toBox3(other)),
            `${landerId}: ${insts[i].kind} menimpa ${other.kind}`,
          ).toBe(false);
        }
      }

      // 3. Antena berbeda tidak saling bertabrakan satu sama lain
      for (let i = 0; i < antennas.length; i++) {
        for (let j = i + 1; j < antennas.length; j++) {
          if (antennas[i].kind === antennas[j].kind) continue;
          expect(
            toBox3(antennas[i]).intersectsBox(toBox3(antennas[j])),
            `${landerId}: ${antennas[i].kind} menimpa ${antennas[j].kind}`,
          ).toBe(false);
        }
      }

      // 4. Solar panel bebas dari rover yang dibawa
      for (const s of solars) {
        for (const r of rover) {
          expect(toBox3(s).intersectsBox(toBox3(r)), `${landerId}: ${s.kind} menimpa rover`).toBe(false);
        }
      }
    }
  });

  it('lander terpasang rapi di dalam fairing setiap roket tanpa menembus dinding fairing', () => {
    const basicModules = modules.filter((m) => m.id === 'solar_s' || m.id === 'battery_s' || m.id === 'ant_lga' || m.id === 'eng_aj10');
    for (const rocket of rockets) {
      for (const landerId of LANDER_IDS) {
        const landerMod = modules.find((m) => m.id === landerId)!;
        const rm = buildRocket(rocket);
        const lm = buildLander([landerMod, ...basicModules], instruments.slice(0, 2), false);
        mountLander(rm, lm);
        rm.root.updateWorldMatrix(true, true);

        const fairingBox = new THREE.Box3();
        fairingBox.expandByObject(rm.fairingLeft);
        fairingBox.expandByObject(rm.fairingRight);
        const landerBox = worldBox(lm);

        expect(landerBox.min.y).toBeGreaterThanOrEqual(fairingBox.min.y - 0.15);
        expect(landerBox.max.y).toBeLessThanOrEqual(fairingBox.max.y + 0.15);
        expect(landerBox.max.x).toBeLessThanOrEqual(fairingBox.max.x + 0.15);
        expect(landerBox.min.x).toBeGreaterThanOrEqual(fairingBox.min.x - 0.15);
      }
    }
  });

  it('kompleks bangunan launch site tidak pernah saling bertumpuk pada berbagai seed', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const complex = buildFacilityComplex(seed);
      complex.updateWorldMatrix(true, true);
      const boxes = complex.children.map((b) => ({ name: b.name, box: worldBox(b) }));
      expect(boxes.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(
            boxes[i].box.intersectsBox(boxes[j].box),
            `seed ${seed}: ${boxes[i].name} menimpa ${boxes[j].name}`,
          ).toBe(false);
        }
      }
    }
  });

  it('batu sebaran di permukaan tidak saling bertumpuk dan menjaga zona aman pendarat', () => {
    const terrain = createTerrain({ seed: 11, palette: ['#8c9098', '#aeb4be', '#5e626a'] });
    const avoid = [{ x: 0, z: 0, r: 10 }, { x: 40, z: -30, r: 8 }];
    const rocks = scatterRocks(terrain, 11, '#8c9098', 80, avoid);
    const cols = rockColliders(rocks);
    expect(cols.length).toBe(80);
    for (let i = 0; i < cols.length; i++) {
      for (const a of avoid) {
        expect(Math.hypot(cols[i].x - a.x, cols[i].z - a.z)).toBeGreaterThanOrEqual(a.r);
      }
      for (let j = i + 1; j < cols.length; j++) {
        const dist = Math.hypot(cols[i].x - cols[j].x, cols[i].z - cols[j].z);
        expect(dist).toBeGreaterThanOrEqual(cols[i].r + cols[j].r);
      }
    }
  });
});
