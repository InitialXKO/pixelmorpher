// Vec3Field — UI 层统一的 3D 坐标输入。
//
// 展示空间全 UI 只有一个：X+ 东、Y+ 上、Z+ 南。每个字段按其存储空间声明
// space，换算只在本组件内发生（存储层零改动）：
// - 'render-world'：渲染世界存储（offset3D、IK poleTarget3D 等），Y 向下存
//   → 展示/写回各取反一次 Y。
// - 'file'：模型文件世界（手动拆分枢轴），Y 向上存 → 恒等。
// 局部系/2D 字段不要用本组件（罗盘注对它们不成立）。
//
// offset3D 的罗盘注以静止姿态为基准（父局部系，静止时与世界轴对齐）。

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Vec3Space = 'render-world' | 'file';

const AXES = [
  { key: 'x', label: 'X（东）' },
  { key: 'y', label: 'Y（上）' },
  { key: 'z', label: 'Z（南）' },
] as const;

const nz = (v: number): number => (v === 0 ? 0 : v); // 归一 -0

export function vec3ToDisplay(v: Vec3, space: Vec3Space): Vec3 {
  return space === 'render-world' ? { x: v.x, y: nz(-v.y), z: v.z } : { ...v };
}

export function vec3FromDisplay(d: Vec3, space: Vec3Space): Vec3 {
  return space === 'render-world' ? { x: d.x, y: nz(-d.y), z: d.z } : { ...d };
}

export function Vec3Field({
  value,
  onChange,
  space,
  unit,
  step,
  round = false,
  labelClassName = 'text-[8px] text-gray-600 whitespace-nowrap',
  inputClassName = 'h-4 text-[8px] bg-[#0d0d1a] border border-[#1e1e3a] rounded w-12 px-0.5 text-gray-200',
  disabled = false,
}: {
  /** 存储空间下的值 */
  value: Vec3;
  /** 以存储空间的值回调 */
  onChange: (v: Vec3) => void;
  space: Vec3Space;
  /** 单位注（如 'px' / '模型单位'），显示在输入组末尾 */
  unit?: string;
  step?: number;
  /** 展示取整（存储值不变，编辑时按取整值写回） */
  round?: boolean;
  labelClassName?: string;
  inputClassName?: string;
  disabled?: boolean;
}) {
  const display = vec3ToDisplay(value, space);
  const shown = (v: number): number => (round ? Math.round(v) : v);
  return (
    <span className="inline-flex items-center gap-1">
      {AXES.map(({ key, label }) => (
        <label key={key} className="inline-flex items-center gap-0.5">
          <span className={labelClassName}>{label}</span>
          <input
            type="number"
            step={step}
            value={shown(display[key])}
            disabled={disabled}
            onChange={(e) => {
              const num = Number(e.target.value);
              if (!Number.isFinite(num)) return;
              onChange(vec3FromDisplay({ ...display, [key]: num }, space));
            }}
            className={inputClassName}
          />
        </label>
      ))}
      {unit && <span className="text-[8px] text-gray-600 whitespace-nowrap">{unit}</span>}
    </span>
  );
}
