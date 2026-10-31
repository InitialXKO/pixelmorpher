'use client';

// CommitNumberInput — 本地文本 + 失焦/回车提交的数值输入。
//
// 受控直写（value=store 值、onChange 里 Number(...) || 兜底逐字写回）有
// 系统性录入陷阱：键入 "0.5" 时首字 "0" 被 || 1 顶成 1、最终落成 1.5；
// 键入 "-" 时 Number('-') 为 NaN 被写成 0，负值根本录不进去。本组件把
// 文本留在本地，提交时才解析：合法（含 0 与负数）如实写，非法不写并
// 复位显示。与 JointDiscSizeRow / DressPanel 层厚输入同一口径。
//
// value 为 null 表示无值（如等比缩放的「混合」态），显示为空 + placeholder。
// 未聚焦时显示跟随外部 value（节点切换、别处改值都能刷新）；聚焦编辑
// 中不被外部值打断。

import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

interface CommitNumberInputProps {
  value: number | null;
  onCommit: (v: number) => void;
  /** 供外部按 id 聚焦（如画布右键菜单 focusInputById） */
  id?: string;
  /** true = 渲染原生 input（className 原样生效），用于紧凑行内输入；
   * 缺省渲染 ui/Input（className 按合并口径叠加）。 */
  bare?: boolean;
  step?: number | string;
  min?: number | string;
  max?: number | string;
  className?: string;
  title?: string;
  placeholder?: string;
}

const fmt = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? '' : String(v);

export default function CommitNumberInput({
  value,
  onCommit,
  id,
  bare,
  step,
  min,
  max,
  className,
  title,
  placeholder,
}: CommitNumberInputProps) {
  const [text, setText] = useState(() => fmt(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(fmt(value));
  }, [value, focused]);

  const commit = () => {
    const t = text.trim();
    if (t === '') {
      setText(fmt(value));
      return;
    }
    const v = Number(t);
    if (Number.isFinite(v)) {
      if (v !== value) onCommit(v);
      setText(fmt(v));
    } else {
      setText(fmt(value));
    }
  };

  const handlers = {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      commit();
      setFocused(false);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    },
  };

  if (bare) {
    return (
      <input
        id={id}
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        title={title}
        className={className}
        {...handlers}
      />
    );
  }

  return (
    <Input
      id={id}
      type="number"
      value={text}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      title={title}
      className={className}
      {...handlers}
    />
  );
}
