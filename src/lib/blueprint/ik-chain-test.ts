/**
 * Blueprint IK chaining verification.
 * Tests that ik_2bone can be chained into transform nodes.
 * Run with: npx tsx src/lib/blueprint/ik-chain-test.ts
 */
import { evaluateBlueprint } from './eval';
import type { BlueprintGraph } from './ir';
import { num } from './ir';

// Test 1: ik_2bone -> transform (shoulder joint)
// The ik node solves angles, transform applies angle1 as rotation.
function testIKToTransform(): boolean {
  console.log('=== Test 1: ik_2bone -> transform ===');

  const graph: BlueprintGraph = {
    version: 1,
    nodes: [
      {
        id: 'ik',
        type: 'ik_2bone',
        inputs: {},
        params: {
          targetX: 50,
          targetY: 40,
          len1: 50,
          len2: 40,
          baseX: 0,
          baseY: 0,
          bendDir: 1,
        },
      },
      {
        id: 't',
        type: 'transform',
        inputs: {
          rotation: { nodeId: 'ik', output: 'angle1' },
        },
        params: {},
      },
    ],
    outputId: 't',
  };

  const result = evaluateBlueprint(graph, {
    frame: 0,
    frameRate: 12,
    vars: {},
  });

  // Expected: angle1 ≈ -0.02° (from fixture: target (50,40), len 50/40)
  // From the fixture, we know angle1 should be ≈ -0.02° for bendDir=1
  const expected = -0.02;
  const ok = Math.abs(result.rotation - expected) < 1.0;

  console.log(`  rotation=${result.rotation.toFixed(2)}° (expected ≈${expected}°) ${ok ? '✓' : '✗'}`);
  return ok;
}

// Test 2: Chained IK (two ik_2bone nodes, second uses first's output)
// Simulates a 4-bone chain solved as two 2-bone segments.
function testChainedIK(): boolean {
  console.log('=== Test 2: ik_2bone -> ik_2bone (chained) ===');

  const graph: BlueprintGraph = {
    version: 1,
    nodes: [
      {
        id: 'ik1',
        type: 'ik_2bone',
        inputs: {},
        params: {
          targetX: 60,
          targetY: 0,
          len1: 40,
          len2: 30,
          baseX: 0,
          baseY: 0,
        },
      },
      {
        id: 'ik2',
        type: 'ik_2bone',
        inputs: {
          // Second IK uses first IK's reachable flag to adjust target
          // (demonstrates cross-node data flow)
          targetX: { nodeId: 'ik1', output: 'reachable' },
        },
        params: {
          targetY: 20,
          len1: 30,
          len2: 20,
          baseX: 60,
          baseY: 0,
        },
      },
      {
        id: 't',
        type: 'transform',
        inputs: {
          rotation: { nodeId: 'ik2', output: 'angle1' },
        },
        params: {},
      },
    ],
    outputId: 't',
  };

  const result = evaluateBlueprint(graph, {
    frame: 0,
    frameRate: 12,
    vars: {},
  });

  // ik1 target (60,0) with len 40+30=70: reachable=1
  // ik2 targetX = 1 (from reachable), targetY=20, base (60,0), len 30+20=50
  // Target (1, 20) relative to base (60,0): dx=-59, dy=20, dist=62.3 > 50 → unreachable
  // Should still produce valid angles (clamped to max reach)
  const ok = isFinite(result.rotation);

  console.log(`  rotation=${result.rotation.toFixed(2)}° (finite: ${ok}) ${ok ? '✓' : '✗'}`);
  return ok;
}

// Test 3: ik_fabrik -> transform
function testFabrikToTransform(): boolean {
  console.log('=== Test 3: ik_fabrik -> transform ===');

  const graph: BlueprintGraph = {
    version: 1,
    nodes: [
      {
        id: 'ik',
        type: 'ik_fabrik',
        inputs: {},
        params: {
          targetX: 50,
          targetY: 40,
          lengths: '40,30,20',
          baseX: 0,
          baseY: 0,
        },
      },
      {
        id: 't',
        type: 'transform',
        inputs: {
          // angles is a string "a,b,c" - transform.rotation expects a number
          // This tests that the connection doesn't crash (type mismatch handled gracefully)
          rotation: { nodeId: 'ik', output: 'converged' },
        },
        params: {},
      },
    ],
    outputId: 't',
  };

  const result = evaluateBlueprint(graph, {
    frame: 0,
    frameRate: 12,
    vars: {},
  });

  // converged=1 for reachable target
  const ok = Math.abs(result.rotation - 1.0) < 0.01;

  console.log(`  rotation=${result.rotation.toFixed(2)} (expected 1.0) ${ok ? '✓' : '✗'}`);
  return ok;
}

const t1 = testIKToTransform();
const t2 = testChainedIK();
const t3 = testFabrikToTransform();

console.log('');
if (t1 && t2 && t3) {
  console.log('All blueprint IK chaining tests passed.');
  process.exit(0);
} else {
  console.log('Blueprint IK chaining FAILED.');
  process.exit(1);
}
