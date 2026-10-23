// ============================================================
// 运行时求值器（单一源）：以 JS 源码字符串形式保存，同一份代码
// ① 嵌进导出的运行时模板（浏览器里跑）② 被探针加载校验语义。
// 语义与产品 src/lib/blueprint/eval.ts 的求值器逐节点对齐（秒基时间：
//   time 节点与一切周期/时长参数以秒计，phase 变量以圈数计、
// 参数回退顺序：连边 > 字面输入 > params > 内置默认；gate<0.5 输出空；
// 节点失败不拖垮整图）。差异只在边界：无像素、无 IK、无 gait/expression
// （方言表点名不支持），nodeRef 读 ctx.nodeOutputs（上一遍求值结果）。
//
// 迷你图格式 v2：
//   值节点 { id, type, params?, inputs?: { [port]: {n, o?} | {v} } }
//   曲线节点 { id, type: 'curve', points: [[u, v], ...] }（表演采样产物，读 ctx.u）
//   输出节点 { id, type: 'transform', part, units: 'main'|'runtime',
//              angleFrom?/dxFrom?/dyFrom?: {n, o?} }
//   units='main'：通道值为主系统单位（角度=度、y 向下）→ 内部换算；
//   units='runtime'：已换算（弧度、y 向上），直通。
// evalRuntimeGraph(graph, ctx) → Map<part, {angle, dx, dy}>（运行时单位）
//   ctx: { u?, tSec?, vars?, nodeState?: Map, nodeOutputs?: Map,
//          statePrefix?: string }
//   time 节点输出 ctx.tSec（秒）：行为图为行为时钟秒、表演为表演已播秒。
// ============================================================

export const RUNTIME_EVAL_SRC = `
function evalRuntimeGraph(graph, ctx) {
  ctx = ctx || {};
  var vars = ctx.vars || {};
  var nodeState = ctx.nodeState || new Map();
  var nodeOutputs = ctx.nodeOutputs || new Map();
  var statePrefix = ctx.statePrefix || '';
  var nodes = (graph && graph.nodes) || [];
  var byId = new Map();
  for (var ni = 0; ni < nodes.length; ni++) byId.set(nodes[ni].id, nodes[ni]);
  var memo = new Map();
  var visiting = new Set();

  function timeValue() { return ctx.tSec || 0; }

  function nodeValue(id) {
    if (memo.has(id)) return memo.get(id);
    var node = byId.get(id);
    if (!node) return {};
    if (visiting.has(id)) return {};
    visiting.add(id);
    var out = {};
    try { out = evalNode(node) || {}; } catch (e) { out = {}; }
    visiting.delete(id);
    memo.set(id, out);
    return out;
  }

  // 输入解析（与主系统同序）：连边（缺输出→0）> 字面 > params > 调用方默认
  function P(node, port, dflt) {
    var inputs = node.inputs || {};
    if (Object.prototype.hasOwnProperty.call(inputs, port)) {
      var inp = inputs[port];
      if (inp && inp.n !== undefined) {
        var src = nodeValue(inp.n);
        var v = src[inp.o || 'out'];
        return v === undefined ? 0 : v;
      }
      if (inp && inp.v !== undefined) return inp.v;
      return dflt;
    }
    if (node.params && node.params[port] !== undefined) return node.params[port];
    return dflt;
  }
  function PN(node, port, dflt) { var v = P(node, port, dflt); var x = Number(v); return isFinite(x) ? x : dflt; }

  function cubicBezier(x, x1, y1, x2, y2) {
    var t = x;
    for (var i = 0; i < 8; i++) {
      var cx = 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
      var dx = 3 * x1 * (1 - t) * (1 - t) + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
      if (Math.abs(dx) < 1e-6) break;
      var diff = cx - x;
      t -= diff / dx;
      t = Math.max(0, Math.min(1, t));
      if (Math.abs(diff) < 1e-6) break;
    }
    return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
  }

  function evalNode(node) {
    // gate 输入 < 0.5 → 输出空（与主系统一致）
    if (node.inputs && Object.prototype.hasOwnProperty.call(node.inputs, 'gate')) {
      if (PN(node, 'gate', 1) < 0.5) return {};
    }
    var prm = node.params || {};
    switch (node.type) {
      case 'time': return { out: timeValue() };
      case 'timeGate': {
        var t = PN(node, 't', timeValue());
        var start = Number(prm.start !== undefined ? prm.start : -1);
        var end = Number(prm.end !== undefined ? prm.end : -1);
        var fadeIn = Math.max(0, Number(prm.fadeIn || 0));
        var fadeOut = Math.max(0, Number(prm.fadeOut || 0));
        if (start >= 0 && t < start) return { out: 0 };
        if (end >= 0 && t > end) return { out: 0 };
        var w = 1;
        if (start >= 0 && fadeIn > 0 && t < start + fadeIn) { var x1 = (t - start) / fadeIn; w *= x1 * x1 * (3 - 2 * x1); }
        if (end >= 0 && fadeOut > 0 && t > end - fadeOut) { var x2 = (end - t) / fadeOut; w *= x2 * x2 * (3 - 2 * x2); }
        return { out: Math.max(0, Math.min(1, w)) };
      }
      case 'const': return { out: Number(prm.value || 0) };
      case 'var': {
        var v = vars[String(prm.name !== undefined ? prm.name : '')];
        return { out: Number(v !== undefined ? v : (prm.default !== undefined ? prm.default : 0)) };
      }
      case 'add': return { out: PN(node, 'a', 0) + PN(node, 'b', 0) };
      case 'sub': return { out: PN(node, 'a', 0) - PN(node, 'b', 0) };
      case 'mul': return { out: PN(node, 'a', 0) * PN(node, 'b', 1) };
      case 'div': { var b = PN(node, 'b', 1); return { out: b !== 0 ? PN(node, 'a', 0) / b : 0 }; }
      case 'blend': {
        var mode = String(prm.mode || 'add');
        var ba = PN(node, 'a', 0), bb = PN(node, 'b', 0);
        if (mode === 'multiply') return { out: ba * bb };
        if (mode === 'converge') {
          var bt = PN(node, 't', 0);
          var speed = Number(prm.convergeSpeed !== undefined ? prm.convergeSpeed : 0.5);
          return { out: ba + bb * Math.exp(-speed * bt) };
        }
        return { out: ba + bb };
      }
      case 'sin': return { out: Math.sin(PN(node, 'x', 0)) };
      case 'cos': return { out: Math.cos(PN(node, 'x', 0)) };
      case 'keyframes': {
        var kt = PN(node, 't', timeValue());
        var frames = [], values = [];
        try {
          frames = typeof prm.frames === 'string' ? JSON.parse(prm.frames) : (prm.frames || []);
          values = typeof prm.values === 'string' ? JSON.parse(prm.values) : (prm.values || []);
        } catch (e) { return { out: 0 }; }
        if (!frames.length || !values.length) return { out: 0 };
        if (frames.length !== values.length) return { out: Number(values[0] || 0) };
        var pairs = frames.map(function (f, idx) { return { f: Number(f), v: Number(values[idx]) }; }).sort(function (p, q) { return p.f - q.f; });
        if (kt <= pairs[0].f) return { out: pairs[0].v };
        var lastP = pairs[pairs.length - 1];
        if (kt >= lastP.f) return { out: lastP.v };
        var interp = String(prm.interpolation || 'linear');
        for (var k = 0; k < pairs.length - 1; k++) {
          var pa = pairs[k], pb = pairs[k + 1];
          if (kt >= pa.f && kt <= pb.f) {
            if (interp === 'step' || pb.f === pa.f) return { out: pa.v };
            var pp = (kt - pa.f) / (pb.f - pa.f);
            return { out: pa.v + (pb.v - pa.v) * pp };
          }
        }
        return { out: lastP.v };
      }
      case 'waveform': {
        var wt = PN(node, 't', timeValue());
        var waveform = String(prm.waveform || 'sine');
        var amplitude = Number(prm.amplitude !== undefined ? prm.amplitude : 1);
        var baseValue = Number(prm.baseValue || 0);
        var endValue = Number(prm.endValue !== undefined ? prm.endValue : 1);
        var period = Math.max(0.01, Number(prm.period !== undefined ? prm.period : 0.5));
        var phaseDeg = Number(prm.phase || 0);
        var phase = phaseDeg * Math.PI / 180;
        var damping = Number(prm.damping !== undefined ? prm.damping : 1);
        var phaseT = 2 * Math.PI * wt / period + phase;
        var value = baseValue;
        if (waveform === 'sine') value = baseValue + amplitude * Math.sin(phaseT);
        else if (waveform === 'triangle') { var tp = ((wt / period + phaseDeg / 360) % 1 + 1) % 1; value = baseValue + amplitude * (tp < 0.5 ? 4 * tp - 1 : 3 - 4 * tp); }
        else if (waveform === 'square') value = baseValue + amplitude * (Math.sin(phaseT) >= 0 ? 1 : -1);
        else if (waveform === 'sawtooth') { var sp = ((wt / period + phaseDeg / 360) % 1 + 1) % 1; value = baseValue + amplitude * (2 * sp - 1); }
        else if (waveform === 'linear_ramp') { var rp = Math.min(1, Math.max(0, wt / period)); value = baseValue + (endValue - baseValue) * rp; }
        else if (waveform === 'exponential_decay') value = endValue + (baseValue - endValue) * Math.exp(-damping * wt);
        else if (waveform === 'spring_oscillate') value = baseValue + amplitude * Math.exp(-damping * wt) * Math.cos(phaseT);
        else if (waveform === 'perlin_noise') value = baseValue + amplitude * (0.5 * Math.sin(phaseT) + 0.3 * Math.sin(phaseT * 2.7 + 1.3) + 0.2 * Math.sin(phaseT * 6.1 + 2.1));
        return { out: value };
      }
      case 'ease': {
        var ex = Math.max(0, Math.min(1, PN(node, 'x', 0)));
        return { out: cubicBezier(ex, PN(node, 'x1', Number(prm.x1 !== undefined ? prm.x1 : 0.25)), PN(node, 'y1', Number(prm.y1 !== undefined ? prm.y1 : 0.1)), PN(node, 'x2', Number(prm.x2 !== undefined ? prm.x2 : 0.25)), PN(node, 'y2', Number(prm.y2 !== undefined ? prm.y2 : 1))) };
      }
      case 'timeRemap': {
        var rt = PN(node, 't', timeValue());
        var rspeed = PN(node, 'speed', Number(prm.speed !== undefined ? prm.speed : 1));
        var roffset = PN(node, 'offset', Number(prm.offset || 0));
        var rperiod = Math.max(0, Number(prm.period || 0));
        var rout = rt * rspeed + roffset;
        var loop = prm.loop === true || prm.loop === 'true';
        if (loop && Number(prm.period || 0) > 0) rout = ((rout % rperiod) + rperiod) % rperiod;
        var pingpong = prm.pingpong === true || prm.pingpong === 'true';
        if (pingpong && Number(prm.period || 0) > 0) {
          var cycle = ((rout % (rperiod * 2)) + rperiod * 2) % (rperiod * 2);
          rout = cycle <= rperiod ? cycle : rperiod * 2 - cycle;
        }
        return { out: rout };
      }
      case 'switch': return { out: PN(node, 'condition', 0) < 0.5 ? PN(node, 'a', 0) : PN(node, 'b', 0) };
      case 'step': return { out: PN(node, 'x', 0) < PN(node, 'edge', Number(prm.edge || 0)) ? 0 : 1 };
      case 'hold': {
        var hInput = PN(node, 'input', 0);
        var hTrigger = PN(node, 'trigger', 0);
        var key = statePrefix + 'hold_' + node.id;
        var prev = nodeState.get(key);
        var prevTrigger = prev ? prev.prevTrigger : 0;
        if (prevTrigger < 0.5 && hTrigger >= 0.5) {
          nodeState.set(key, { held: hInput, prevTrigger: hTrigger });
          return { out: hInput };
        }
        if (prev) {
          nodeState.set(key, { held: prev.held, prevTrigger: hTrigger });
          return { out: prev.held };
        }
        nodeState.set(key, { held: hInput, prevTrigger: hTrigger });
        return { out: hInput };
      }
      case 'nodeRef': {
        var target = nodeOutputs.get(String(prm.nodeId !== undefined ? prm.nodeId : ''));
        if (!target) return { out: 0 };
        var ov = target[String(prm.output || 'rotation')];
        return { out: ov === undefined ? 0 : Number(ov) };
      }
      case 'pendulum': {
        var pt = PN(node, 't', timeValue());
        var pamp = PN(node, 'amplitude', Number(prm.amplitude !== undefined ? prm.amplitude : 30));
        var pperiod = Math.max(0.01, PN(node, 'period', Number(prm.period !== undefined ? prm.period : 0.267)));
        var pphase = Number(prm.phase || 0) * Math.PI / 180;
        var pv = pamp * Math.sin(2 * Math.PI * pt / pperiod + pphase);
        return { out: pv, outRotation: pv };
      }
      case 'breath': {
        var bt2 = PN(node, 't', timeValue());
        var bamp = PN(node, 'amplitude', Number(prm.amplitude !== undefined ? prm.amplitude : 0.1));
        var bperiod = Math.max(0.01, PN(node, 'period', Number(prm.period !== undefined ? prm.period : 0.8)));
        return { out: 1 + bamp * Math.sin(2 * Math.PI * bt2 / bperiod) };
      }
      case 'shake': {
        var st = PN(node, 't', timeValue());
        var samp = PN(node, 'amplitude', Number(prm.amplitude !== undefined ? prm.amplitude : 2));
        var r1 = Math.sin(st * 12.9898) * 43758.5453;
        var r2 = Math.sin(st * 78.233) * 12543.123;
        return { outX: ((r1 - Math.floor(r1)) * 2 - 1) * samp, outY: ((r2 - Math.floor(r2)) * 2 - 1) * samp };
      }
      case 'float': {
        var ft = PN(node, 't', timeValue());
        var famp = PN(node, 'height', PN(node, 'amplitude', Number(prm.height !== undefined ? prm.height : (prm.amplitude !== undefined ? prm.amplitude : 5))));
        var ftilt = PN(node, 'tilt', Number(prm.tilt !== undefined ? prm.tilt : 3));
        var fperiod = Math.max(0.01, PN(node, 'period', Number(prm.period !== undefined ? prm.period : 0.533)));
        var fphase = 2 * Math.PI * ft / fperiod;
        return { outY: -famp * (0.5 + 0.5 * Math.sin(fphase)), outRotation: ftilt * Math.sin(fphase) };
      }
      case 'wobble': {
        var wt2 = PN(node, 't', timeValue());
        var wAng = PN(node, 'angleAmplitude', PN(node, 'amplitude', Number(prm.angleAmplitude !== undefined ? prm.angleAmplitude : (prm.amplitude !== undefined ? prm.amplitude : 5))));
        var wMove = PN(node, 'moveAmplitude', Number(prm.moveAmplitude !== undefined ? prm.moveAmplitude : 2));
        var wDamp = PN(node, 'damping', Number(prm.damping || 0));
        var wPeriod = Math.max(0.01, PN(node, 'period', Number(prm.period !== undefined ? prm.period : 0.267)));
        var wPhase = 2 * Math.PI * wt2 / wPeriod;
        var wDecay = Math.exp(-wDamp * wt2 * 2 * Math.PI);
        return {
          outRotation: wAng * Math.sin(wPhase) * wDecay,
          outX: wMove * Math.sin(wPhase + Math.PI / 3) * wDecay,
          outY: wMove * Math.cos(wPhase + Math.PI / 3) * wDecay,
        };
      }
      case 'bounce': {
        var bot = PN(node, 't', timeValue());
        var boAmp = PN(node, 'height', PN(node, 'amplitude', Number(prm.height !== undefined ? prm.height : (prm.amplitude !== undefined ? prm.amplitude : 20))));
        var boPeriod = Math.max(0.01, PN(node, 'period', Number(prm.period !== undefined ? prm.period : 0.2)));
        var boBounces = Math.max(1, PN(node, 'bounces', Number(prm.bounces !== undefined ? prm.bounces : 3)));
        var boDamp = PN(node, 'damping', Number(prm.damping !== undefined ? prm.damping : 0.5));
        var bounceT = (bot % boPeriod) / (boPeriod / boBounces);
        var bounceIndex = Math.floor((bot % boPeriod) / (boPeriod / boBounces));
        var within = bounceT - Math.floor(bounceT);
        var boDecay = Math.pow(1 - boDamp, bounceIndex);
        return { outY: -boAmp * boDecay * Math.pow(Math.sin(Math.PI * within), 2) };
      }
      case 'elastic': {
        var et = PN(node, 't', timeValue());
        var eOff = PN(node, 'offset', Number(prm.offset !== undefined ? prm.offset : 20));
        var eOver = PN(node, 'overshoot', Number(prm.overshoot !== undefined ? prm.overshoot : 0.3));
        var eDamp = PN(node, 'damping', Number(prm.damping !== undefined ? prm.damping : 0.5));
        var ePeriod = Math.max(0.01, PN(node, 'period', Number(prm.period !== undefined ? prm.period : 0.267)));
        var ePhase = 2 * Math.PI * et / ePeriod;
        var eDecay = Math.exp(-eDamp * et * 2 * Math.PI);
        var eVal = eOff * (1 - Math.cos(ePhase) * eDecay * (1 + eOver));
        var eAxis = String(prm.axis || 'y');
        if (eAxis === 'x') return { outX: eVal };
        if (eAxis === 'rotation') return { outRotation: eVal };
        if (eAxis === 'scale') { var es = Math.max(0.01, 1 + eVal / 100); return { outScaleX: es, outScaleY: es }; }
        return { outY: eVal };
      }
      case 'wheel': {
        var wht = PN(node, 't', timeValue());
        var whRX = PN(node, 'radiusX', Number(prm.radiusX !== undefined ? prm.radiusX : 10));
        var whRY = PN(node, 'radiusY', Number(prm.radiusY !== undefined ? prm.radiusY : 10));
        var whPeriod = Math.max(0.01, PN(node, 'period', Number(prm.period !== undefined ? prm.period : 0.267)));
        var whPhase = Number(prm.phase || 0) * Math.PI / 180;
        var whDir = prm.direction === 'ccw' ? -1 : 1;
        var whAngle = whDir * (2 * Math.PI * wht / whPeriod) + whPhase;
        return { outX: whRX * Math.cos(whAngle), outY: whRY * Math.sin(whAngle), outRotation: whDir * (360 * wht / whPeriod) };
      }
      case 'noise': {
        var nt = PN(node, 't', timeValue());
        var nAmp = PN(node, 'amplitude', Number(prm.amplitude !== undefined ? prm.amplitude : 5));
        var nv = nAmp * (0.5 * Math.sin(nt * 42) + 0.3 * Math.sin(nt * 78 + 1.7) + 0.2 * Math.sin(nt * 174 + 4.1));
        var nTarget = String(prm.targetProperty || 'translateY');
        if (nTarget === 'translateX') return { outX: nv };
        if (nTarget === 'rotation') return { outRotation: nv };
        if (nTarget === 'scaleX' || nTarget === 'scaleY') return { outScale: 1 + nv / 100 };
        return { outY: nv };
      }
      case 'wave': {
        var wvt = PN(node, 't', timeValue());
        var wvAmp = PN(node, 'amplitude', Number(prm.amplitude !== undefined ? prm.amplitude : 5));
        var wvFreq = PN(node, 'frequency', Number(prm.frequency !== undefined ? prm.frequency : 1));
        var wvPhase = Number(prm.phase || 0) * Math.PI / 180;
        var wvType = String(prm.waveType || 'sine');
        var wvPh = 2 * Math.PI * wvFreq * wvt + wvPhase;
        var wv;
        if (wvType === 'triangle') wv = (2 / Math.PI) * Math.asin(Math.sin(wvPh));
        else if (wvType === 'square') wv = Math.sign(Math.sin(wvPh));
        else if (wvType === 'sawtooth') wv = 2 * ((wvPh / (2 * Math.PI)) % 1) - 1;
        else wv = Math.sin(wvPh);
        wv *= wvAmp;
        var wvTarget = String(prm.targetProperty || 'translateY');
        if (wvTarget === 'translateX') return { outX: wv };
        if (wvTarget === 'rotation') return { outRotation: wv };
        return { outY: wv };
      }
      case 'spring': {
        var spt = PN(node, 't', timeValue());
        var spStiff = PN(node, 'stiffness', Number(prm.stiffness !== undefined ? prm.stiffness : 0.3));
        var spDamp = PN(node, 'damping', Number(prm.damping !== undefined ? prm.damping : 0.1));
        var spMass = PN(node, 'mass', Number(prm.mass !== undefined ? prm.mass : 1));
        var spRest = PN(node, 'restLength', Number(prm.restLength || 0));
        var spAmp = PN(node, 'amplitude', Number(prm.amplitude !== undefined ? prm.amplitude : 10));
        var spTarget = String(prm.targetProperty || 'translateY');
        var timeSec = spt; // t 已是秒
        var omega = Math.sqrt(spStiff / spMass);
        var gamma = spDamp / (2 * spMass);
        var dOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
        var spVal = (spRest > 0 ? spRest : spAmp) * Math.exp(-gamma * timeSec) * Math.cos(dOmega * timeSec) + spRest;
        if (spTarget === 'translateX') return { outX: spVal };
        if (spTarget === 'rotation') return { outRotation: spVal };
        return { outY: spVal };
      }
      case 'jitter': {
        var jt = PN(node, 't', timeValue());
        var jAmpX = PN(node, 'amplitudeX', Number(prm.amplitudeX !== undefined ? prm.amplitudeX : 2));
        var jAmpY = PN(node, 'amplitudeY', Number(prm.amplitudeY !== undefined ? prm.amplitudeY : 2));
        var jSeed = Number(prm.seed || 0);
        var jr1 = Math.sin((jt + jSeed) * 12.9898) * 43758.5453;
        var jr2 = Math.sin((jt + jSeed) * 78.233) * 12543.123;
        return { outX: ((jr1 - Math.floor(jr1)) * 2 - 1) * jAmpX, outY: ((jr2 - Math.floor(jr2)) * 2 - 1) * jAmpY };
      }
      case 'translate': {
        var tx = PN(node, 'offsetX', Number(prm.offsetX || 0));
        var ty = PN(node, 'offsetY', Number(prm.offsetY || 0));
        return { outX: tx, outY: ty, translateX: tx, translateY: ty };
      }
      case 'rotate': {
        var ra = PN(node, 'angle', Number(prm.angle || 0));
        return { out: ra, outRotation: ra, rotation: ra };
      }
      case 'uniform_scale': {
        var us = PN(node, 'scale', Number(prm.scale !== undefined ? prm.scale : 1));
        return { out: us, outScaleX: us, outScaleY: us, scaleX: us, scaleY: us };
      }
      case 'skew': {
        var skx = PN(node, 'skewX', Number(prm.skewX || 0));
        var sky = PN(node, 'skewY', Number(prm.skewY || 0));
        return { outX: skx, outY: sky, skewX: skx, skewY: sky };
      }
      case 'non_uniform_stretch': {
        var nsx = PN(node, 'scaleX', Number(prm.scaleX !== undefined ? prm.scaleX : 1));
        var nsy = PN(node, 'scaleY', Number(prm.scaleY !== undefined ? prm.scaleY : 1));
        return { outScaleX: nsx, outScaleY: nsy, scaleX: nsx, scaleY: nsy };
      }
      case 'curve': {
        var pts = node.points || [];
        if (!pts.length) return { out: 0 };
        var cu = ctx.u || 0;
        if (cu <= pts[0][0]) return { out: pts[0][1] };
        var lp = pts[pts.length - 1];
        if (cu >= lp[0]) return { out: lp[1] };
        for (var ci = 0; ci < pts.length - 1; ci++) {
          var ca = pts[ci], cb = pts[ci + 1];
          if (cu >= ca[0] && cu <= cb[0]) {
            var ct2 = cb[0] === ca[0] ? 0 : (cu - ca[0]) / (cb[0] - ca[0]);
            return { out: ca[1] + (cb[1] - ca[1]) * ct2 };
          }
        }
        return { out: lp[1] };
      }
    }
    return {};
  }

  function refVal(ref) {
    if (!ref || ref.n === undefined) return 0;
    var src = nodeValue(ref.n);
    var v = src[ref.o || 'out'];
    return v === undefined ? 0 : v;
  }

  var result = new Map();
  for (var ti = 0; ti < nodes.length; ti++) {
    var tn = nodes[ti];
    if (tn.type !== 'transform') continue;
    var ang = tn.angleFrom ? refVal(tn.angleFrom) : 0;
    var dx = tn.dxFrom ? refVal(tn.dxFrom) : 0;
    var dy = tn.dyFrom ? refVal(tn.dyFrom) : 0;
    if (tn.units === 'main') {
      result.set(tn.part, { angle: -ang * Math.PI / 180, dx: dx, dy: -dy });
    } else {
      result.set(tn.part, { angle: ang, dx: dx, dy: dy });
    }
  }
  return result;
}
`;

/** 探针/测试用：在 Node 里加载运行时求值器（与模板内嵌的是同一份源） */
export function createRuntimeEvaluator(): (
  graph: unknown,
  ctx?: Record<string, unknown>,
) => Map<string, { angle: number; dx: number; dy: number }> {
  const factory = new Function(`${RUNTIME_EVAL_SRC}\nreturn evalRuntimeGraph;`);
  return factory() as never;
}
