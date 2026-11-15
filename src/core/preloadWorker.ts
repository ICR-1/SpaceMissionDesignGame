import { EARTH_TEXTURE, earthMasks } from '../gen/earthMap';
import { generateConcreteMap, generateGroundMap, generateWaterMap } from '../gen/natureTexture';
import { PLANET_KEYS, planetTexture, ringTextureData, type PlanetKey } from '../gen/planetTextures';
import { generateSurfaceMaps, type SurfaceKind } from '../gen/terrainTexture';

export type WorkerOutMessage =
  | { type: 'step'; id: string }
  | { type: 'planet'; id: string; key: PlanetKey; width: number; height: number; buffer: ArrayBuffer }
  | { type: 'ring'; id: string; width: number; height: number; buffer: ArrayBuffer }
  | { type: 'nature'; id: string; part: 'ground' | 'water' | 'concrete'; buffer: ArrayBuffer }
  | { type: 'surface'; id: string; kind: SurfaceKind; size: number; albedoBuffer: ArrayBuffer; heightBuffer: ArrayBuffer }
  | { type: 'error'; id: string; message: string }
  | { type: 'done' };

interface WorkerScope {
  postMessage(message: WorkerOutMessage, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

function postError(id: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  scope.postMessage({ type: 'error', id, message });
}

function runAll(): void {
  try {
    earthMasks(EARTH_TEXTURE.width, EARTH_TEXTURE.height);
    scope.postMessage({ type: 'step', id: 'earthMasks' });
  } catch (e) {
    postError('earthMasks', e);
  }

  for (const key of PLANET_KEYS) {
    const id = `planet:${key}`;
    try {
      const tex = planetTexture(key);
      const copy = new Uint8ClampedArray(tex.data);
      scope.postMessage(
        { type: 'planet', id, key, width: tex.width, height: tex.height, buffer: copy.buffer },
        [copy.buffer],
      );
    } catch (e) {
      postError(id, e);
    }
  }

  try {
    const ring = ringTextureData();
    const copy = new Uint8ClampedArray(ring.data);
    scope.postMessage(
      { type: 'ring', id: 'ring', width: ring.width, height: ring.height, buffer: copy.buffer },
      [copy.buffer],
    );
  } catch (e) {
    postError('ring', e);
  }

  const natureParts: readonly ['ground' | 'water' | 'concrete', () => Uint8ClampedArray][] = [
    ['ground', () => generateGroundMap()],
    ['water', () => generateWaterMap()],
    ['concrete', () => generateConcreteMap()],
  ];
  for (const [part, make] of natureParts) {
    const id = `nature:${part}`;
    try {
      const data = make();
      scope.postMessage({ type: 'nature', id, part, buffer: data.buffer as ArrayBuffer }, [data.buffer as ArrayBuffer]);
    } catch (e) {
      postError(id, e);
    }
  }

  for (const kind of ['moon', 'mars'] as const) {
    const id = `surface:${kind}`;
    try {
      const maps = generateSurfaceMaps(kind);
      const albedoBuf = maps.albedo.buffer as ArrayBuffer;
      const heightBuf = maps.height.buffer as ArrayBuffer;
      scope.postMessage(
        { type: 'surface', id, kind, size: maps.size, albedoBuffer: albedoBuf, heightBuffer: heightBuf },
        [albedoBuf, heightBuf],
      );
    } catch (e) {
      postError(id, e);
    }
  }

  scope.postMessage({ type: 'done' });
}

self.addEventListener('message', (ev: MessageEvent) => {
  if (ev.data === 'start') runAll();
});
