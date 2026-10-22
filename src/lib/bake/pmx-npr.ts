// PMX NPR 着色 — 移植自用户提供参考（SFV sfv-viewer/mmd/npr-material.ts）。
// 机制：按材质名自动分类（脸/发/肌/眼/衣/金属/丝袜），给 MeshStandardMaterial
// 注入 onBeforeCompile，在最终颜色上叠加 toon ramp（按亮度阶梯化）+ Fresnel
// rim 光 + 眼部 emission boost。烘焙「PMX 原味着色」开关打开时，颜色遍用
// 本模块的材质而非管线统一的 MeshToonMaterial 转换。
// 未移植 createOutlineMaterial（inverted hull 描边与本管线像素提取的轮廓处理重复）。

import * as THREE from 'three';

export type MaterialPreset =
  | 'face'
  | 'body'
  | 'hair'
  | 'eye'
  | 'cloth_smooth'
  | 'cloth_rough'
  | 'metal'
  | 'stockings'
  | 'default';

/** 按材质名自动分类 NPR 预设（与参考实现一致） */
export function autoClassifyMaterial(materialName: string): MaterialPreset {
  const n = materialName.toLowerCase();
  if (n.includes('顔') || n.includes('脸') || n.includes('face')) return 'face';
  if (n.includes('髪') || n.includes('髮') || n.includes('头发') || n.includes('hair')) return 'hair';
  if (n.includes('肌') || n.includes('皮肤') || n.includes('skin') || n.includes('body') || n.includes('体')) return 'body';
  if (n.includes('目') || n.includes('眼睛') || n.includes('眼白') || n.includes('瞳') || n.includes('eye')) return 'eye';
  if (n.includes('靴') || n.includes('鞋') || n.includes('shoe') || n.includes('shoes')) return 'cloth_rough';
  if (n.includes('服') || n.includes('衣') || n.includes('裙') || n.includes('裤') || n.includes('cloth') || n.includes('shirt') || n.includes('jacket') || n.includes('pants') || n.includes('skirt') || n.includes('dress') || n.includes('blouse')) return 'cloth_smooth';
  if (n.includes('金属') || n.includes('metal') || n.includes('gold') || n.includes('silver') || n.includes('rubber') || n.includes('leather')) return 'metal';
  if (n.includes('ストッキング') || n.includes('袜') || n.includes('stocking') || n.includes('sock')) return 'stockings';
  return 'default';
}

const TOON_RAMP_GLSL = /* glsl */ `
  float toonRamp(float NdotL, float step1, float step2) {
    float w = fwidth(NdotL) * 1.5;
    float s1 = smoothstep(step1 - w, step1 + w, NdotL);
    float s2 = smoothstep(step2 - w, step2 + w, NdotL);
    return mix(0.5, 1.0, s1) * mix(0.7, 1.0, s2);
  }
`;

const RIM_GLSL = /* glsl */ `
  float fresnelRim(vec3 N, vec3 V, float power, float strength) {
    float NdotV = max(dot(N, V), 0.0);
    float rim = pow(1.0 - NdotV, power);
    return rim * strength;
  }
`;

interface PresetConfig {
  toonStep1: number;
  toonStep2: number;
  rimPower: number;
  rimStrength: number;
  rimColor: number;
  emissionBoost: number;
}

function getPresetConfig(preset: MaterialPreset): PresetConfig {
  switch (preset) {
    case 'face':
      return { toonStep1: 0.3, toonStep2: 0.7, rimPower: 3.0, rimStrength: 0.3, rimColor: 0xffcc88, emissionBoost: 0 };
    case 'body':
      return { toonStep1: 0.25, toonStep2: 0.65, rimPower: 2.5, rimStrength: 0.25, rimColor: 0xffd9b3, emissionBoost: 0 };
    case 'hair':
      return { toonStep1: 0.35, toonStep2: 0.75, rimPower: 2.0, rimStrength: 0.4, rimColor: 0xffffff, emissionBoost: 0 };
    case 'eye':
      return { toonStep1: 0.0, toonStep2: 1.0, rimPower: 4.0, rimStrength: 0.0, rimColor: 0x000000, emissionBoost: 0.5 };
    case 'cloth_smooth':
      return { toonStep1: 0.3, toonStep2: 0.7, rimPower: 3.0, rimStrength: 0.2, rimColor: 0xffffff, emissionBoost: 0 };
    case 'cloth_rough':
      return { toonStep1: 0.25, toonStep2: 0.6, rimPower: 3.5, rimStrength: 0.15, rimColor: 0xccccff, emissionBoost: 0 };
    case 'metal':
      return { toonStep1: 0.4, toonStep2: 0.8, rimPower: 2.0, rimStrength: 0.5, rimColor: 0xffffff, emissionBoost: 0.2 };
    case 'stockings':
      return { toonStep1: 0.3, toonStep2: 0.7, rimPower: 2.5, rimStrength: 0.3, rimColor: 0xffaaaa, emissionBoost: 0 };
    default:
      return { toonStep1: 0.3, toonStep2: 0.7, rimPower: 3.0, rimStrength: 0.15, rimColor: 0xffffff, emissionBoost: 0 };
  }
}

/** 给 MeshStandardMaterial 注入 NPR 扩展（与参考实现一致） */
export function applyNPRPreset(
  material: THREE.MeshStandardMaterial,
  preset: MaterialPreset,
): void {
  if (!material.userData._nprOriginalOnBeforeCompile) {
    material.userData._nprOriginalOnBeforeCompile = material.onBeforeCompile;
    material.userData._nprOriginalCacheKey = material.customProgramCacheKey;
  }
  material.userData._nprPreset = preset;
  material.userData.nprEnabled = true;

  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
        #include <common>
        uniform float uToonStep1;
        uniform float uToonStep2;
        uniform float uRimPower;
        uniform float uRimStrength;
        uniform vec3 uRimColor;
        uniform float uEmissionBoost;
        ${TOON_RAMP_GLSL}
        ${RIM_GLSL}
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        #include <dithering_fragment>

        // NPR 叠加: toon ramp + rim + emission boost
        {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(vViewPosition);

          float NdotL = dot(N, normalize(vViewPosition));
          float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
          float toon = toonRamp(lum, uToonStep1, uToonStep2);
          gl_FragColor.rgb *= mix(0.7, 1.0, toon);

          float rim = fresnelRim(N, V, uRimPower, uRimStrength);
          gl_FragColor.rgb += uRimColor * rim;

          if (uEmissionBoost > 0.0) {
            gl_FragColor.rgb += gl_FragColor.rgb * uEmissionBoost;
          }
        }
      `,
    );

    const config = getPresetConfig(preset);
    shader.uniforms.uToonStep1 = { value: config.toonStep1 };
    shader.uniforms.uToonStep2 = { value: config.toonStep2 };
    shader.uniforms.uRimPower = { value: config.rimPower };
    shader.uniforms.uRimStrength = { value: config.rimStrength };
    shader.uniforms.uRimColor = { value: new THREE.Color(config.rimColor) };
    shader.uniforms.uEmissionBoost = { value: config.emissionBoost };
  };

  material.customProgramCacheKey = () => `npr-${preset}`;
  material.needsUpdate = true;
}

/** 禁用 NPR — 恢复材质到注入前（与参考实现一致） */
export function disableNPR(material: THREE.MeshStandardMaterial): void {
  material.userData.nprEnabled = false;
  material.onBeforeCompile = material.userData._nprOriginalOnBeforeCompile || null;
  material.customProgramCacheKey = material.userData._nprOriginalCacheKey || null;
  material.flatShading = false;
  material.needsUpdate = true;
}

/**
 * 烘焙颜色遍的 NPR 材质构造：克隆源 MeshStandardMaterial 并按其名称套预设。
 * 源不是 MeshStandardMaterial 时返回 null（调用方回退统一 toon 转换）。
 */
export function makeNprFromSource(source: THREE.Material | null): THREE.Material | null {
  if (!source || !(source as THREE.MeshStandardMaterial).isMeshStandardMaterial) return null;
  const clone = (source as THREE.MeshStandardMaterial).clone();
  applyNPRPreset(clone, autoClassifyMaterial(clone.name ?? ''));
  return clone;
}
