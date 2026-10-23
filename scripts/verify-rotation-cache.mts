// 旋转缓存键探针：全图哈希必须对任意单像素变化敏感（旧 5 点采样指纹的反例），
// 且 getRotationCacheKey 在给出 contentHash 时必须以它区分内容相同尺寸的图。
import { hashPixelGrid, getRotationCacheKey, createPixelGridHasher } from '../src/lib/engine/render-cache';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// 8×8 精灵：四角与中心都是透明——旧指纹对下面所有改动恒等
const base: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
base[2][2] = '#ff0000';
base[3][5] = '#00ff00';
const clone = () => base.map((r) => [...r]);

// H1 同图同哈希（确定性）
ok('H1 同图同哈希', hashPixelGrid(base) === hashPixelGrid(clone()));

// H2 内部像素改色（不碰四角/中心）→ 哈希必须变（旧指纹下不变，正是原 bug）
const recolor = clone(); recolor[2][2] = '#0000ff';
ok('H2 内部改色哈希变', hashPixelGrid(recolor) !== hashPixelGrid(base));

// H3 新增一个内部像素 → 变
const added = clone(); added[6][1] = '#ffffff';
ok('H3 内部加点哈希变', hashPixelGrid(added) !== hashPixelGrid(base));

// H4 删除一个内部像素 → 变
const removed = clone(); removed[3][5] = null;
ok('H4 内部删点哈希变', hashPixelGrid(removed) !== hashPixelGrid(base));

// H5 角像素变化 → 变（全图哈希不漏采样外区域，也不少采样内区域）
const corner = clone(); corner[0][0] = '#123456';
ok('H5 角点变化哈希变', hashPixelGrid(corner) !== hashPixelGrid(base));

// H6 null 与 '' 同为透明 → 同哈希（视觉同一，缓存本就该同键）
const emptyStr = clone(); emptyStr[4][4] = '';
const nullCell = clone(); nullCell[4][4] = null;
ok('H6 null/空串同哈希', hashPixelGrid(emptyStr) === hashPixelGrid(nullCell));

// H7 尺寸不同（同前缀内容）→ 变
const taller = [...clone().map((r) => [...r]), Array(8).fill(null)];
ok('H7 尺寸变化哈希变', hashPixelGrid(taller) !== hashPixelGrid(base));

// ---- 增量哈希器等价性：pixelsToCanvas 折叠路径喂的序列必须与整表哈希同值 ----
const feedAll = (grid: (string | null)[][]): string => {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  const hasher = createPixelGridHasher(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hasher.cell(grid[y]?.[x]);
  return hasher.digest();
};

// E1 常规网格等价
ok('E1 增量==整表（常规）', feedAll(base) === hashPixelGrid(base));
// E2 含空串格等价
ok('E2 增量==整表（空串）', feedAll(emptyStr) === hashPixelGrid(emptyStr));
// E3 参差行（短行缺格按透明）等价
const ragged: (string | null)[][] = [['#ff0000'], ['#00ff00', '#0000ff', null], []];
ok('E3 增量==整表（参差行）', feedAll(ragged) === hashPixelGrid(ragged));
// E4 空网格等价
ok('E4 增量==整表（空网格）', feedAll([]) === hashPixelGrid([]));

// ---- 缓存键：假 canvas（getContext 返回 null → 回退路径不采样） ----
const fakeCanvas = { width: 8, height: 8, getContext: () => null } as any;
const hA = hashPixelGrid(base);
const hB = hashPixelGrid(recolor);

// K1 给出 contentHash 时：同尺寸同角度，仅内容哈希不同 → 键必须不同
const kA = getRotationCacheKey(fakeCanvas, 30, 1, 4, 4, 1, '', hA);
const kB = getRotationCacheKey(fakeCanvas, 30, 1, 4, 4, 1, '', hB);
ok('K1 contentHash 不同则键不同', kA !== kB);

// K2 同 contentHash → 同键（缓存可命中）
ok('K2 同 contentHash 同键', getRotationCacheKey(fakeCanvas, 30, 1, 4, 4, 1, '', hA) === kA);

// K3 角度不同 → 键不同（原有维度不丢）
ok('K3 角度维度保留', getRotationCacheKey(fakeCanvas, 45, 1, 4, 4, 1, '', hA) !== kA);

// K4 不给 contentHash → 回退路径仍产出键（含尺寸，无 G 前缀段）
const kFallback = getRotationCacheKey(fakeCanvas, 30, 1, 4, 4);
ok('K4 无哈希回退产出键', typeof kFallback === 'string' && kFallback.startsWith('8:8'));

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
