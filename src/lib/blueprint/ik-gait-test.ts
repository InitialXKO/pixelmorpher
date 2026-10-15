/**
 * Gait + IK chaining verification.
 * Simulates: gait (foot trajectory) -> ik_2bone (leg angles) -> transform
 * Run with: npx tsx src/lib/blueprint/ik-gait-test.ts
 */
import { evaluateBlueprint } from './eval';
import type { BlueprintGraph } from './ir';

/**
 * Leg setup:
 * - Hip at (0, 0), thigh len 30, shin len 30
 * - Gait generates foot target trajectory
 * - IK solves hip/knee angles
 */
function testGaitIKChain(): boolean {
  console.log('=== Gait -> IK -> Transform (leg) ===');

  // Simulate 4 frames of a walk cycle
  const frames = [0, 6, 12, 18];
  let allOk = true;

  for (const frame of frames) {
    // Hip blueprint: gait -> ik_2bone -> transform
    const hipGraph: BlueprintGraph = {
      version: 1,
      nodes: [
        {
          id: 'gait',
          type: 'gait',
          inputs: {},
          params: {
            period: 24,
            strideLength: 20,
            liftHeight: 12,
          },
        },
        {
          id: 'ik',
          type: 'ik_2bone',
          inputs: {
            // Foot target = gait output (relative to hip)
            targetX: { nodeId: 'gait', output: 'outX' },
            targetY: { nodeId: 'gait', output: 'outY' },
          },
          params: {
            len1: 30,  // thigh
            len2: 30,  // shin
            baseX: 0,
            baseY: 0,
            bendDir: 1,  // knee bends forward
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

    const hipResult = evaluateBlueprint(hipGraph, {
      frame,
      frameRate: 12,
      vars: {},
    });

    // Knee blueprint: uses ik's angle2
    // (in practice, this would be a separate node blueprint referencing the same ik node,
    // or the ik node would be in a shared graph)
    const kneeGraph: BlueprintGraph = {
      version: 1,
      nodes: [
        {
          id: 'gait',
          type: 'gait',
          inputs: {},
          params: {
            period: 24,
            strideLength: 20,
            liftHeight: 12,
          },
        },
        {
          id: 'ik',
          type: 'ik_2bone',
          inputs: {
            targetX: { nodeId: 'gait', output: 'outX' },
            targetY: { nodeId: 'gait', output: 'outY' },
          },
          params: {
            len1: 30,
            len2: 30,
            baseX: 0,
            baseY: 0,
            bendDir: 1,
          },
        },
        {
          id: 't',
          type: 'transform',
          inputs: {
            rotation: { nodeId: 'ik', output: 'angle2' },
          },
          params: {},
        },
      ],
      outputId: 't',
    };

    const kneeResult = evaluateBlueprint(kneeGraph, {
      frame,
      frameRate: 12,
      vars: {},
    });

    const hipOk = isFinite(hipResult.rotation);
    const kneeOk = isFinite(kneeResult.rotation);
    const ok = hipOk && kneeOk;

    console.log(
      `  frame ${frame}: hip=${hipResult.rotation.toFixed(1)}° ` +
      `knee=${kneeResult.rotation.toFixed(1)}° ${ok ? '✓' : '✗'}`
    );
    if (!ok) allOk = false;
  }

  return allOk;
}

const ok = testGaitIKChain();
console.log('');
if (ok) {
  console.log('Gait+IK chaining works.');
  process.exit(0);
} else {
  console.log('Gait+IK chaining FAILED.');
  process.exit(1);
}
