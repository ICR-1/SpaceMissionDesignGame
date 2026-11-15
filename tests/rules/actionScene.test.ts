import { describe, expect, it } from 'vitest';
import {
  findBestCover,
  flightActionCameraOffset,
  nearCoverRock,
  planSurfaceAction,
  stepSprintToCover,
  type CoverObstacle,
} from '../../src/rules/actionScene';

const ROCKS: CoverObstacle[] = [
  { x: 10, z: 4, r: 1.4, kind: 'rock' },
  { x: -18, z: -12, r: 2.0, kind: 'rock' },
  { x: 6, z: 3, r: 0.3, kind: 'rock' }, // terlalu kecil untuk bersembunyi
  { x: 0, z: 0, r: 4.0, kind: 'hub' },
];

describe('koreografi adegan aksi permukaan', () => {
  it('memilih batu besar terdekat dan menempatkan titik berlindung di sisi berlawanan dari bahaya', () => {
    const player = { x: 8, z: 5 };
    const hazard = { x: 24, z: 4 }; // bahaya datang dari +x
    const cover = findBestCover(player, ROCKS, hazard);
    expect(cover).not.toBeNull();
    expect(cover!.x).toBe(10); // mengabaikan kerikil r = 0.3

    const plan = planSurfaceAction('meteors', player, ROCKS, hazard);
    expect(plan.pose).toBe('cover');
    expect(plan.sprint).toBe(true);
    // Titik sembunyi harus berada di sisi -x batu (lebih jauh dari bahaya dibanding pusat batu)
    const rockToHazard = Math.hypot(cover!.x - hazard.x, cover!.z - hazard.z);
    const spotToHazard = Math.hypot(plan.coverX - hazard.x, plan.coverZ - hazard.z);
    expect(spotToHazard).toBeGreaterThan(rockToHazard + cover!.r * 0.8);
    expect(Math.hypot(plan.coverX - cover!.x, plan.coverZ - cover!.z)).toBeGreaterThan(cover!.r);
  });

  it('badai debu dan dust devil memakai pose brace, panel debu memakai inspect, konjungsi memakai comms', () => {
    const player = { x: 8, z: 5 };
    const hazard = { x: 20, z: 12 };
    expect(planSurfaceAction('storm', player, ROCKS, hazard).pose).toBe('brace');
    expect(planSurfaceAction('devil', player, ROCKS, hazard).pose).toBe('brace');
    expect(planSurfaceAction('dustPanels', player, ROCKS, hazard).pose).toBe('inspect');
    const comms = planSurfaceAction('conjunction', player, ROCKS, hazard, 0.7);
    expect(comms.pose).toBe('comms');
    expect(comms.sprint).toBe(false);
  });

  it('stepSprintToCover berlari hingga tiba dan menghadap ke arah bahaya', () => {
    let cur = { x: 0, z: 0, yaw: 0 };
    const target = { x: 6, z: 0, peekYaw: 1.2 };
    for (let i = 0; i < 60; i++) {
      const next = stepSprintToCover(cur, target, 5, 0.05);
      cur = { x: next.x, z: next.z, yaw: next.yaw };
      if (next.arrived) {
        expect(next.yaw).toBeCloseTo(1.2, 6);
        expect(next.speed01).toBe(0);
        break;
      }
    }
    expect(Math.hypot(cur.x - target.x, cur.z - target.z)).toBeLessThan(0.3);
  });

  it('nearCoverRock mengenali batu pelindung dekat dan mengabaikan hub maupun kerikil', () => {
    expect(nearCoverRock({ x: 12.2, z: 4 }, ROCKS)?.x).toBe(10);
    expect(nearCoverRock({ x: 4.2, z: 0 }, ROCKS)).toBeNull(); // hub bukan batu
    expect(nearCoverRock({ x: 6.2, z: 3 }, ROCKS)).toBeNull(); // kerikil terlalu kecil
  });

  it('flightActionCameraOffset nol di tepi waktu dan memberi gerak sinematik di tengah adegan', () => {
    expect(flightActionCameraOffset('flyby', 0, 3)).toEqual({ dx: 0, dy: 0, dz: 0, rollRad: 0, zoomScale: 1 });
    const mid = flightActionCameraOffset('flyby', 1.5, 3);
    expect(mid.zoomScale).toBeLessThan(1);
    expect(Math.abs(mid.dy) + Math.abs(mid.dz)).toBeGreaterThan(1);
    expect(flightActionCameraOffset('engine', 1.5, 3).rollRad).not.toBe(0);
  });
});
