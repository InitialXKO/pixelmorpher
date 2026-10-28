// 节拍模板探针：8 类模板齐备、切分覆盖/连续/不重叠、权重单调性、
// 小窗降级、loop 口径、确定性（同入参同结果）。
import { BEAT_TEMPLATES, beatFrameTags, getBeatTemplate } from '../src/lib/beat-templates';

let pass = 0, fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) { pass++; } else { fail++; console.error('FAIL', label); }
}

// 1. 八类模板齐备且 id 唯一、权重为正整数
ok(BEAT_TEMPLATES.length === 8, 'templates == 8');
ok(new Set(BEAT_TEMPLATES.map(t => t.id)).size === 8, 'ids unique');
for (const t of BEAT_TEMPLATES) {
  ok(t.beats.length >= 3, `${t.id} beats >= 3`);
  ok(t.beats.every(b => Number.isInteger(b.weight) && b.weight > 0), `${t.id} weights positive int`);
  ok(getBeatTemplate(t.id) === t, `${t.id} lookup`);
}
// 循环口径：idle/walk 循环，其余一次性
ok(getBeatTemplate('idle')!.loop === true && getBeatTemplate('walk')!.loop === true, 'idle/walk loop');
ok(['attack', 'block', 'hit', 'death', 'born', 'skill'].every(id => getBeatTemplate(id)!.loop === false), 'others once');

// 2. 切分不变量：在多种窗长下覆盖整窗、连续、无重叠、每标签 ≥1 帧
let seq = 0;
const idGen = () => `t${seq++}`;
for (const t of BEAT_TEMPLATES) {
  for (const total of [1, 2, 3, 5, 8, 13, 24, 60, 61]) {
    seq = 0;
    const tags = beatFrameTags(10, 10 + total - 1, t, idGen);
    ok(tags.length >= 1, `${t.id}/${total} has tags`);
    ok(tags[0].startFrame === 10, `${t.id}/${total} starts at window start`);
    ok(tags[tags.length - 1].endFrame === 10 + total - 1, `${t.id}/${total} ends at window end`);
    for (let i = 0; i < tags.length; i++) {
      ok(tags[i].endFrame >= tags[i].startFrame, `${t.id}/${total} tag ${i} non-empty`);
      if (i > 0) ok(tags[i].startFrame === tags[i - 1].endFrame + 1, `${t.id}/${total} tag ${i} contiguous`);
    }
    if (total >= t.beats.length) ok(tags.length === t.beats.length, `${t.id}/${total} all beats present`);
    // 标签 loop 与模板一致
    ok(tags.every(tag => tag.loop === (t.loop ? 'loop' : 'once')), `${t.id}/${total} tag loop matches`);
    ok(tags.every(tag => tag.direction === 'forward'), `${t.id}/${total} direction forward`);
  }
}

// 3. 权重单调性：24 帧攻击模板里，权重大的节拍帧数不小于权重小的
{
  const t = getBeatTemplate('attack')!;
  const tags = beatFrameTags(0, 23, t, idGen);
  const len = (name: string) => { const tag = tags.find(x => x.name === name)!; return tag.endFrame - tag.startFrame + 1; };
  ok(len('防备') === len('预备') && len('预备') > len('加速'), 'attack weights monotone at 24f');
  ok(len('接触') === len('加速'), 'attack equal weights equal frames');
}

// 4. 确定性：同入参（同 idGen 序列）两次结果逐字一致
{
  let a = 0, b = 0;
  const t = getBeatTemplate('walk')!;
  const r1 = beatFrameTags(3, 40, t, () => `x${a++}`);
  const r2 = beatFrameTags(3, 40, t, () => `x${b++}`);
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'deterministic');
}

// 5. 空窗与非法窗
ok(beatFrameTags(5, 4, BEAT_TEMPLATES[0], idGen).length === 0, 'empty window -> no tags');

console.log(`beat-templates probe: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
