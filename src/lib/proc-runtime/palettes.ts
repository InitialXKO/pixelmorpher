// 程序化运行时：调色板与枚举目录。
// 出色 = 家族 × 8 档 [描边, 暗, 本, 亮, 高光, 强调, 次强调, 纯白]；
// 运行时片元只做 (家族, 档位) 查表，rim/glint 强度走哈希门，不出界色。

/** 运行时枚举：LIGHT（邻居占据光照） */
export const LIGHT = { FLAT: 0, TOP: 1, TOP_LEFT: 2, TOP_RIGHT: 3, BOTTOM: 4, BACK: 5, AMBIENT: 6 } as const;
/** 运行时枚举：OUTLINE（外环描边方式） */
export const OUTLINE = { NONE: 0, OUTER: 1, INNER: 2, DROP: 3, TOP_ONLY: 4 } as const;
/** 运行时枚举：RIM（朝向边缘带） */
export const RIM = { NONE: 0, UPPER_LEFT: 1, UPPER_RIGHT: 2, BOTH_SIDES: 3, BOTTOM: 4, FULL: 5, SCAN: 6 } as const;
/** 运行时枚举：GLINT（候选区点亮方式） */
export const GLINT = { NONE: 0, CORNER: 1, STAR: 2, EDGE_FLOW: 3 } as const;

export const LIGHT_NAMES = Object.keys(LIGHT);
export const OUTLINE_NAMES = Object.keys(OUTLINE);
export const RIM_NAMES = Object.keys(RIM);
export const GLINT_NAMES = Object.keys(GLINT);

/** 家族 × 8 档（0xRRGGBB） */
export const PALETTES: Record<string, number[]> = {
  skin:     [0x2a1a10, 0xc89870, 0xf2c896, 0xffe0b8, 0xfff2dd, 0xe07850, 0x8a5a38, 0xffffff],
  shirt:    [0x101830, 0x2a4aa0, 0x4a6fd4, 0x7a9ff8, 0xd6e4ff, 0xf2c14e, 0x243a78, 0xffffff],
  pants:    [0x0a0e20, 0x202a50, 0x3a4a7a, 0x5a6aaa, 0xaabbee, 0x8a94b8, 0x161e3c, 0xffffff],
  shoe:     [0x140c08, 0x3a2818, 0x6a4a30, 0x9a7050, 0xd8b088, 0xb8b8c8, 0x241408, 0xffffff],
  scarf:    [0x300808, 0xa03030, 0xe05050, 0xff7a7a, 0xffc4c4, 0xf2c14e, 0x701818, 0xffffff],
  hair:     [0x140a04, 0x3a2010, 0x6a3a20, 0x9a5a38, 0xd8a068, 0xe05050, 0x241105, 0xffffff],
  eye:      [0x202030, 0xb8c4d8, 0xffffff, 0xffffff, 0xffffff, 0x7a9ff8, 0x202030, 0xffffff],
  pupil:    [0x101020, 0x101020, 0x101020, 0x101020, 0xffffff, 0x101020, 0x101020, 0xffffff],
  armor:    [0x1a1a22, 0x5a5a6a, 0x8a8a9a, 0xb8b8c8, 0xffffff, 0xf2c14e, 0x3a3a48, 0xffffff],
  armorLeg: [0x0a0a12, 0x3a3a4a, 0x6a6a7a, 0x9a9aaa, 0xe8e8f2, 0xc8c8d8, 0x22222e, 0xffffff],
  boot:     [0x0a0505, 0x2a1a0a, 0x4a3a2a, 0x7a5a3a, 0xc8a878, 0x8a8a9a, 0x180d05, 0xffffff],
  steel:    [0x14161c, 0x4a4e5c, 0x8a8fa3, 0xc9cede, 0xffffff, 0xf2c14e, 0x2c2f3a, 0xffffff],
  cloak:    [0x180a24, 0x38204e, 0x5a3482, 0x8558b8, 0xc9a6ee, 0xf2c14e, 0x241238, 0xffffff],
};
export const PALETTE_NAMES = Object.keys(PALETTES);
