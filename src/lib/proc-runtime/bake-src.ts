// ============================================================
// 表面模式 DAG 烘焙（单一源）：JS 源码字符串，同一份代码
// ① 嵌进运行时模板（瓦片烘焙 compileTileDAG）② 被探针加载校验。
// 语义与模板内 compileTile（层程序版）同构：瓦片几何 M=2 边距、
// occ 规则、外环 254/外部 255、R=档位 G=glint、写出按序覆盖。
// 场约定：节点值 = (x, y, env) → number。坐标 = 部件局部 px
// （原点=形状中心，与 compileTile 的 px/py 同空间）。
// 形状派生叶（inside/dist/h/facing）永远读形状空间的基础场
// （per-pixel base，不受 repeat/warp 影响）；坐标函数叶
// （stripes/noise/cellShape 等）读被修饰后的坐标与 env.cell。
// 距离场统一「内正外负」：dist 叶与 cellShape 都返回带符号距离。
// ============================================================

export const BAKE_SRC = `
function sdSegmentB(px, py, ax, ay, bx, by) {
  var pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  var h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}
function pointInPolygonB(px, py, pts) {
  var inside = false;
  for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function shapeFieldDAG(shape, px, py) {
  var w = shape.size[0], h = shape.size[1];
  if (shape.kind === 'poly') {
    var pts = shape.points || [], piv = shape.pivot || [0, 0];
    var rel = pts.map(function (p) { return [p[0] - piv[0], p[1] - piv[1]]; });
    var d = Infinity;
    for (var i = 0; i < rel.length; i++) {
      var a = rel[i], b = rel[(i + 1) % rel.length];
      d = Math.min(d, sdSegmentB(px, py, a[0], a[1], b[0], b[1]));
    }
    return { inside: rel.length >= 3 ? pointInPolygonB(px, py, rel) : false, d: d };
  }
  if (shape.kind === 'ellipse') {
    var rx = Math.max(w / 2, 0.5), ry = Math.max(h / 2, 0.5);
    var q = Math.hypot(px / rx, py / ry);
    return { inside: q <= 1, d: Math.abs(q - 1) * Math.min(rx, ry) };
  }
  if (shape.kind === 'capsule') {
    var r = Math.min(w, h) / 2;
    var ax = Math.max(0, w / 2 - r), ay = Math.max(0, h / 2 - r);
    var cx = Math.max(-ax, Math.min(ax, px)), cy = Math.max(-ay, Math.min(ay, py));
    var dc = Math.hypot(px - cx, py - cy) - r;
    return { inside: dc <= 0, d: Math.abs(dc) };
  }
  var rr = Math.max(0, Math.min(1, shape.roundness !== undefined && shape.roundness !== null ? shape.roundness : 0)) * Math.min(w, h) / 2;
  var qx = Math.abs(px) - (w / 2 - rr), qy = Math.abs(py) - (h / 2 - rr);
  var axx = Math.max(qx, 0), ayy = Math.max(qy, 0);
  var dOut = Math.hypot(axx, ayy) + Math.min(Math.max(qx, qy), 0) - rr;
  return { inside: dOut <= 0, d: Math.abs(dOut) };
}
function hashN(ix, iy, seed) {
  var s = Math.sin(ix * 127.1 + iy * 311.7 + (seed || 0) * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y, seed) {
  var ix = Math.floor(x), iy = Math.floor(y);
  var fx = x - ix, fy = y - iy;
  var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  var a = hashN(ix, iy, seed), b = hashN(ix + 1, iy, seed);
  var c = hashN(ix, iy + 1, seed), d = hashN(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, seed) {
  return (vnoise(x, y, seed) * 0.55 + vnoise(x * 2.13, y * 2.13, seed + 5) * 0.3 + vnoise(x * 4.31, y * 4.31, seed + 11) * 0.15);
}
function mulberry(seed) {
  var t = (seed | 0) + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 编译一张表面图为求值器：prep(graph, shape) 做一次性准备（藤蔓路径等），
// evaluate(x, y, base) → {slot, glint} 其中 base 为形状基础场。
// phase（动态表面 D1）：本轮烘焙的相位 0..1，注入保留参数
// $phase / $phaseDeg，并经 env.phase 供 phase 场源与 scroll 作用域消费。
function compileSurfaceGraph(graph, shape, phase) {
  var phaseN = (typeof phase === 'number' && isFinite(phase)) ? ((phase % 1) + 1) % 1 : 0;
  // 形状外接半径：极坐标重复的径向跨度（单元局部系居中要用）
  var shapeMaxRad = (shape && shape.size) ? Math.hypot(shape.size[0], shape.size[1]) / 2 : 30;
  var gparams = Object.assign({}, graph.params || {}, { phase: phaseN, phaseDeg: phaseN * 360 });
  var byId = new Map();
  for (var i = 0; i < graph.nodes.length; i++) byId.set(graph.nodes[i].id, graph.nodes[i]);
  var prepCache = new Map();

  function P(node, key, dflt) {
    var v = node.params ? node.params[key] : undefined;
    if (typeof v === 'string' && v.charAt(0) === '$') {
      var pv = gparams[v.slice(1)];
      return pv !== undefined ? pv : dflt;
    }
    return v !== undefined ? v : dflt;
  }
  function PS(node, key, dflt) {
    var v = node.params ? node.params[key] : undefined;
    return v !== undefined ? String(v) : dflt;
  }

  function vinePrep(node) {
    if (prepCache.has(node.id)) return prepCache.get(node.id);
    var seed = P(node, 'seed', 3);
    var rnd = mulberry(Math.round(seed * 1000) + 7);
    var H = shape.size[1], W = shape.size[0];
    var segs = [];
    var x = (rnd() - 0.5) * W * 0.3, y = H / 2;
    var phase = rnd() * 6.28;
    var step = Math.max(2.5, P(node, 'step', 4));
    var total = H * (0.9 + rnd() * 0.3);
    var travelled = 0, k = 0;
    var leaves = [];
    var leafEvery = P(node, 'leafEvery', 7);
    while (travelled < total && k < 200) {
      var nx = Math.sin(phase + travelled * 0.11) * W * 0.16 + (rnd() - 0.5) * 2.4;
      var ny = y - step;
      segs.push([x, y, nx, ny, k]);
      if (k % Math.max(2, Math.round(leafEvery / step)) === 0 && k > 0) {
        var side = (leaves.length % 2 === 0) ? 1 : -1;
        leaves.push([nx + side * (2.2 + rnd() * 1.6), ny - 1, 1.6 + rnd() * 1.5]);
      }
      x = nx; y = ny; travelled += step; k++;
    }
    var data = { segs: segs, leaves: leaves, total: Math.max(travelled, 1) };
    prepCache.set(node.id, data);
    return data;
  }

  function cellShapeDist(kind, lx, ly, cw, ch, node) {
    var gap = P(node, 'gap', 0);
    var hw = cw / 2 - gap, hh = ch / 2 - gap;
    var ax = Math.abs(lx), ay = Math.abs(ly);
    if (kind === 'circle') return Math.min(hw, hh) - Math.hypot(lx, ly);
    if (kind === 'ring') {
      var r = Math.min(hw, hh);
      var th = Math.max(0.6, P(node, 'th', 1.6));
      return th / 2 - Math.abs(Math.hypot(lx, ly) - r);
    }
    if (kind === 'hex') {
      var hx = ax * 0.8660254 + ay * 0.5, hy = ay;
      var hd = Math.max(hx - hw * 0.92, hy - hh);
      return -hd;
    }
    if (kind === 'slat') {
      var th2 = Math.max(0.6, P(node, 'th', 2)) / 2;
      var vert = PS(node, 'dir', 'y') === 'y';
      var qx2 = ax - hw, qy2 = ay - (vert ? hh : th2);
      if (!vert) { qx2 = ax - th2; qy2 = ay - hh; }
      var ox = Math.max(qx2, 0), oy = Math.max(qy2, 0);
      return -(Math.hypot(ox, oy) + Math.min(Math.max(qx2, qy2), 0));
    }
    if (kind === 'scallop') {
      // 弧片：单元盒 ∩ 顶部圆（圆心在单元上边中点、半径≈半宽）
      var bx = ax - hw, by = ay - hh;
      var ox2 = Math.max(bx, 0), oy2 = Math.max(by, 0);
      var boxD = -(Math.hypot(ox2, oy2) + Math.min(Math.max(bx, by), 0));
      var cr = hw * (1.02 + P(node, 'arc', 0) * 0.3);
      var circD = cr - Math.hypot(lx, ly + hh - P(node, 'drop', 0));
      return Math.min(boxD, circD);
    }
    // rect / bevelRect
    var bx2 = ax - hw, by2 = ay - hh;
    var ox3 = Math.max(bx2, 0), oy3 = Math.max(by2, 0);
    var d = -(Math.hypot(ox3, oy3) + Math.min(Math.max(bx2, by2), 0));
    if (kind === 'bevelRect') {
      var bev = Math.max(0, P(node, 'bevel', 2));
      if (bev > 0) {
        var cut = ((ax + ay) - (hw + hh - bev)) * 0.7071;
        d = Math.min(d, -cut);
      }
    }
    return d;
  }

  function defaultCell() {
    return { w: shape.size[0], h: shape.size[1], hash: 0.5, rand: 0.5, parity: 0, row: 0, col: 0 };
  }

  function ev(node, x, y, env, cache) {
    if (!node) return 0;
    var key = null;
    if (cache) {
      key = node.id + '|' + x.toFixed(2) + '|' + y.toFixed(2) + '|' + (env.cell ? env.cell.row + ',' + env.cell.col : '');
      if (cache.has(key)) return cache.get(key);
    }
    var v = evRaw(node, x, y, env, cache);
    if (cache && key !== null) cache.set(key, v);
    return v;
  }
  function IN(node, port, x, y, env, cache) {
    var id = node.inputs ? node.inputs[port] : undefined;
    return id ? ev(byId.get(id), x, y, env, cache) : 0;
  }

  function evRaw(node, x, y, env, cache) {
    var base = env.base, cell = env.cell || defaultCell();
    switch (node.op) {
      case 'const': return P(node, 'v', 0);
      case 'ref': return 0; // 子图引用：烘焙期已展开（graph-expand），漏网的按零场兜底
      case 'phase': return env.phase || 0;
      case 'inside': return base.inside ? 1 : 0;
      case 'dist': return base.sd;
      case 'h': return base.h;
      case 'u01': return base.u01;
      case 'v01': return base.v01;
      case 'px': return x;
      case 'py': return y;
      case 'facing': {
        var deg = P(node, 'deg', -45) * Math.PI / 180;
        var dx = Math.cos(deg), dy = Math.sin(deg);
        var gl = Math.hypot(base.gx, base.gy) || 1;
        return 0.5 + 0.5 * ((base.gx / gl) * dx + (base.gy / gl) * dy);
      }
      case 'noise': {
        var f = Math.max(0.01, P(node, 'f', 0.25));
        return vnoise(x * f, y * f, P(node, 'seed', 0));
      }
      case 'blob': {
        var bf = Math.max(0.005, P(node, 'f', 0.06));
        var bv = fbm(x * bf, y * bf, P(node, 'seed', 0));
        var bc = P(node, 'contrast', 1);
        return Math.max(0, Math.min(1, 0.5 + (bv - 0.5) * 2 * bc));
      }
      case 'stripes': {
        var axis = PS(node, 'axis', 'y');
        var sv = axis === 'x' ? x : axis === 'y' ? y : x + y * 0.35;
        var sf = Math.max(0.5, P(node, 'f', 4));
        var fr = ((sv / sf + P(node, 'ph', 0)) % 1 + 1) % 1;
        return fr < P(node, 'duty', 0.5) ? 1 : 0;
      }
      case 'checker': {
        var cw = Math.max(1, P(node, 'cw', 4)), chh = Math.max(1, P(node, 'ch', 4));
        var par = Math.abs(Math.floor(x / cw) + Math.floor(y / chh)) % 2;
        return par === 0 ? 1 : 0;
      }
      case 'grad': {
        var gaxis = PS(node, 'axis', 'y');
        var gv = gaxis === 'x' ? base.u01 : base.v01;
        if (P(node, 'flip', 0)) gv = 1 - gv;
        return Math.max(0, Math.min(1, gv));
      }
      case 'cyl': {
        // 对称柱面渐变：中心 1、两侧 0（cos 曲线）
        var cu = base.u01 * 2 - 1;
        return Math.pow(Math.max(0, Math.cos(cu * Math.PI / 2)), Math.max(0.1, P(node, 'k', 1)));
      }
      case 'rings': {
        var rcx = P(node, 'cx', 0), rcy = P(node, 'cy', 0);
        var rf = Math.max(0.5, P(node, 'f', 5));
        var rd = Math.hypot(x - rcx, y - rcy) / rf;
        return rd - Math.floor(rd);
      }
      case 'voronoi': {
        var vs = Math.max(1.5, P(node, 'f', 6));
        var vseed = P(node, 'seed', 0);
        var gx2 = x / vs, gy2 = y / vs;
        var ix = Math.floor(gx2), iy = Math.floor(gy2);
        var f1 = 1e9, f2 = 1e9, idh = 0;
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
          var cxp = ix + ox, cyp = iy + oy;
          var fx = cxp + hashN(cxp, cyp, vseed), fy = cyp + hashN(cxp, cyp, vseed + 31);
          var dd = Math.hypot(gx2 - fx, gy2 - fy) * vs;
          if (dd < f1) { f2 = f1; f1 = dd; idh = hashN(cxp, cyp, vseed + 57); }
          else if (dd < f2) f2 = dd;
        }
        return PS(node, 'mode', 'edge') === 'id' ? idh : (f2 - f1);
      }
      case 'cellU': return cell.w > 0 ? (x / (cell.w / 2)) : 0;
      case 'cellV': return cell.h > 0 ? (y / (cell.h / 2)) : 0;
      case 'cellHash': return cell.hash;
      case 'cellRand': return cell.rand;
      case 'cellParity': return cell.parity;
      case 'cellShape': return cellShapeDist(PS(node, 'kind', 'rect'), x, y, cell.w, cell.h, node);
      case 'vine': {
        var data = vinePrep(node);
        var w0 = P(node, 'w0', 1.5), w1 = P(node, 'w1', 0.6);
        var best = -1e9;
        for (var si = 0; si < data.segs.length; si++) {
          var sg = data.segs[si];
          var frac = (sg[4] * P(node, 'step', 4)) / data.total;
          var hw2 = w0 + (w1 - w0) * Math.min(1, frac);
          var dd2 = sdSegmentB(x, y, sg[0], sg[1], sg[2], sg[3]);
          if (hw2 - dd2 > best) best = hw2 - dd2;
        }
        for (var li = 0; li < data.leaves.length; li++) {
          var lf = data.leaves[li];
          var ld = lf[2] - Math.hypot(x - lf[0], y - lf[1]);
          if (ld > best) best = ld;
        }
        return best;
      }
      case 'len': return Math.hypot(IN(node, 'a', x, y, env, cache), IN(node, 'b', x, y, env, cache));
      case 'add': return IN(node, 'a', x, y, env, cache) + IN(node, 'b', x, y, env, cache);
      case 'sub': return IN(node, 'a', x, y, env, cache) - IN(node, 'b', x, y, env, cache);
      case 'mul': return IN(node, 'a', x, y, env, cache) * IN(node, 'b', x, y, env, cache);
      case 'min': return Math.min(IN(node, 'a', x, y, env, cache), IN(node, 'b', x, y, env, cache));
      case 'max': return Math.max(IN(node, 'a', x, y, env, cache), IN(node, 'b', x, y, env, cache));
      case 'invert': return 1 - IN(node, 'in', x, y, env, cache);
      case 'abs': return Math.abs(IN(node, 'in', x, y, env, cache));
      case 'clamp': return Math.max(P(node, 'lo', 0), Math.min(P(node, 'hi', 1), IN(node, 'in', x, y, env, cache)));
      case 'mix': {
        var t = IN(node, 't', x, y, env, cache);
        return IN(node, 'a', x, y, env, cache) * (1 - t) + IN(node, 'b', x, y, env, cache) * t;
      }
      case 'threshold': {
        var tv = IN(node, 'in', x, y, env, cache);
        var at = P(node, 'at', 0.5), soft = P(node, 'soft', 0);
        if (soft <= 0) return tv >= at ? 1 : 0;
        var tt = Math.max(0, Math.min(1, (tv - (at - soft)) / (2 * soft)));
        return tt * tt * (3 - 2 * tt);
      }
      case 'levelBand': {
        var lv = IN(node, 'in', x, y, env, cache);
        return Math.max(0, 1 - Math.abs(lv - P(node, 'level', 0)) / Math.max(0.01, P(node, 'w', 1)));
      }
      case 'remap': {
        var rv = IN(node, 'in', x, y, env, cache);
        var rlo = P(node, 'lo', 0), rhi = P(node, 'hi', 1);
        var rn = Math.max(0, Math.min(1, (rv - rlo) / Math.max(0.01, rhi - rlo)));
        rn = Math.pow(rn, Math.max(0.05, P(node, 'gamma', 1)));
        var steps = Math.round(P(node, 'steps', 0));
        if (steps > 1) rn = Math.round(rn * (steps - 1)) / (steps - 1);
        return rn;
      }
      case 'blur': {
        var br = Math.max(0.4, P(node, 'r', 1));
        var bc2 = node.inputs ? byId.get(node.inputs.in) : undefined;
        if (!bc2) return 0;
        return (ev(bc2, x, y, env, null) + ev(bc2, x - br, y, env, null) + ev(bc2, x + br, y, env, null)
          + ev(bc2, x, y - br, env, null) + ev(bc2, x, y + br, env, null)) / 5;
      }
      case 'fadeEdge': {
        // 不分离：图案在形状边界按带符号距离淡出
        var fw = Math.max(0.2, P(node, 'w', 2));
        return IN(node, 'in', x, y, env, cache) * Math.max(0, Math.min(1, base.sd / fw));
      }
      case 'mirror': {
        var mat = P(node, 'at', 0);
        var mx = x, my = y;
        if (PS(node, 'axis', 'x') === 'x') mx = mat - Math.abs(x - mat);
        else my = mat - Math.abs(y - mat);
        var mch = node.inputs ? byId.get(node.inputs.in) : undefined;
        return mch ? ev(mch, mx, my, env, null) : 0;
      }
      case 'rotate': {
        var rdeg = P(node, 'deg', 45) * Math.PI / 180;
        var rc = Math.cos(rdeg), rs = Math.sin(rdeg);
        var rch2 = node.inputs ? byId.get(node.inputs.in) : undefined;
        return rch2 ? ev(rch2, x * rc - y * rs, x * rs + y * rc, env, null) : 0;
      }
      case 'scroll': {
        // 流动：子图在「坐标 − 相位×每圈位移」处求值；位移取图案
        // 自身周期整数倍时相位 1 与相位 0 逐像素一致（无缝循环）。
        var sdx = P(node, 'dx', 0), sdy = P(node, 'dy', 0);
        var sch = node.inputs ? byId.get(node.inputs.in) : undefined;
        var sph = env.phase || 0;
        return sch ? ev(sch, x - sph * sdx, y - sph * sdy, env, null) : 0;
      }
      case 'overlay2': {
        // 回声/尺度层级：同一子场在缩放坐标再求值一次，按权重取大叠印
        var ok = P(node, 'k', 2.2), ow = P(node, 'w', 0.8);
        var och = node.inputs ? byId.get(node.inputs.in) : undefined;
        if (!och) return 0;
        var o1 = ev(och, x, y, env, null);
        var o2 = ev(och, x * ok, y * ok, env, null) * ow;
        return Math.max(o1, o2);
      }
      case 'focal': {
        var fcx = P(node, 'cx', 0), fcy = P(node, 'cy', 0);
        var fd = Math.hypot(x - fcx, y - fcy);
        var fr2 = Math.max(0.5, P(node, 'r', 8));
        if (PS(node, 'mode', 'spot') === 'ring') {
          return Math.max(0, 1 - Math.abs(fd - fr2) / Math.max(0.3, P(node, 'w', 1.5)));
        }
        var ft = Math.max(0, 1 - fd / fr2);
        return ft * ft;
      }
      case 'voidF': {
        var vcx = P(node, 'cx', 0), vcy = P(node, 'cy', 0);
        var vd = Math.hypot(x - vcx, y - vcy);
        var vr = P(node, 'r', 8), vsoft = Math.max(0.5, P(node, 'soft', 3));
        return Math.max(0, Math.min(1, (vd - (vr - vsoft)) / (2 * vsoft)));
      }
      case 'edgeProx': return Math.max(0, Math.min(1, 1 - base.sd / Math.max(0.3, P(node, 'w', 3))));
      case 'weave': {
        var wcw = Math.max(1, P(node, 'cw', 5)), wch = Math.max(1, P(node, 'ch', 5));
        var wpar = Math.abs(Math.floor(x / wcw) + Math.floor(y / wch)) % 2;
        var wv = wpar === 1 ? IN(node, 'b', x, y, env, cache) : IN(node, 'a', x, y, env, cache);
        return wv * (wpar === 1 ? 0.8 : 1);
      }
      case 'warp': {
        var wfx = IN(node, 'fx', x, y, env, cache) - 0.5;
        var wfy = IN(node, 'fy', x, y, env, cache) - 0.5;
        var amp = P(node, 'amp', 3);
        var child = node.inputs ? byId.get(node.inputs.in) : undefined;
        return child ? ev(child, x + wfx * 2 * amp, y + wfy * 2 * amp, env, null) : 0;
      }
      case 'repeat': {
        var rcw = Math.max(1, P(node, 'cw', 8)), rch = Math.max(1, P(node, 'ch', 8));
        var alt = P(node, 'alt', 0);
        var row = Math.floor(y / rch + 0.5);
        var parity = Math.abs(row) % 2;
        var shift = parity * alt * rcw;
        var col = Math.floor((x + shift) / rcw + 0.5);
        var lx = ((x + shift) / rcw + 0.5) % 1; lx = (lx - Math.floor(lx) - 0.5) * rcw;
        var ly = ((y / rch + 0.5) % 1); ly = (ly - Math.floor(ly) - 0.5) * rch;
        var rseed = P(node, 'seed', 0);
        var cell2 = {
          w: rcw, h: rch, row: row, col: col, parity: parity,
          hash: hashN(col, row, rseed), rand: hashN(col, row, rseed + 77),
        };
        // 粗糙度：每单元位置/旋转抖动（哈希驱动，确定性）
        var jit = P(node, 'jit', 0);
        if (jit > 0) {
          lx += (hashN(col, row, rseed + 101) - 0.5) * 2 * jit;
          ly += (hashN(col, row, rseed + 131) - 0.5) * 2 * jit;
        }
        var rotj = P(node, 'rot', 0);
        if (rotj > 0) {
          var ra = (hashN(col, row, rseed + 202) - 0.5) * 2 * rotj;
          var rc2 = Math.cos(ra), rs2 = Math.sin(ra);
          var tx = lx * rc2 - ly * rs2, ty = lx * rs2 + ly * rc2;
          lx = tx; ly = ty;
        }
        // 奇偶旋转（人字纹）：(行+列) 为奇数的单元整体转 prot 度
        var prot = P(node, 'prot', 0);
        if (prot !== 0 && Math.abs(row + col) % 2 === 1) {
          var pa = prot * Math.PI / 180;
          var pc = Math.cos(pa), ps = Math.sin(pa);
          var px2 = lx * pc - ly * ps, py2 = lx * ps + ly * pc;
          lx = px2; ly = py2;
        }
        // 交替重复 AB：奇偶行用 B 程序（Alexander 交替重复的完整式）
        var child2 = node.inputs ? byId.get(node.inputs.in) : undefined;
        if (parity === 1 && node.inputs && node.inputs.b) child2 = byId.get(node.inputs.b);
        return child2 ? ev(child2, lx, ly, { base: base, cell: cell2, phase: env.phase || 0, maxRad: env.maxRad }, null) : 0;
      }
      case 'repeatPolar': {
        var seg = Math.max(2, Math.round(P(node, 'seg', 8)));
        var ang = Math.atan2(y, x);
        var a01 = (ang / (2 * Math.PI) + 0.5);
        var segi = Math.floor(a01 * seg);
        var la = ((a01 * seg) % 1) * 2 - 1;
        var rad = Math.hypot(x, y);
        // 单元局部系与 repeat 对齐：横向居中、纵向按径向跨度
        // [r0, 形状外接半径] 居中——旧实现纵向 0 基（rad−r0），
        // cellShape 的居中假设落空，花瓣/齿形只剩中心一点能画
        var r0p = P(node, 'r0', 0);
        var span = Math.max(1, (env.maxRad || 30) - r0p);
        var cell3 = {
          w: P(node, 'arcW', 6), h: span, row: segi, col: 0, parity: Math.abs(segi) % 2,
          hash: hashN(segi, 3, P(node, 'seed', 0)), rand: hashN(segi, 9, P(node, 'seed', 0) + 41),
        };
        var child3 = node.inputs ? byId.get(node.inputs.in) : undefined;
        return child3 ? ev(child3, la * P(node, 'arcW', 6) / 2, (rad - r0p) - span / 2, { base: base, cell: cell3, phase: env.phase || 0, maxRad: env.maxRad }, null) : 0;
      }
    }
    return 0;
  }

  var hasGlint = graph.writes.some(function (w) { return w.ch === 'glint'; });
  return {
    hasGlint: hasGlint,
    evaluate: function (lx, ly, base) {
      var env = { base: base, cell: defaultCell(), phase: phaseN, maxRad: shapeMaxRad };
      var slot = 2, glint = false;
      var cache = new Map();
      for (var i = 0; i < graph.writes.length; i++) {
        var w = graph.writes[i];
        var node = byId.get(w.from);
        if (!node) continue;
        var v = ev(node, lx, ly, env, cache);
        if (w.bump) {
          var bv = Math.max(0, Math.min(1, v));
          slot = bv > 0.66 ? w.bump.hi : bv > 0.33 ? w.bump.mid : w.bump.lo;
        } else if (v >= (w.at !== undefined ? w.at : 0.5)) {
          if (w.ch === 'glint') glint = true;
          else slot = w.slot;
        }
      }
      return { slot: slot, glint: glint };
    },
    // 轮廓外延专用：只认图案/glint 写出的命中（bump 不向外画），
    // 返回 hit 供烘焙器把外圈写出编码进 B 通道。
    evaluateOutside: function (lx, ly, base) {
      var env = { base: base, cell: defaultCell(), phase: phaseN, maxRad: shapeMaxRad };
      var slot = 2, glint = false, hit = false;
      var cache = new Map();
      for (var i = 0; i < graph.writes.length; i++) {
        var w = graph.writes[i];
        if (w.bump) continue;
        var node = byId.get(w.from);
        if (!node) continue;
        var v = ev(node, lx, ly, env, cache);
        if (v >= (w.at !== undefined ? w.at : 0.5)) {
          hit = true;
          if (w.ch === 'glint') glint = true;
          else slot = w.slot;
        }
      }
      return { slot: slot, glint: glint, hit: hit };
    },
  };
}

function compileTileDAG(shape, graph, halo, phase) {
  var haloW = Math.max(0, Math.floor(halo || 0));
  var M = 2 + haloW;
  var w = Math.ceil(shape.size[0]) + M * 2;
  var h = Math.ceil(shape.size[1]) + M * 2;
  var cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  var compiled = compileSurfaceGraph(graph, shape, phase);
  var fields = new Array(w * h);
  var maxD = 0.0001;
  for (var j = 0; j < h; j++) {
    for (var i = 0; i < w; i++) {
      var lx = i - cx, ly = j - cy;
      var f0 = shapeFieldDAG(shape, lx, ly);
      var gx = shapeFieldDAG(shape, lx + 1, ly).d - shapeFieldDAG(shape, lx - 1, ly).d;
      var gy = shapeFieldDAG(shape, lx, ly + 1).d - shapeFieldDAG(shape, lx, ly - 1).d;
      fields[j * w + i] = { lx: lx, ly: ly, inside: f0.inside, d: f0.d, gx: gx, gy: gy };
      if (f0.inside) maxD = Math.max(maxD, f0.d);
    }
  }
  var data = new Uint8Array(w * h * 4);
  for (var j2 = 0; j2 < h; j2++) {
    for (var i2 = 0; i2 < w; i2++) {
      var f = fields[j2 * w + i2];
      var o = (j2 * w + i2) * 4;
      data[o + 3] = 255;
      var base = {
        inside: f.inside, d: f.d, sd: f.inside ? f.d : -f.d,
        gx: f.gx, gy: f.gy, h: f.inside ? f.d / maxD : 0,
        u01: shape.size[0] > 0 ? (f.lx + shape.size[0] / 2) / shape.size[0] : 0.5,
        v01: shape.size[1] > 0 ? (f.ly + shape.size[1] / 2) / shape.size[1] : 0.5,
      };
      var occ = f.inside || f.d <= 0.5;
      if (!occ) {
        data[o] = f.d <= 1.5 ? 254 : 255;
        data[o + 1] = 255;
        if (haloW > 0 && f.d <= haloW) {
          var ro = compiled.evaluateOutside(f.lx, f.ly, base);
          if (ro.hit) data[o + 2] = (ro.glint ? 16 : 0) + ro.slot + 1;
        }
        continue;
      }
      var r = compiled.evaluate(f.lx, f.ly, base);
      data[o] = r.slot;
      data[o + 1] = compiled.hasGlint ? (r.glint ? 255 : 0) : 255;
    }
  }
  return { w: w, h: h, cx: cx, cy: cy, data: data };
}
// ---- 层程序烘焙（主画布适配用；语义与模板 PURE 的 compileTile 逐项一致，
// 形状场共用 shapeFieldDAG（与 PURE shapeField 同公式），mask/bump 为移植） ----
function maskHitB(mask, ctx) {
  switch (mask.m) {
    case 'all': return true;
    case 'inside': return ctx.inside;
    case 'edge': return ctx.d <= mask.w;
    case 'band': return ctx.d > mask.w0 && ctx.d <= mask.w1;
    case 'bands': {
      var v = mask.axis === 'x' ? ctx.px : mask.axis === 'y' ? ctx.py : ctx.px + ctx.py * 0.35;
      var f = ((v / mask.f + (mask.ph !== undefined && mask.ph !== null ? mask.ph : 0)) % 1 + 1) % 1;
      return f < (mask.duty !== undefined && mask.duty !== null ? mask.duty : 0.5);
    }
    case 'checker': {
      var cx2 = Math.floor(ctx.px / mask.f), cy2 = Math.floor(ctx.py / mask.f);
      return ((cx2 + cy2) % 2 + 2) % 2 === 0;
    }
    case 'noise': {
      var cx3 = Math.floor(ctx.px / mask.f), cy3 = Math.floor(ctx.py / mask.f);
      var hs = Math.sin(cx3 * 127.1 + cy3 * 311.7 + (mask.seed !== undefined && mask.seed !== null ? mask.seed : 0) * 74.7) * 43758.5453;
      hs -= Math.floor(hs);
      return hs > (mask.gt !== undefined && mask.gt !== null ? mask.gt : 0.72);
    }
    case 'gradLt': {
      var v2 = mask.axis === 'x' ? ctx.px01 : ctx.py01;
      return v2 < mask.t;
    }
    case 'facing': {
      if (ctx.d > (mask.w !== undefined && mask.w !== null ? mask.w : 1.6)) return false;
      var deg = (Math.atan2(ctx.gy, ctx.gx) * 180) / Math.PI;
      var diff = Math.abs(((deg - mask.deg) % 360 + 540) % 360 - 180);
      return diff <= (mask.tol !== undefined && mask.tol !== null ? mask.tol : 55);
    }
  }
  return false;
}
function bumpValueB(form, ctx) {
  var cl = function (v) { return Math.max(0, Math.min(1, v)); };
  switch (form) {
    case 'dome': return cl(ctx.h);
    case 'top': return cl(0.30 + 0.45 * ctx.h + 0.25 * ctx.gy);
    case 'side': return cl(0.30 + 0.45 * ctx.h + 0.25 * ctx.gx);
    case 'edge': return cl(1 - ctx.h);
  }
  return 0;
}
function compileTileLayers(shape, program, halo) {
  var haloW = Math.max(0, Math.floor(halo || 0));
  var M = 2 + haloW;
  var w = Math.ceil(shape.size[0]) + M * 2;
  var h = Math.ceil(shape.size[1]) + M * 2;
  var cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  var hasGlint = program.some(function (l) { return l.ch === 'glint'; });
  var fields = new Array(w * h);
  var maxD = 0.0001;
  for (var j = 0; j < h; j++) {
    for (var i = 0; i < w; i++) {
      var lx = i - cx, ly = j - cy;
      var f0 = shapeFieldDAG(shape, lx, ly);
      var gx = shapeFieldDAG(shape, lx + 1, ly).d - shapeFieldDAG(shape, lx - 1, ly).d;
      var gy = shapeFieldDAG(shape, lx, ly + 1).d - shapeFieldDAG(shape, lx, ly - 1).d;
      fields[j * w + i] = { lx: lx, ly: ly, inside: f0.inside, d: f0.d, gx: gx, gy: gy };
      if (f0.inside) maxD = Math.max(maxD, f0.d);
    }
  }
  var data = new Uint8Array(w * h * 4);
  for (var j2 = 0; j2 < h; j2++) {
    for (var i2 = 0; i2 < w; i2++) {
      var f = fields[j2 * w + i2];
      var o = (j2 * w + i2) * 4;
      data[o + 3] = 255;
      var ctx = {
        px: f.lx, py: f.ly,
        px01: shape.size[0] > 0 ? (f.lx + shape.size[0] / 2) / shape.size[0] : 0.5,
        py01: shape.size[1] > 0 ? (f.ly + shape.size[1] / 2) / shape.size[1] : 0.5,
        inside: f.inside, d: f.d, gx: f.gx, gy: f.gy,
        h: f.inside ? f.d / maxD : 0,
      };
      var occ = f.inside || f.d <= 0.5;
      if (!occ) {
        data[o] = f.d <= 1.5 ? 254 : 255;
        data[o + 1] = 255;
        if (haloW > 0 && f.d <= haloW) {
          var oSlot = 2, oGlint = false, oHit = false;
          for (var oi = 0; oi < program.length; oi++) {
            var ol = program[oi];
            if (ol.bumpForm) continue;
            if (!maskHitB(ol.mask, ctx)) continue;
            oHit = true;
            if (ol.ch === 'glint') oGlint = true;
            else oSlot = ol.slot;
          }
          if (oHit) data[o + 2] = (oGlint ? 16 : 0) + oSlot + 1;
        }
        continue;
      }
      var slot = 2, g = hasGlint ? 0 : 255;
      for (var li = 0; li < program.length; li++) {
        var layer = program[li];
        if (layer.bumpForm) {
          var bv = bumpValueB(layer.bumpForm, ctx);
          slot = bv > 0.66 ? layer.hi : bv > 0.33 ? layer.mid : layer.lo;
          continue;
        }
        if (!maskHitB(layer.mask, ctx)) continue;
        if (layer.ch === 'glint') g = 255;
        else slot = layer.slot;
      }
      data[o] = slot;
      data[o + 1] = g;
    }
  }
  return { w: w, h: h, cx: cx, cy: cy, data: data };
}
// ---- 精灵栅格烘焙（合成方式 silhouette/overlay 用）：基础量改从精灵的
// 透明掩码算，模式图/层程序与写出规则与形状版完全共用。
// raster = { w, h, plugX, plugY, solid }：solid 为行优先 0/1（产品空间
// 自上而下），plug 为像素浮点坐标（产品空间）。
// 距离 d = 到最近异类像素的距离（两遍 chamfer 近似，权 1/√2）；occ 恒
// 等于 solid（d 最小正值为 1，occ 的 d<=0.5 分支不触发）；254 外环 =
// d<=1.5 的外侧邻域，与形状版同口径。
// 坐标约定与形状版一致（烘焙空间 y 向上）：源行进场时垂直翻转，着色段
// 统一翻回；lx/ly 以 plug 为原点，u01/v01 为图内相对位置（v 自下而上）。
function chamferDistB(seed, w, h) {
  var INF = 1e9, SQ2 = Math.SQRT2;
  var d = new Float64Array(w * h);
  var i, x, y, idx, v;
  for (i = 0; i < w * h; i++) d[i] = seed[i] ? 0 : INF;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    idx = y * w + x; if (d[idx] === 0) continue;
    v = d[idx];
    if (x > 0) v = Math.min(v, d[idx - 1] + 1);
    if (y > 0) v = Math.min(v, d[idx - w] + 1);
    if (x > 0 && y > 0) v = Math.min(v, d[idx - w - 1] + SQ2);
    if (x < w - 1 && y > 0) v = Math.min(v, d[idx - w + 1] + SQ2);
    d[idx] = v;
  }
  for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
    idx = y * w + x; if (d[idx] === 0) continue;
    v = d[idx];
    if (x < w - 1) v = Math.min(v, d[idx + 1] + 1);
    if (y < h - 1) v = Math.min(v, d[idx + w] + 1);
    if (x < w - 1 && y < h - 1) v = Math.min(v, d[idx + w + 1] + SQ2);
    if (x > 0 && y < h - 1) v = Math.min(v, d[idx + w - 1] + SQ2);
    d[idx] = v;
  }
  return d;
}
function rasterFieldGridB(raster, haloW) {
  var M = 2 + (haloW || 0);
  var rw = raster.w, rh = raster.h;
  var w = rw + M * 2, h = rh + M * 2;
  var solidT = new Uint8Array(w * h);
  var sx, sy;
  for (sy = 0; sy < rh; sy++) {
    var ty = rh - 1 - sy;
    for (sx = 0; sx < rw; sx++) {
      if (raster.solid[sy * rw + sx]) solidT[(ty + M) * w + (sx + M)] = 1;
    }
  }
  var dOut = chamferDistB(solidT, w, h);
  var inv = new Uint8Array(w * h);
  for (var k = 0; k < w * h; k++) inv[k] = solidT[k] ? 0 : 1;
  var dIn = chamferDistB(inv, w, h);
  var fields = new Array(w * h);
  var maxD = 0.0001;
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
    var idx = j * w + i;
    var inside = solidT[idx] === 1;
    var dd = inside ? dIn[idx] : dOut[idx];
    fields[idx] = {
      lx: (i - M) - raster.plugX,
      ly: raster.plugY - (rh - 1 - (j - M)),
      inside: inside, d: dd, gx: 0, gy: 0, sx: i - M, syB: j - M,
    };
    if (inside && dd > maxD) maxD = dd;
  }
  for (var j2 = 0; j2 < h; j2++) for (var i2 = 0; i2 < w; i2++) {
    var f = fields[j2 * w + i2];
    f.gx = fields[j2 * w + Math.min(w - 1, i2 + 1)].d - fields[j2 * w + Math.max(0, i2 - 1)].d;
    f.gy = fields[Math.min(h - 1, j2 + 1) * w + i2].d - fields[Math.max(0, j2 - 1) * w + i2].d;
  }
  return { w: w, h: h, fields: fields, maxD: maxD, rw: rw, rh: rh };
}
function compileTileDAGRaster(raster, graph, halo, phase) {
  var haloW = Math.max(0, Math.floor(halo || 0));
  var g = rasterFieldGridB(raster, haloW);
  var w = g.w, h = g.h;
  var fakeShape = { kind: 'rect', size: [g.rw, g.rh] };
  var compiled = compileSurfaceGraph(graph, fakeShape, phase);
  var data = new Uint8Array(w * h * 4);
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
    var f = g.fields[j * w + i];
    var o = (j * w + i) * 4;
    data[o + 3] = 255;
    var base = {
      inside: f.inside, d: f.d, sd: f.inside ? f.d : -f.d,
      gx: f.gx, gy: f.gy, h: f.inside ? f.d / g.maxD : 0,
      u01: g.rw > 0 ? (f.sx + 0.5) / g.rw : 0.5,
      v01: g.rh > 0 ? (f.syB + 0.5) / g.rh : 0.5,
    };
    var occ = f.inside || f.d <= 0.5;
    if (!occ) {
      data[o] = f.d <= 1.5 ? 254 : 255;
      data[o + 1] = 255;
      if (haloW > 0 && f.d <= haloW) {
        var ro = compiled.evaluateOutside(f.lx, f.ly, base);
        if (ro.hit) data[o + 2] = (ro.glint ? 16 : 0) + ro.slot + 1;
      }
      continue;
    }
    var r = compiled.evaluate(f.lx, f.ly, base);
    data[o] = r.slot;
    data[o + 1] = compiled.hasGlint ? (r.glint ? 255 : 0) : 255;
  }
  return { w: w, h: h, cx: Math.floor(w / 2), cy: Math.floor(h / 2), data: data };
}
function compileTileLayersRaster(raster, program, halo) {
  var haloW = Math.max(0, Math.floor(halo || 0));
  var g = rasterFieldGridB(raster, haloW);
  var w = g.w, h = g.h;
  var hasGlint = program.some(function (l) { return l.ch === 'glint'; });
  var data = new Uint8Array(w * h * 4);
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
    var f = g.fields[j * w + i];
    var o = (j * w + i) * 4;
    data[o + 3] = 255;
    var ctx = {
      px: f.lx, py: f.ly,
      px01: g.rw > 0 ? (f.sx + 0.5) / g.rw : 0.5,
      py01: g.rh > 0 ? (f.syB + 0.5) / g.rh : 0.5,
      inside: f.inside, d: f.d, gx: f.gx, gy: f.gy,
      h: f.inside ? f.d / g.maxD : 0,
    };
    var occ = f.inside || f.d <= 0.5;
    if (!occ) {
      data[o] = f.d <= 1.5 ? 254 : 255;
      data[o + 1] = 255;
      if (haloW > 0 && f.d <= haloW) {
        var oSlot = 2, oGlint = false, oHit = false;
        for (var oi = 0; oi < program.length; oi++) {
          var ol = program[oi];
          if (ol.bumpForm) continue;
          if (!maskHitB(ol.mask, ctx)) continue;
          oHit = true;
          if (ol.ch === 'glint') oGlint = true;
          else oSlot = ol.slot;
        }
        if (oHit) data[o + 2] = (oGlint ? 16 : 0) + oSlot + 1;
      }
      continue;
    }
    var slot = 2, gl = hasGlint ? 0 : 255;
    for (var li = 0; li < program.length; li++) {
      var layer = program[li];
      if (layer.bumpForm) {
        var bv = bumpValueB(layer.bumpForm, ctx);
        slot = bv > 0.66 ? layer.hi : bv > 0.33 ? layer.mid : layer.lo;
        continue;
      }
      if (!maskHitB(layer.mask, ctx)) continue;
      if (layer.ch === 'glint') gl = 255;
      else slot = layer.slot;
    }
    data[o] = slot;
    data[o + 1] = gl;
  }
  return { w: w, h: h, cx: Math.floor(w / 2), cy: Math.floor(h / 2), data: data };
}

`;

/** 探针/测试用：加载同一份烘焙源 */
export function createSurfaceBaker(): {
  compileTileDAG: (
    shape: { kind: string; size: [number, number]; roundness?: number; points?: [number, number][]; pivot?: [number, number] },
    graph: unknown,
    halo?: number,
    phase?: number,
  ) => { w: number; h: number; cx: number; cy: number; data: Uint8Array };
  compileTileLayers: (
    shape: { kind: string; size: [number, number]; roundness?: number; points?: [number, number][]; pivot?: [number, number] },
    program: unknown,
    halo?: number,
  ) => { w: number; h: number; cx: number; cy: number; data: Uint8Array };
  compileTileDAGRaster: (
    raster: { w: number; h: number; plugX: number; plugY: number; solid: ArrayLike<number> },
    graph: unknown,
    halo?: number,
    phase?: number,
  ) => { w: number; h: number; cx: number; cy: number; data: Uint8Array };
  compileTileLayersRaster: (
    raster: { w: number; h: number; plugX: number; plugY: number; solid: ArrayLike<number> },
    program: unknown,
    halo?: number,
  ) => { w: number; h: number; cx: number; cy: number; data: Uint8Array };
} {
  const factory = new Function(`${BAKE_SRC}\nreturn { compileTileDAG, compileTileLayers, compileTileDAGRaster, compileTileLayersRaster };`);
  return factory() as never;
}
