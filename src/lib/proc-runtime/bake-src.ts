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
function sdSegment(px, py, ax, ay, bx, by) {
  var pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  var h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}
function pointInPolygon(px, py, pts) {
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
      d = Math.min(d, sdSegment(px, py, a[0], a[1], b[0], b[1]));
    }
    return { inside: rel.length >= 3 ? pointInPolygon(px, py, rel) : false, d: d };
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
function compileSurfaceGraph(graph, shape) {
  var gparams = graph.params || {};
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
          var dd2 = sdSegment(x, y, sg[0], sg[1], sg[2], sg[3]);
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
        var cell2 = {
          w: rcw, h: rch, row: row, col: col, parity: parity,
          hash: hashN(col, row, P(node, 'seed', 0)), rand: hashN(col, row, P(node, 'seed', 0) + 77),
        };
        var child2 = node.inputs ? byId.get(node.inputs.in) : undefined;
        return child2 ? ev(child2, lx, ly, { base: base, cell: cell2 }, null) : 0;
      }
      case 'repeatPolar': {
        var seg = Math.max(2, Math.round(P(node, 'seg', 8)));
        var ang = Math.atan2(y, x);
        var a01 = (ang / (2 * Math.PI) + 0.5);
        var segi = Math.floor(a01 * seg);
        var la = ((a01 * seg) % 1) * 2 - 1;
        var rad = Math.hypot(x, y);
        var cell3 = {
          w: P(node, 'arcW', 6), h: Math.max(1, rad), row: segi, col: 0, parity: Math.abs(segi) % 2,
          hash: hashN(segi, 3, P(node, 'seed', 0)), rand: hashN(segi, 9, P(node, 'seed', 0) + 41),
        };
        var child3 = node.inputs ? byId.get(node.inputs.in) : undefined;
        return child3 ? ev(child3, la * P(node, 'arcW', 6) / 2, rad - P(node, 'r0', 0), { base: base, cell: cell3 }, null) : 0;
      }
    }
    return 0;
  }

  var hasGlint = graph.writes.some(function (w) { return w.ch === 'glint'; });
  return {
    hasGlint: hasGlint,
    evaluate: function (lx, ly, base) {
      var env = { base: base, cell: defaultCell() };
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
  };
}

function compileTileDAG(shape, graph) {
  var M = 2;
  var w = Math.ceil(shape.size[0]) + M * 2;
  var h = Math.ceil(shape.size[1]) + M * 2;
  var cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  var compiled = compileSurfaceGraph(graph, shape);
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
      var occ = f.inside || f.d <= 0.5;
      if (!occ) {
        data[o] = f.d <= 1.5 ? 254 : 255;
        data[o + 1] = 255;
        continue;
      }
      var base = {
        inside: f.inside, d: f.d, sd: f.inside ? f.d : -f.d,
        gx: f.gx, gy: f.gy, h: f.inside ? f.d / maxD : 0,
        u01: shape.size[0] > 0 ? (f.lx + shape.size[0] / 2) / shape.size[0] : 0.5,
        v01: shape.size[1] > 0 ? (f.ly + shape.size[1] / 2) / shape.size[1] : 0.5,
      };
      var r = compiled.evaluate(f.lx, f.ly, base);
      data[o] = r.slot;
      data[o + 1] = compiled.hasGlint ? (r.glint ? 255 : 0) : 255;
    }
  }
  return { w: w, h: h, cx: cx, cy: cy, data: data };
}
`;

/** 探针/测试用：加载同一份烘焙源 */
export function createSurfaceBaker(): {
  compileTileDAG: (
    shape: { kind: string; size: [number, number]; roundness?: number; points?: [number, number][]; pivot?: [number, number] },
    graph: unknown,
  ) => { w: number; h: number; cx: number; cy: number; data: Uint8Array };
} {
  const factory = new Function(`${BAKE_SRC}\nreturn { compileTileDAG };`);
  return factory() as never;
}
