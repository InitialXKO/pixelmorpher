'use client';

/**
 * 刀光参数编辑器（椭圆扇形状衰减）：片段与表演共用。
 * 左侧实时预览中间进度的一帧；参数口径与生成器 slash-fan.ts 一致。
 */
import { useEffect, useRef } from 'react';
import {
  SLASH_PRESETS, defaultSlashSpec, generateSlashFrame,
  type SlashFanSpec,
} from '@/lib/slash-fan';

interface Props {
  value: SlashFanSpec | undefined;
  onChange: (next: SlashFanSpec | undefined) => void;
  nodes: { id: string; name: string }[];
}

const numCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-1 w-full text-gray-200';

export default function SlashEffectEditor({ value, onChange, nodes }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !value) return;
    const frame = generateSlashFrame(value, 0.45, false);
    c.width = frame.w;
    c.height = frame.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(frame.w, frame.h);
    img.data.set(frame.rgba);
    ctx.putImageData(img, 0, 0);
  }, [value]);

  if (!value) {
    return (
      <button
        type="button"
        onClick={() => onChange(defaultSlashSpec(nodes[0]?.id ?? ''))}
        className="text-[10px] px-2 py-1 rounded border border-[#2b2b3f] text-amber-300/90 hover:border-amber-500/60"
      >
        ＋ 添加刀光（椭圆扇）
      </button>
    );
  }

  const set = (patch: Partial<SlashFanSpec>) => onChange({ ...value, ...patch });
  const num = (
    label: string,
    key: keyof SlashFanSpec,
    step = 1,
    title?: string,
  ) => (
    <div>
      <div className="text-[9px] text-gray-500">{label}</div>
      <input
        type="number"
        step={step}
        value={Number(value[key]) || 0}
        title={title}
        onChange={(e) => set({ [key]: Number(e.target.value) || 0 } as Partial<SlashFanSpec>)}
        className={numCls}
      />
    </div>
  );

  return (
    <div className="rounded border border-[#23233a] bg-[#12121f] p-2 space-y-2">
      <div className="flex items-start gap-2">
        <canvas
          ref={canvasRef}
          className="size-16 shrink-0 rounded border border-[#1e1e3a]"
          style={{
            imageRendering: 'pixelated',
            background: 'repeating-conic-gradient(#191922 0% 25%, #101018 0% 50%) 0 0 / 10px 10px',
          }}
          title="中间进度预览"
        />
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-amber-200">刀光（椭圆扇）</span>
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-[9px] text-gray-500 hover:text-red-300"
            >
              移除
            </button>
          </div>
          <select
            value={value.anchorNodeId}
            onChange={(e) => set({ anchorNodeId: e.target.value })}
            className={numCls}
            title="锚点节点：刀光在开始时定格该节点的位姿（位置+角度），之后不跟随"
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1">
            {SLASH_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => set({ ...preset.params })}
                className="text-[9px] px-1.5 py-0.5 rounded border border-[#2b2b3f] text-gray-300 hover:border-amber-500/60"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {num('中心 X', 'cx', 0.5, '椭圆中心（帧画布坐标），同时是对位点')}
        {num('中心 Y', 'cy', 0.5)}
        {num('半轴 X', 'rx', 0.5)}
        {num('半轴 Y', 'ry', 0.5)}
        {num('旋转 °', 'rotDeg')}
        {num('起始 °', 'a0Deg')}
        {num('扫过 °', 'sweepDeg')}
        {num('厚度', 'thick', 0.01, '头部处扇形带占半径的比例')}
        {num('角向收尖', 'gammaAng', 0.05, '越大尾部收得越急')}
        {num('径向软边', 'softRad', 0.01)}
        {num('帧数', 'frameCount', 1)}
        {num('时长 秒', 'durationSec', 0.05, '0 = 跟随表演/片段窗时长')}
        {num('画布宽', 'w')}
        {num('画布高', 'h')}
      </div>
      <p className="text-[9px] text-gray-600">
        形状：外边界是椭圆弧，内边界随角向位置向尾部收尖；播放时头部先展开、尾部后收走。位姿在开始帧定格锚点，挥砍的弧线靠起始角/扫过角与锚点当时的角度对齐。
      </p>
    </div>
  );
}
