import * as THREE from 'three';
import { LOADING_UI } from './strings';
import { EARTH_TEXTURE, earthMasks } from '../gen/earthMap';
import { explosionTextures } from '../gen/explosion';
import { softPuffTexture } from '../gen/effects';
import { meteorTextures } from '../gen/meteors';
import { planetCanvasTexture, ringCanvasTexture, seedPlanetTexture, seedRingTexture } from '../gen/planets';
import { PLANET_KEYS, type PlanetKey } from '../gen/planetTextures';
import { natureTextures, seedNatureTextures } from '../gen/natureTexture';
import { seedSurfaceTextures, surfaceTextures } from '../gen/terrainTexture';
import type { WorkerOutMessage } from './preloadWorker';

/** Satu langkah pemuatan awal: `weight` menentukan porsi bar progres. */
export interface PreloadStep { label: string; weight: number; run: () => unknown }

export type ProgressFn = (fraction01: number, label: string) => void;

/** Beri kesempatan browser menggambar bilah progres di antara langkah berat. */
export const nextFrame = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

/**
 * Jalankan langkah berurutan; kegagalan satu langkah tidak menghentikan yang lain (dikembalikan sebagai daftar galat).
 * Murni terhadap DOM: `yieldFrame` dapat diganti pada pengujian.
 */
export async function runPreload(steps: readonly PreloadStep[], onProgress: ProgressFn, yieldFrame: () => Promise<void> = nextFrame): Promise<Error[]> {
  const total = steps.reduce((t, s) => t + s.weight, 0) || 1;
  const errors: Error[] = [];
  let done = 0;
  onProgress(0, steps[0]?.label ?? LOADING_UI.done);
  await yieldFrame();
  for (const step of steps) {
    onProgress(done / total, step.label);
    await yieldFrame();
    try {
      await step.run();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
    done += step.weight;
  }
  onProgress(1, LOADING_UI.done);
  await yieldFrame();
  return errors;
}

/** Unggah tekstur ke GPU sekarang (bukan saat frame pertama yang memakainya) agar scene tidak tersendat. */
function upload(renderer: THREE.WebGLRenderer, textures: readonly THREE.Texture[]): void {
  for (const t of textures) renderer.initTexture(t);
}

/** Langkah sinkron cadangan bila Web Worker tidak tersedia. */
function buildSyncPreloadSteps(renderer: THREE.WebGLRenderer): PreloadStep[] {
  const steps: PreloadStep[] = [
    { label: LOADING_UI.steps.earthMap, weight: 3, run: () => { earthMasks(EARTH_TEXTURE.width, EARTH_TEXTURE.height); } },
  ];
  for (const key of PLANET_KEYS) {
    steps.push({
      label: `${LOADING_UI.planetLabel}: ${LOADING_UI.planets[key] ?? key}`,
      weight: key === 'earth' ? 3 : 1,
      run: () => upload(renderer, [planetCanvasTexture(key as PlanetKey)]),
    });
  }
  steps.push(
    { label: LOADING_UI.steps.ring, weight: 1, run: () => upload(renderer, [ringCanvasTexture()]) },
    { label: LOADING_UI.steps.nature, weight: 2, run: () => { const t = natureTextures(); upload(renderer, [t.ground, t.water, t.concrete]); } },
    { label: LOADING_UI.steps.moonSurface, weight: 2, run: () => { const t = surfaceTextures('moon'); upload(renderer, [t.map, t.bump]); } },
    { label: LOADING_UI.steps.marsSurface, weight: 2, run: () => { const t = surfaceTextures('mars'); upload(renderer, [t.map, t.bump]); } },
    {
      label: LOADING_UI.steps.fx,
      weight: 1,
      run: () => upload(renderer, [...explosionTextures(), ...meteorTextures(), softPuffTexture()]),
    },
  );
  return steps;
}

/**
 * Daftar pemuatan awal: semua tekstur prosedural yang berat (peta Bumi dari data geografi, planet, permukaan
 * Bulan/Mars, efek) dihitung di Web Worker lalu diunggah ke GPU satu langkah per frame agar layar memuat tetap mulus.
 */
export function buildPreloadSteps(renderer: THREE.WebGLRenderer): PreloadStep[] {
  if (typeof Worker === 'undefined') return buildSyncPreloadSteps(renderer);

  let worker: Worker;
  try {
    worker = new Worker(new URL('./preloadWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return buildSyncPreloadSteps(renderer);
  }

  const results = new Map<string, WorkerOutMessage>();
  const waiters = new Map<string, { resolve: (m: WorkerOutMessage) => void; reject: (e: Error) => void }>();
  let workerFailed: Error | null = null;
  const natureBuffers: Partial<Record<'ground' | 'water' | 'concrete', Uint8ClampedArray>> = {};

  const settle = (id: string, msg: WorkerOutMessage): void => {
    const w = waiters.get(id);
    if (w) {
      waiters.delete(id);
      if (msg.type === 'error') w.reject(new Error(msg.message));
      else w.resolve(msg);
    } else {
      results.set(id, msg);
    }
  };

  worker.addEventListener('message', (ev: MessageEvent<WorkerOutMessage>) => {
    const msg = ev.data;
    if (msg.type === 'done') {
      worker.terminate();
      return;
    }
    settle(msg.id, msg);
  });

  worker.addEventListener('error', (ev) => {
    workerFailed = new Error(ev.message || 'Worker pemuatan gagal');
    worker.terminate();
    for (const [, w] of waiters) w.reject(workerFailed);
    waiters.clear();
  });

  worker.postMessage('start');

  const awaitId = (id: string, fallback: () => void): Promise<WorkerOutMessage | null> => {
    const existing = results.get(id);
    if (existing) {
      results.delete(id);
      if (existing.type === 'error') return Promise.reject(new Error(existing.message));
      return Promise.resolve(existing);
    }
    if (workerFailed) {
      fallback();
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      waiters.set(id, {
        resolve,
        reject: (err) => {
          if (workerFailed) {
            try { fallback(); resolve(null); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
          } else {
            reject(err);
          }
        },
      });
    });
  };

  const steps: PreloadStep[] = [
    {
      label: LOADING_UI.steps.earthMap,
      weight: 3,
      run: async () => {
        await awaitId('earthMasks', () => { earthMasks(EARTH_TEXTURE.width, EARTH_TEXTURE.height); });
      },
    },
  ];

  for (const key of PLANET_KEYS) {
    steps.push({
      label: `${LOADING_UI.planetLabel}: ${LOADING_UI.planets[key] ?? key}`,
      weight: key === 'earth' ? 3 : 1,
      run: async () => {
        const msg = await awaitId(`planet:${key}`, () => upload(renderer, [planetCanvasTexture(key)]));
        if (msg?.type === 'planet') {
          const tex = seedPlanetTexture(msg.key, {
            width: msg.width,
            height: msg.height,
            data: new Uint8ClampedArray(msg.buffer),
          });
          upload(renderer, [tex]);
        }
      },
    });
  }

  steps.push(
    {
      label: LOADING_UI.steps.ring,
      weight: 1,
      run: async () => {
        const msg = await awaitId('ring', () => upload(renderer, [ringCanvasTexture()]));
        if (msg?.type === 'ring') {
          const tex = seedRingTexture({
            width: msg.width,
            height: msg.height,
            data: new Uint8ClampedArray(msg.buffer),
          });
          upload(renderer, [tex]);
        }
      },
    },
    {
      label: LOADING_UI.steps.nature,
      weight: 0.7,
      run: async () => {
        const msg = await awaitId('nature:ground', () => undefined);
        if (msg?.type === 'nature') natureBuffers.ground = new Uint8ClampedArray(msg.buffer);
      },
    },
    {
      label: LOADING_UI.steps.nature,
      weight: 0.7,
      run: async () => {
        const msg = await awaitId('nature:water', () => undefined);
        if (msg?.type === 'nature') natureBuffers.water = new Uint8ClampedArray(msg.buffer);
      },
    },
    {
      label: LOADING_UI.steps.nature,
      weight: 0.6,
      run: async () => {
        const msg = await awaitId('nature:concrete', () => undefined);
        if (msg?.type === 'nature') natureBuffers.concrete = new Uint8ClampedArray(msg.buffer);
        const t = natureBuffers.ground && natureBuffers.water && natureBuffers.concrete
          ? seedNatureTextures({ ground: natureBuffers.ground, water: natureBuffers.water, concrete: natureBuffers.concrete })
          : natureTextures();
        upload(renderer, [t.ground, t.water, t.concrete]);
      },
    },
    {
      label: LOADING_UI.steps.moonSurface,
      weight: 2,
      run: async () => {
        const msg = await awaitId('surface:moon', () => upload(renderer, Object.values(surfaceTextures('moon'))));
        if (msg?.type === 'surface') {
          const t = seedSurfaceTextures('moon', {
            size: msg.size,
            albedo: new Uint8ClampedArray(msg.albedoBuffer),
            height: new Uint8ClampedArray(msg.heightBuffer),
          });
          upload(renderer, [t.map, t.bump]);
        }
      },
    },
    {
      label: LOADING_UI.steps.marsSurface,
      weight: 2,
      run: async () => {
        const msg = await awaitId('surface:mars', () => upload(renderer, Object.values(surfaceTextures('mars'))));
        if (msg?.type === 'surface') {
          const t = seedSurfaceTextures('mars', {
            size: msg.size,
            albedo: new Uint8ClampedArray(msg.albedoBuffer),
            height: new Uint8ClampedArray(msg.heightBuffer),
          });
          upload(renderer, [t.map, t.bump]);
        }
      },
    },
    {
      label: LOADING_UI.steps.fx,
      weight: 1,
      run: () => upload(renderer, [...explosionTextures(), ...meteorTextures(), softPuffTexture()]),
    },
  );

  return steps;
}
