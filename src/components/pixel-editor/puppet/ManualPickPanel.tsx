'use client';

// ============================================================
// PixelMorpher - 手动拆分点选面板（乙案）
// 两种拾取模式共用一个场景（由 loadManualStatics 的静态网格构建）：
//  · 三视图：正/侧/顶正交渲染（按部件染色），点击取单网格、框选取成员集；
//    命中走同渲的 ID 图读回（meshIndex 编码色，与骨骼 ID 遍同手法）。
//  · 3D：透视相机 + OrbitControls，射线拾取。
// 选择集由对话框持有（与网格列表复选框同一个 selectedMeshes），
// 选好后用列表上方的「批量分配」落成部件；部件归属以部件色呈现，图例可点选整部件。
// ============================================================

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  loadManualStatics,
  encodeMeshIdColor,
  decodeMeshId,
  computeManualFraming,
  type ManualCatalog,
} from '@/lib/bake/threejs-baker-manual';

interface PartLike {
  id: number;
  name: string;
  meshIndices: number[];
}

interface ManualPickPanelProps {
  resolveInput: () => Promise<string | ArrayBuffer>;
  pmxTextures?: Map<string, Blob>;
  catalog: ManualCatalog;
  parts: PartLike[];
  selectedMeshes: Set<number>;
  onSelectionChange: (next: Set<number>) => void;
}

const VIEW_SIZE = 384;
type ViewKey = 'front' | 'side' | 'top';
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'front', label: '正面' },
  { key: 'side', label: '侧面（东）' },
  { key: 'top', label: '顶面' },
];

const UNASSIGNED = new THREE.Color(0.32, 0.32, 0.37);
function partColor(idx: number): THREE.Color {
  return new THREE.Color().setHSL((idx * 0.61803) % 1, 0.6, 0.55);
}

interface SceneEntry {
  meshIndex: number;
  mesh: THREE.Mesh;
  colorMat: THREE.MeshLambertMaterial;
  idMat: THREE.MeshBasicMaterial;
}

interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  entries: SceneEntry[];
  persp: THREE.PerspectiveCamera;
  ortho: Record<ViewKey, THREE.OrthographicCamera>;
  controls: OrbitControls;
  idBufs: Record<ViewKey, Uint8Array | null>;
}

export default function ManualPickPanel({
  resolveInput,
  pmxTextures,
  catalog,
  parts,
  selectedMeshes,
  onSelectionChange,
}: ManualPickPanelProps) {
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const [dragRect, setDragRect] = useState<{
    view: ViewKey;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const bundleRef = useRef<SceneBundle | null>(null);
  const mount3DRef = useRef<HTMLDivElement>(null);
  const viewCanvasRefs = useRef<Record<ViewKey, HTMLCanvasElement | null>>({ front: null, side: null, top: null });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const stateRef = useRef({ parts, selectedMeshes, hover });
  stateRef.current = { parts, selectedMeshes, hover };
  const dragRef = useRef<{
    view: ViewKey;
    startData: { x: number; y: number };
    curData: { x: number; y: number };
    rectLeft: number;
    rectTop: number;
    startCss: { x: number; y: number };
  } | null>(null);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  // ---------- 颜色与重绘 ----------
  const applyColors = () => {
    const b = bundleRef.current;
    if (!b) return;
    const { parts: ps, selectedMeshes: sel, hover: hov } = stateRef.current;
    const owner = new Map<number, number>();
    ps.forEach((p, i) => p.meshIndices.forEach((mi) => owner.set(mi, i)));
    for (const e of b.entries) {
      const oi = owner.get(e.meshIndex);
      const base = oi !== undefined ? partColor(oi) : UNASSIGNED;
      e.colorMat.color.copy(base);
      const f = sel.has(e.meshIndex) ? 0.7 : hov === e.meshIndex ? 0.38 : 0.07;
      e.colorMat.emissive.copy(base).multiplyScalar(f);
    }
  };

  const renderViews = () => {
    const b = bundleRef.current;
    if (!b) return;
    b.renderer.setSize(VIEW_SIZE, VIEW_SIZE, false);
    for (const v of VIEWS) {
      const canvas = viewCanvasRefs.current[v.key];
      if (!canvas) continue;
      b.renderer.render(b.scene, b.ortho[v.key]);
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(b.renderer.domElement, 0, 0);
    }
  };

  // ---------- 场景构建（挂载时一次；父组件以 key 按模型源remount） ----------
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    (async () => {
      try {
        const inp = await resolveInput();
        const { statics } = await loadManualStatics(inp, pmxTextures);
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: false });
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.setClearColor(0x0d0d1f, 1);

        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 1.15));
        const dl = new THREE.DirectionalLight(0xffffff, 1.1);
        dl.position.set(2, 3, 2.5);
        scene.add(dl);

        const entries: SceneEntry[] = [];
        for (const st of statics) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(st.positions, 3));
          if (st.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(st.uvs, 2));
          if (st.index) geo.setIndex(new THREE.BufferAttribute(st.index, 1));
          geo.computeVertexNormals();
          const colorMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
          const [r, g, bb] = encodeMeshIdColor(st.info.meshIndex);
          const idMat = new THREE.MeshBasicMaterial();
          idMat.color.setRGB(r, g, bb, THREE.LinearSRGBColorSpace);
          const mesh = new THREE.Mesh(geo, colorMat);
          mesh.userData.meshIndex = st.info.meshIndex;
          scene.add(mesh);
          entries.push({ meshIndex: st.info.meshIndex, mesh, colorMat, idMat });
        }

        const { center, radius } = computeManualFraming(statics);
        const C = new THREE.Vector3(center.x, center.y, center.z);
        const half = radius * 1.08;
        const mkOrtho = (pos: THREE.Vector3, up: THREE.Vector3) => {
          const cam = new THREE.OrthographicCamera(-half, half, half, -half, radius * 0.1, radius * 8);
          cam.position.copy(pos);
          cam.up.copy(up);
          cam.lookAt(C);
          cam.updateProjectionMatrix();
          return cam;
        };
        const ortho: Record<ViewKey, THREE.OrthographicCamera> = {
          front: mkOrtho(C.clone().add(new THREE.Vector3(0, 0, radius * 3)), new THREE.Vector3(0, 1, 0)),
          side: mkOrtho(C.clone().add(new THREE.Vector3(radius * 3, 0, 0)), new THREE.Vector3(0, 1, 0)),
          top: mkOrtho(C.clone().add(new THREE.Vector3(0, radius * 3, 0)), new THREE.Vector3(0, 0, -1)),
        };
        const persp = new THREE.PerspectiveCamera(40, 16 / 9, radius * 0.05, radius * 20);
        persp.position.copy(C).add(new THREE.Vector3(radius * 1.5, radius * 0.8, radius * 2.1));
        persp.lookAt(C);
        const controls = new OrbitControls(persp, renderer.domElement);
        controls.target.copy(C);
        controls.enableDamping = true;
        renderer.domElement.style.cursor = 'crosshair';

        // ID 图：线性色彩空间渲染目标读回，字节精确
        const rt = new THREE.WebGLRenderTarget(VIEW_SIZE, VIEW_SIZE);
        rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
        const idBufs: Record<ViewKey, Uint8Array | null> = { front: null, side: null, top: null };
        for (const e of entries) e.mesh.material = e.idMat;
        renderer.setClearColor(0x000000, 1);
        for (const v of VIEWS) {
          renderer.setRenderTarget(rt);
          renderer.render(scene, ortho[v.key]);
          const buf = new Uint8Array(VIEW_SIZE * VIEW_SIZE * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, VIEW_SIZE, VIEW_SIZE, buf);
          idBufs[v.key] = buf;
        }
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x0d0d1f, 1);
        for (const e of entries) e.mesh.material = e.colorMat;
        rt.dispose();

        bundleRef.current = { renderer, scene, entries, persp, ortho, controls, idBufs };
        applyColors();
        setStatus('ready');

        const animate = () => {
          if (disposed) return;
          raf = requestAnimationFrame(animate);
          if (modeRef.current === '3d') {
            controls.update();
            renderer.render(scene, persp);
          }
        };
        animate();
      } catch (err) {
        if (!disposed) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      const b = bundleRef.current;
      if (b) {
        b.controls.dispose();
        for (const e of b.entries) {
          e.mesh.geometry.dispose();
          e.colorMat.dispose();
          e.idMat.dispose();
        }
        b.renderer.dispose();
        bundleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 模式切换：3D 时把渲染画布挂进容器并定尺寸 ----------
  useEffect(() => {
    const b = bundleRef.current;
    if (!b || status !== 'ready') return;
    if (mode === '3d') {
      const mount = mount3DRef.current;
      if (!mount) return;
      if (b.renderer.domElement.parentElement !== mount) mount.appendChild(b.renderer.domElement);
      const w = mount.clientWidth || 640;
      b.renderer.setSize(w, 288, false);
      b.renderer.domElement.style.width = '100%';
      b.renderer.domElement.style.height = '288px';
      b.persp.aspect = w / 288;
      b.persp.updateProjectionMatrix();
      b.controls.enabled = true;
    } else {
      b.controls.enabled = false;
      applyColors();
      renderViews();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status]);

  // ---------- 归属/选择/悬停变化 → 重染色（2D 模式重绘三视图） ----------
  useEffect(() => {
    if (status !== 'ready') return;
    applyColors();
    if (modeRef.current === '2d') renderViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, selectedMeshes, hover, status]);

  // ---------- 2D 拾取 ----------
  const pickAt = (view: ViewKey, dataX: number, dataY: number): number | null => {
    const b = bundleRef.current;
    const buf = b?.idBufs[view];
    if (!buf) return null;
    const x = Math.floor(dataX);
    const y = Math.floor(dataY);
    if (x < 0 || y < 0 || x >= VIEW_SIZE || y >= VIEW_SIZE) return null;
    const row = VIEW_SIZE - 1 - y; // WebGL 读回原点在左下
    const o = (row * VIEW_SIZE + x) * 4;
    return decodeMeshId(buf[o], buf[o + 1], buf[o + 2]);
  };

  const collectRect = (view: ViewKey, x0: number, y0: number, x1: number, y1: number): Set<number> => {
    const out = new Set<number>();
    const xa = Math.max(0, Math.floor(Math.min(x0, x1)));
    const xb = Math.min(VIEW_SIZE - 1, Math.ceil(Math.max(x0, x1)));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1)));
    const yb = Math.min(VIEW_SIZE - 1, Math.ceil(Math.max(y0, y1)));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const mi = pickAt(view, x, y);
        if (mi !== null) out.add(mi);
      }
    }
    return out;
  };

  const applyPick = (picked: Set<number>, additive: boolean, toggle: boolean) => {
    if (!additive) {
      onSelectionChange(picked);
      return;
    }
    const next = new Set(stateRef.current.selectedMeshes);
    for (const mi of picked) {
      if (toggle && next.has(mi)) next.delete(mi);
      else next.add(mi);
    }
    onSelectionChange(next);
  };

  const viewPointer = (e: React.PointerEvent, view: ViewKey) => {
    const canvas = viewCanvasRefs.current[view];
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      data: {
        x: ((e.clientX - rect.left) / rect.width) * VIEW_SIZE,
        y: ((e.clientY - rect.top) / rect.height) * VIEW_SIZE,
      },
      css: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      rect,
    };
  };

  const handleViewDown = (e: React.PointerEvent, view: ViewKey) => {
    const p = viewPointer(e, view);
    if (!p) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      view,
      startData: p.data,
      curData: p.data,
      rectLeft: p.rect.left,
      rectTop: p.rect.top,
      startCss: p.css,
    };
  };

  const handleViewMove = (e: React.PointerEvent, view: ViewKey) => {
    const d = dragRef.current;
    if (d && d.view === view) {
      const css = { x: e.clientX - d.rectLeft, y: e.clientY - d.rectTop };
      const canvas = viewCanvasRefs.current[view];
      const rect = canvas?.getBoundingClientRect();
      if (rect) {
        d.curData = {
          x: ((e.clientX - rect.left) / rect.width) * VIEW_SIZE,
          y: ((e.clientY - rect.top) / rect.height) * VIEW_SIZE,
        };
      }
      setDragRect({
        view,
        left: Math.min(d.startCss.x, css.x),
        top: Math.min(d.startCss.y, css.y),
        width: Math.abs(css.x - d.startCss.x),
        height: Math.abs(css.y - d.startCss.y),
      });
      return;
    }
    const p = viewPointer(e, view);
    if (!p) return;
    const mi = pickAt(view, p.data.x, p.data.y);
    setHover((prev) => (prev === mi ? prev : mi));
  };

  const handleViewUp = (e: React.PointerEvent, view: ViewKey) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragRect(null);
    if (!d || d.view !== view) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const moved = Math.max(Math.abs(d.curData.x - d.startData.x), Math.abs(d.curData.y - d.startData.y));
    if (moved < 4) {
      const mi = pickAt(view, d.startData.x, d.startData.y);
      applyPick(mi !== null ? new Set([mi]) : new Set(), additive, true);
    } else {
      applyPick(collectRect(view, d.startData.x, d.startData.y, d.curData.x, d.curData.y), additive, false);
    }
  };

  // ---------- 3D 拾取 ----------
  useEffect(() => {
    const b = bundleRef.current;
    if (!b || status !== 'ready') return;
    const el = b.renderer.domElement;
    const onDown = (e: PointerEvent) => {
      downPosRef.current = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      const down = downPosRef.current;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // 轨道拖动不算点选
      const rect = el.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, b.persp);
      const hits = ray.intersectObjects(b.entries.map((en) => en.mesh), false);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (hits.length > 0) {
        applyPick(new Set([hits[0].object.userData.meshIndex as number]), additive, true);
      } else if (!additive) {
        onSelectionChange(new Set());
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ---------- 渲染 ----------
  const ownerOf = (mi: number) => parts.findIndex((p) => p.meshIndices.includes(mi));
  const unassignedCount = catalog.meshes.filter((m) => ownerOf(m.meshIndex) === -1).length;
  const hoverInfo = hover !== null ? catalog.meshes[hover] : undefined;

  return (
    <div className="mt-2 rounded border border-[#2a2a4a] bg-[#0a0a1c] p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-bold text-gray-300">点选</span>
        <div className="flex overflow-hidden rounded border border-[#3a3a5a]">
          <button
            onClick={() => setMode('2d')}
            className={`px-2 py-0.5 text-[10px] ${mode === '2d' ? 'bg-[#2a2a5a] text-gray-100' : 'text-gray-400 hover:bg-[#222240]'}`}
          >
            三视图
          </button>
          <button
            onClick={() => setMode('3d')}
            className={`px-2 py-0.5 text-[10px] ${mode === '3d' ? 'bg-[#2a2a5a] text-gray-100' : 'text-gray-400 hover:bg-[#222240]'}`}
          >
            3D
          </button>
        </div>
        <span className="text-gray-500">
          {mode === '2d' ? '点击选网格、拖动框选成员；Shift/Ctrl 增选或取消' : '拖动旋转、点击选网格；Shift/Ctrl 增选或取消'}
        </span>
        <span className="flex-1" />
        <span className="text-gray-400">已选 {selectedMeshes.size} 个</span>
        <button
          disabled={selectedMeshes.size === 0}
          onClick={() => onSelectionChange(new Set())}
          className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-50"
        >
          清空选择
        </button>
      </div>

      {status === 'loading' && <div className="py-6 text-center text-[11px] text-gray-500">加载点选预览…</div>}
      {status === 'error' && (
        <div className="py-3 text-[11px] text-amber-400">点选预览加载失败（列表分配不受影响）：{errorMsg}</div>
      )}

      {status === 'ready' && (
        <>
          {mode === '2d' ? (
            <div className="grid grid-cols-3 gap-2">
              {VIEWS.map((v) => (
                <div key={v.key} className="relative">
                  <canvas
                    ref={(el) => {
                      viewCanvasRefs.current[v.key] = el;
                    }}
                    width={VIEW_SIZE}
                    height={VIEW_SIZE}
                    className="w-full cursor-crosshair touch-none rounded border border-[#2a2a4a] bg-[#0d0d1f]"
                    onPointerDown={(e) => handleViewDown(e, v.key)}
                    onPointerMove={(e) => handleViewMove(e, v.key)}
                    onPointerUp={(e) => handleViewUp(e, v.key)}
                    onPointerLeave={() => setHover(null)}
                  />
                  <div className="pointer-events-none absolute left-1 top-1 text-[10px] text-gray-400">{v.label}</div>
                  {dragRect?.view === v.key && (
                    <div
                      className="pointer-events-none absolute border border-cyan-400 bg-cyan-400/10"
                      style={{ left: dragRect.left, top: dragRect.top, width: dragRect.width, height: dragRect.height }}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div ref={mount3DRef} className="h-72 w-full overflow-hidden rounded border border-[#2a2a4a] bg-[#0d0d1f]" />
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            {parts.map((p, i) => (
              <button
                key={p.id}
                onClick={() => onSelectionChange(new Set(p.meshIndices))}
                className="flex items-center gap-1 rounded border border-[#2a2a4a] px-1.5 py-0.5 text-gray-300 hover:bg-[#222240]"
                title="选中该部件的全部网格"
              >
                <span className="inline-block size-2.5 rounded-sm" style={{ background: partColor(i).getStyle() }} />
                {p.name || '部件'} · {p.meshIndices.length}
              </button>
            ))}
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-gray-500">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: UNASSIGNED.getStyle() }} />
              未分配 · {unassignedCount}
            </span>
            <span className="flex-1" />
            {hoverInfo && (
              <span className="text-gray-500">
                悬停：{hoverInfo.name}（#{hoverInfo.meshIndex}）
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
