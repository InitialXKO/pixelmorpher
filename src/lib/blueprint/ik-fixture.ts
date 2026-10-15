/**
 * IK Test Fixture.
 *
 * Verifies IK solvers produce correct end-effector positions.
 * Run with: npx tsx src/lib/blueprint/ik-fixture.ts
 *
 * A fixture defines a kinematic chain and target positions,
 * then checks that FK( IK(target) ) ≈ target.
 */
import { solveIK2Bone, solveIKFabrik } from './ik';

interface FixtureCase {
  name: string;
  targetX: number;
  targetY: number;
  expectReachable: boolean;
}

/** Forward kinematics for 2-bone chain. Returns end effector position. */
function fk2Bone(
  baseX: number,
  baseY: number,
  len1: number,
  len2: number,
  angle1Deg: number,
  angle2Deg: number,
): { x: number; y: number } {
  const a1 = (angle1Deg * Math.PI) / 180;
  const a2 = ((angle1Deg + angle2Deg) * Math.PI) / 180;
  const jx = baseX + Math.cos(a1) * len1;
  const jy = baseY + Math.sin(a1) * len1;
  return {
    x: jx + Math.cos(a2) * len2,
    y: jy + Math.sin(a2) * len2,
  };
}

/** Forward kinematics for N-bone chain. Returns end effector position. */
function fkChain(
  baseX: number,
  baseY: number,
  lengths: number[],
  anglesDeg: number[],
): { x: number; y: number } {
  let x = baseX;
  let y = baseY;
  for (let i = 0; i < lengths.length; i++) {
    const a = (anglesDeg[i] * Math.PI) / 180;
    x += Math.cos(a) * lengths[i];
    y += Math.sin(a) * lengths[i];
  }
  return { x, y };
}

function run2BoneFixture(): boolean {
  console.log('=== 2-Bone IK Fixture ===');
  const len1 = 50;
  const len2 = 40;
  const baseX = 0;
  const baseY = 0;

  const cases: FixtureCase[] = [
    { name: '直角目标', targetX: 50, targetY: 40, expectReachable: true },
    { name: '正前方', targetX: 90, targetY: 0, expectReachable: true },
    { name: '最大伸展', targetX: 90, targetY: 0, expectReachable: true },
    { name: '超距目标', targetX: 120, targetY: 0, expectReachable: false },
    { name: '近身目标', targetX: 5, targetY: 0, expectReachable: false },
    { name: '后方目标', targetX: -30, targetY: 30, expectReachable: true },
    { name: '负Y目标', targetX: 40, targetY: -30, expectReachable: true },
  ];

  let passed = 0;
  for (const c of cases) {
    const out = solveIK2Bone({
      targetX: c.targetX,
      targetY: c.targetY,
      len1,
      len2,
      baseX,
      baseY,
    });

    const eff = fk2Bone(baseX, baseY, len1, len2, out.angle1, out.angle2);
    const err = Math.hypot(eff.x - c.targetX, eff.y - c.targetY);

    // For reachable targets, end effector should match (tolerance 0.01px).
    // For unreachable, it should be at max extension toward target.
    let ok: boolean;
    if (c.expectReachable) {
      ok = err < 0.01 && out.reachable;
    } else {
      // Unreachable: check arm is fully extended (dist from base = len1+len2 or minReach)
      const baseDist = Math.hypot(eff.x - baseX, eff.y - baseY);
      const expectedDist =
        Math.hypot(c.targetX - baseX, c.targetY - baseY) > len1 + len2
          ? len1 + len2
          : Math.abs(len1 - len2);
      ok = Math.abs(baseDist - expectedDist) < 0.01 && !out.reachable;
    }

    console.log(
      `  ${ok ? '✓' : '✗'} ${c.name}: target=(${c.targetX},${c.targetY}) ` +
        `angles=(${out.angle1.toFixed(1)}°,${out.angle2.toFixed(1)}°) ` +
        `eff=(${eff.x.toFixed(2)},${eff.y.toFixed(2)}) err=${err.toFixed(3)} ` +
        `reachable=${out.reachable}`,
    );
    if (ok) passed++;
  }

  console.log(`  ${passed}/${cases.length} passed\n`);
  return passed === cases.length;
}

function runFabrikFixture(): boolean {
  console.log('=== FABRIK IK Fixture ===');
  const lengths = [40, 30, 20];
  const baseX = 0;
  const baseY = 0;

  const cases: FixtureCase[] = [
    { name: '三节直角', targetX: 50, targetY: 40, expectReachable: true },
    { name: '三节伸展', targetX: 85, targetY: 10, expectReachable: true },
    { name: '超距', targetX: 120, targetY: 0, expectReachable: false },
    { name: '折叠目标', targetX: 10, targetY: 5, expectReachable: true },
  ];

  let passed = 0;
  for (const c of cases) {
    const out = solveIKFabrik({
      targetX: c.targetX,
      targetY: c.targetY,
      lengths,
      baseX,
      baseY,
      iterations: 20,
    });

    const eff = fkChain(baseX, baseY, lengths, out.angles);
    const err = Math.hypot(eff.x - c.targetX, eff.y - c.targetY);

    let ok: boolean;
    if (c.expectReachable) {
      ok = err < 1.0 && out.converged;
    } else {
      ok = !out.converged;
    }

    console.log(
      `  ${ok ? '✓' : '✗'} ${c.name}: target=(${c.targetX},${c.targetY}) ` +
        `angles=[${out.angles.map((a) => a.toFixed(1)).join(',')}] ` +
        `err=${err.toFixed(3)} converged=${out.converged}`,
    );
    if (ok) passed++;
  }

  console.log(`  ${passed}/${cases.length} passed\n`);
  return passed === cases.length;
}

// Run when executed directly
const ok2 = run2BoneFixture();
const okF = runFabrikFixture();

if (ok2 && okF) {
  console.log('All IK fixtures passed.');
  process.exit(0);
} else {
  console.log('IK fixture FAILED.');
  process.exit(1);
}
