// 头部 IR 自枚举审计（防漏二号关）：以 headIR 返回的节点列为源，
// 对每个头规格实际画出的全部件逐件给判定（有见证／发明／未读）。
// 件的身份来自 headIR 的 src 溯源标记（engine.ts stepSrc），不许
// 按坐标猜件。判定表在 ./head-verdicts.ts；表里没有的件按未读处理。
// 退出码：有未读件或无 src 的件 → 1（不许关轮）；发明件只警告、
// 列入报告交代去处。用法：bun scripts/audit-head-ir.mts
// 范围：四个头条目（人形整机的头即这四个头规格的引用，不重复枚举）。
import { BUILTIN_ENTRIES, libraryIndexOf, mechaDefOf } from '../src/lib/library-entries.ts';
import { headIR } from '../src/lib/mecha/engine.ts';
import { mechaHeadSpecOf } from '../src/lib/mecha/parts.ts';
import { HEAD_VERDICTS } from './head-verdicts.ts';

const HEADS = ['mecha-head-olive', 'mecha-head-agile', 'mecha-head-powersuit', 'mecha-head-agile-finbrow'] as const;

const index = libraryIndexOf(BUILTIN_ENTRIES);

/** 头规格解析（与渲染同路）：基线条目直接取 spec.head；覆写派生
 * 条目（眉鳍）按 generateMechaPartSet 的合并口径拼（form 深合并） */
function headSpecOf(id: string): any {
  const e = index.get(id) as any;
  if (e.versions?.['1']?.spec?.head) return e.versions['1'].spec.head;
  const got = mechaDefOf(index, id, 1) as any;
  const def = got.def;
  const base = mechaHeadSpecOf(def.family);
  const ov = def.overrides?.head ?? {};
  return { ...base, ...ov, blockShape: { ...(base.blockShape ?? {}), ...(ov.blockShape ?? {}) }, form: { ...base.form, ...(ov.form ?? {}) } };
}

let partsTotal = 0, invented = 0, unread = 0, noSrc = 0;
const keysSeen = new Set<string>();
const problems: string[] = [];
for (const id of HEADS) {
  const spec = headSpecOf(id);
  const ir = headIR(spec);
  const family = spec.family as string;
  const bySrc = new Map<string, number>();
  for (const p of ir.parts as any[]) {
    partsTotal++;
    if (!p.src) { noSrc++; problems.push(`${id} #? ${p.t} 无 src`); continue; }
    bySrc.set(p.src, (bySrc.get(p.src) ?? 0) + 1);
  }
  console.log(`== ${id}（族 ${family}）${ir.parts.length} 件`);
  for (const [src, n] of [...bySrc.entries()].sort()) {
    const key = `${family}:${src}`;
    const vd = HEAD_VERDICTS[key];
    keysSeen.add(key);
    if (!vd || vd.v === 'unread') {
      unread++;
      problems.push(`${id} ${src} x${n} 未读（判定表无此键）`);
      console.log(`  ✗ ${src} x${n} 未读`);
    } else if (vd.v === 'invented') {
      invented++;
      console.log(`  ! ${src} x${n} 发明：${vd.w ?? ''}`);
    } else {
      console.log(`  ✓ ${src} x${n} ${vd.w ?? ''}`);
    }
  }
}
console.log(`合计：${keysSeen.size} 个不重复（族，构造）键 / ${partsTotal} 件；发明 ${invented} 键；未读 ${unread} 键；无 src ${noSrc} 件`);
if (unread > 0 || noSrc > 0) {
  console.log('关轮不许：有未读件——先读参考补判定，再关轮。');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
if (invented > 0) console.log('提醒：有发明件在产品里，关轮报告须交代去处。');
