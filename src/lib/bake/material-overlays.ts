// ============================================================
// PMX 重合加算附加层识别（2026-10-25 移植自 ANGJustinl/3Dto2Dshape 的
// materialOverlays.ts，MIT License；上游 NikuKikai/3Dto2Dshape）。
//
// 平涂/toon 渲染无法还原 MMD 的加算球面贴图（SPA）效果：与本体表面完全
// 重合的加算层若按普通不透明表面渲染，会盖住本体并抢深度。判定不靠材质
// 名——候选 = 带球面贴图且球面模式为加算（sphereMode=2）的材质组；只有当
// 它的每个三角形都能在非候选材质组里找到一个位置完全重合、且蒙皮权重与
// 表情位移（morph）逐顶点一致的孪生三角形时，才认定为冗余附加层。
// 动画中会与本体分离的真实表面（权重/morph 不同）不会被误杀。
// ============================================================

import * as THREE from 'three';

type MaterialGroup = { start: number; count: number; materialIndex: number };
type Triangle = [number, number, number];
type OrderedTriangle = { vertices: Triangle; winding: number };
type SourceTriangle = OrderedTriangle & { side: THREE.Side };
type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** 加算球面层候选：pmx-scene 在材质 userData 上标的球面信息（贴图 + 模式 2=加算） */
const isAdditiveSphereMap = (material: THREE.Material) => {
  const ud = material.userData as { pmxSphereMap?: unknown; pmxSphereMode?: number };
  return ud.pmxSphereMap != null && ud.pmxSphereMode === 2;
};

/**
 * 找出应被剔除的材质组下标集合。geometry 必须带 index 与 groups，
 * materials/groups 与 PMX 场景的逐材质分组同制式。
 */
export function findRedundantMaterialOverlayGroups(
  geometry: THREE.BufferGeometry,
  materials: THREE.Material[],
  groups: readonly MaterialGroup[],
): Set<number> {
  const omitted = new Set<number>();
  const candidates = groups.map((group, groupIndex) => ({ group, groupIndex }))
    .filter(({ group }) => materials[group.materialIndex] &&
      isAdditiveSphereMap(materials[group.materialIndex]));
  const index = geometry.index;
  const position = geometry.getAttribute('position');
  if (!candidates.length || !index || !position) return omitted;

  const positionKeys = new Map<number, string>();
  const positionKey = (vertex: number) => {
    let key = positionKeys.get(vertex);
    if (key === undefined) {
      // 精确源坐标：刻意微偏的壳层不算重合
      key = `${position.getX(vertex)},${position.getY(vertex)},${position.getZ(vertex)}`;
      positionKeys.set(vertex, key);
    }
    return key;
  };
  const triangleAt = (offset: number): OrderedTriangle => {
    const vertices: Triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const [first, second] = vertices;
    vertices.sort((a, b) => positionKey(a) < positionKey(b) ? -1 : positionKey(a) > positionKey(b) ? 1 : 0);
    const winding = (vertices.indexOf(second) - vertices.indexOf(first) + 3) % 3 === 1 ? 1 : -1;
    return { vertices, winding };
  };
  const triangleKey = (vertices: Triangle) => vertices.map(positionKey).join(';');
  const baseTriangles = new Map<string, SourceTriangle[]>();
  for (const group of groups) {
    const material = materials[group.materialIndex];
    if (!material || !material.visible || material.opacity < 0.999 || isAdditiveSphereMap(material)) continue;
    for (let offset = group.start; offset + 2 < group.start + group.count; offset += 3) {
      const triangle = triangleAt(offset);
      const key = triangleKey(triangle.vertices);
      const sources = baseTriangles.get(key) ?? [];
      sources.push({ ...triangle, side: material.side });
      baseTriangles.set(key, sources);
    }
  }

  const deformationAttributes: Attribute[] = [
    geometry.getAttribute('skinIndex'), geometry.getAttribute('skinWeight'),
    ...(geometry.morphAttributes.position ?? []),
  ].filter((attribute): attribute is Attribute => attribute != null);
  const componentGetters = ['getX', 'getY', 'getZ', 'getW'] as const;
  const vertexMatches = new Map<string, boolean>();
  const sameDeformation = (a: number, b: number) => {
    if (a === b) return true;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = vertexMatches.get(key);
    if (cached !== undefined) return cached;
    const matches = deformationAttributes.every((attribute) => {
      if (attribute.itemSize > componentGetters.length) return false;
      for (let component = 0; component < attribute.itemSize; component += 1) {
        const getter = componentGetters[component];
        if (attribute[getter](a) !== attribute[getter](b)) return false;
      }
      return true;
    });
    vertexMatches.set(key, matches);
    return matches;
  };

  for (const { group, groupIndex } of candidates) {
    if (group.count === 0 || group.count % 3 !== 0) continue;
    const material = materials[group.materialIndex];
    let fullyCovered = true;
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const { vertices, winding } = triangleAt(offset);
      const sources = baseTriangles.get(triangleKey(vertices));
      if (!sources?.some((source) =>
        (source.side === THREE.DoubleSide ||
          (source.side === material.side && source.winding === winding)) &&
        vertices.every((vertex, corner) => sameDeformation(vertex, source.vertices[corner])))) {
        fullyCovered = false;
        break;
      }
    }
    if (fullyCovered) omitted.add(groupIndex);
  }
  return omitted;
}

/**
 * 对 PMX 场景网格执行剔除：命中的材质置 visible=false（其分组即该材质的
 * 全部三角形），并把被剔除的材质名记在 mesh.userData 上备查。
 * 返回剔除的材质下标列表。
 */
export function omitRedundantOverlayMaterials(mesh: THREE.Mesh): number[] {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material ? [mesh.material] : [];
  if (materials.length === 0 || mesh.geometry.groups.length === 0) return [];
  const omitted = findRedundantMaterialOverlayGroups(mesh.geometry, materials, mesh.geometry.groups);
  const omittedMaterials: number[] = [];
  for (const groupIndex of omitted) {
    const mi = mesh.geometry.groups[groupIndex].materialIndex ?? groupIndex;
    const mat = materials[mi];
    if (mat && mat.visible) {
      mat.visible = false;
      omittedMaterials.push(mi);
    }
  }
  if (omittedMaterials.length > 0) {
    mesh.userData.omittedOverlayMaterials = omittedMaterials.map((mi) => materials[mi].name || `#${mi}`);
  }
  return omittedMaterials;
}
