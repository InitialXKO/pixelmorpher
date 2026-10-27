// ============================================================
// 像素链运行时源（单一源 JS 字符串）：注入运行时模板使用，探针经
// createPixelRuntime() 加载校验。与产品侧蓝图求值器（blueprint/
// eval.ts）+ 像素修改器注册表（engine/pixel-modifiers.ts）+ 几何
// 渲染器（engine/modifier-renderers/geometric.ts、line-fx.ts）是
// 孪生实现：同 eval-src 与 eval.ts 的关系，逐格由探针差分对齐。
//
// 网格表示与编辑器 PixelGrid 同形：(hex|null)[][]，行优先、y 下。
// 求值语义对 evaluateBlueprint：节点禁用（enabled=false）与
// gate<0.5 同口径——像素节点直通其 pixels 输入、数值节点输出
// 空；节点求值失败输出空；链中途断裂时编辑器 screen 以空网格
// 上屏（部件变空），故 evalPixelChain 断链返回空网格 [] 而非
// null（null 只留给 outId 不存在等防御情形）。
// 数值子图按 eval-src 同式（time = ctx.frame/ctx.frameRate 秒）。
//
// 已知分歧（编辑器侧缺陷，不复制）：注册表族求值器把接线值以
// BlueprintValue 包装原样塞进 params（数值 asNumber 的族除外），
// 编辑器里给 color_replace 等节点接线改参数实际失效（String(包装
// 对象) 之类）；孪生按解包后的值算。参数面板驱动（params）与
// 几何/线绘族的数值接线两条路与编辑器逐格一致，探针卡这两条。
// ============================================================

export const PIXEL_SRC = `
function pxHexToRgb(hex) {
  var h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function pxRgbToHex(r, g, b) {
  var ri = Math.max(0, Math.min(255, Math.round(r)));
  var gi = Math.max(0, Math.min(255, Math.round(g)));
  var bi = Math.max(0, Math.min(255, Math.round(b)));
  return '#' + ri.toString(16).padStart(2, '0') + gi.toString(16).padStart(2, '0') + bi.toString(16).padStart(2, '0');
}
function pxHexBrightness(hex) {
  var c = pxHexToRgb(hex);
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}
function pxColorDistance(c1, c2) {
  var a = pxHexToRgb(c1), b = pxHexToRgb(c2);
  var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
function pxLerpColor(hex1, hex2, t) {
  var v1 = pxHexToRgb(hex1), v2 = pxHexToRgb(hex2);
  var r = Math.round(v1[0] + (v2[0] - v1[0]) * t);
  var g = Math.round(v1[1] + (v2[1] - v1[1]) * t);
  var b = Math.round(v1[2] + (v2[2] - v1[2]) * t);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function pxDarkenColor(hex, factor) {
  var c = pxHexToRgb(hex);
  return pxRgbToHex(c[0] * factor, c[1] * factor, c[2] * factor);
}
function pxLightenColor(hex, factor) {
  var c = pxHexToRgb(hex);
  var nr = Math.min(255, Math.round(c[0] + (255 - c[0]) * factor));
  var ng = Math.min(255, Math.round(c[1] + (255 - c[1]) * factor));
  var nb = Math.min(255, Math.round(c[2] + (255 - c[2]) * factor));
  return '#' + nr.toString(16).padStart(2, '0') + ng.toString(16).padStart(2, '0') + nb.toString(16).padStart(2, '0');
}
function pxBlendColorsPixel(base, overlay, mode, opacity) {
  var b = pxHexToRgb(base), o = pxHexToRgb(overlay);
  var r, g, bl;
  if (mode === 'multiply') {
    r = Math.round(b[0] * o[0] / 255); g = Math.round(b[1] * o[1] / 255); bl = Math.round(b[2] * o[2] / 255);
  } else if (mode === 'screen') {
    r = Math.round(255 - (255 - b[0]) * (255 - o[0]) / 255);
    g = Math.round(255 - (255 - b[1]) * (255 - o[1]) / 255);
    bl = Math.round(255 - (255 - b[2]) * (255 - o[2]) / 255);
  } else {
    r = b[0] < 128 ? Math.round(2 * b[0] * o[0] / 255) : Math.round(255 - 2 * (255 - b[0]) * (255 - o[0]) / 255);
    g = b[1] < 128 ? Math.round(2 * b[1] * o[1] / 255) : Math.round(255 - 2 * (255 - b[1]) * (255 - o[1]) / 255);
    bl = b[2] < 128 ? Math.round(2 * b[2] * o[2] / 255) : Math.round(255 - 2 * (255 - b[2]) * (255 - o[2]) / 255);
  }
  r = Math.round(b[0] * (1 - opacity) + r * opacity);
  g = Math.round(b[1] * (1 - opacity) + g * opacity);
  bl = Math.round(b[2] * (1 - opacity) + bl * opacity);
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + bl.toString(16).padStart(2, '0');
}
function pxGuard(pixels, weight) {
  var h = pixels.length;
  var w = pixels[0] ? pixels[0].length : 0;
  if (w === 0 || h === 0 || weight <= 0) return null;
  return { h: h, w: w };
}
function pxElapsed(frame, frameRate) { return frameRate > 0 ? frame / frameRate : 0; }
function pxEmptyGrid(h, w) {
  var out = [];
  for (var y = 0; y < h; y++) { var row = []; for (var x = 0; x < w; x++) row.push(null); out.push(row); }
  return out;
}
function pxInpaint(pixels, mask, radius) {
  var height = pixels.length;
  var width = height > 0 ? pixels[0].length : 0;
  if (width === 0 || height === 0 || mask.size === 0) return pixels;
  var result = pixels.map(function (row) { return row.slice(); });
  var maskGrid = [];
  for (var my = 0; my < height; my++) { var mr = []; for (var mx = 0; mx < width; mx++) mr.push(false); maskGrid.push(mr); }
  mask.forEach(function (key) {
    var parts = key.split(',').map(Number);
    var x = parts[0], y = parts[1];
    if (x >= 0 && x < width && y >= 0 && y < height) maskGrid[y][x] = true;
  });
  var remaining = new Set(mask);
  var maxIterations = Math.max(width, height);
  for (var iteration = 0; iteration < maxIterations && remaining.size > 0; iteration++) {
    var toFill = [];
    remaining.forEach(function (key) {
      var parts = key.split(',').map(Number);
      var x = parts[0], y = parts[1];
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      var totalR = 0, totalG = 0, totalB = 0, totalWeight = 0;
      var hasNeighbor = false;
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          var nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          var nColor = result[ny][nx];
          if (nColor === null || maskGrid[ny][nx]) continue;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > radius) continue;
          var weight = 1 / (dist * dist + 0.001);
          totalR += parseInt(nColor.slice(1, 3), 16) * weight;
          totalG += parseInt(nColor.slice(3, 5), 16) * weight;
          totalB += parseInt(nColor.slice(5, 7), 16) * weight;
          totalWeight += weight;
          hasNeighbor = true;
        }
      }
      if (hasNeighbor && totalWeight > 0) {
        toFill.push({ x: x, y: y, color: pxRgbToHex(totalR / totalWeight, totalG / totalWeight, totalB / totalWeight) });
      }
    });
    if (toFill.length === 0) break;
    for (var fi = 0; fi < toFill.length; fi++) {
      result[toFill[fi].y][toFill[fi].x] = toFill[fi].color;
      maskGrid[toFill[fi].y][toFill[fi].x] = false;
      remaining.delete(toFill[fi].x + ',' + toFill[fi].y);
    }
  }
  remaining.forEach(function (key) {
    var parts = key.split(',').map(Number);
    var x = parts[0], y = parts[1];
    if (x >= 0 && x < width && y >= 0 && y < height) result[y][x] = null;
  });
  return result;
}
function pxHoleFill(result, holeFill) {
  if (holeFill !== 'edge_copy') return;
  var holes = new Set();
  for (var hy = 0; hy < result.length; hy++) {
    for (var hx = 0; hx < result[hy].length; hx++) {
      if (result[hy][hx] === null) holes.add(hx + ',' + hy);
    }
  }
  if (holes.size === 0) return;
  var inpainted = pxInpaint(result, holes, 3);
  for (var yy = 0; yy < result.length; yy++) {
    for (var xx = 0; xx < result[yy].length; xx++) result[yy][xx] = inpainted[yy][xx];
  }
}
function pxColorReplace(pixels, source, target, tolerance) {
  return pixels.map(function (row) {
    return row.map(function (pixel) {
      if (!pixel) return pixel;
      if (pxColorDistance(pixel, source) <= tolerance) return target;
      return pixel;
    });
  });
}
function pxOutline(pixels, thickness, color, directions, outlineMode, blendMode, edgesOnly, lightAngle) {
  var h = pixels.length;
  var w = pixels[0] ? pixels[0].length : 0;
  if (w === 0 || h === 0) return pixels;
  var dirCount = directions === '4' ? 4 : 8;
  var DIRS_4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  var DIRS_8 = DIRS_4.concat([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  var dirs = dirCount === 4 ? DIRS_4 : DIRS_8;
  var opaque = [], outlineColor = [], outlineDist = [], outlineDirX = [], outlineDirY = [], outlineSrcColor = [];
  for (var iy = 0; iy < h; iy++) {
    var orow = [], crow = [], drow = [], xrow = [], yrow = [], srow = [];
    for (var ix = 0; ix < w; ix++) {
      orow.push(pixels[iy][ix] !== null);
      crow.push(null); drow.push(Infinity); xrow.push(0); yrow.push(0); srow.push(null);
    }
    opaque.push(orow); outlineColor.push(crow); outlineDist.push(drow);
    outlineDirX.push(xrow); outlineDirY.push(yrow); outlineSrcColor.push(srow);
  }
  for (var di = 0; di < dirs.length; di++) {
    var dy = dirs[di][0], dx = dirs[di][1];
    for (var dist = 1; dist <= thickness; dist++) {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (!opaque[y][x]) continue;
          var ny = y + dy * dist;
          var nx = x + dx * dist;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          if (opaque[ny][nx]) continue;
          if (dist < outlineDist[ny][nx]) {
            outlineDist[ny][nx] = dist;
            var dirLen = Math.sqrt(dx * dx + dy * dy);
            outlineDirX[ny][nx] = dx / dirLen;
            outlineDirY[ny][nx] = dy / dirLen;
            outlineSrcColor[ny][nx] = pixels[y][x];
            if (outlineMode === 'solid') {
              outlineColor[ny][nx] = color;
            } else if (outlineMode === 'darken') {
              var srcColor = pixels[y][x];
              outlineColor[ny][nx] = srcColor ? pxDarkenColor(srcColor, 0.4) : color;
            } else if (outlineMode === 'gradient') {
              outlineColor[ny][nx] = color;
            }
          }
        }
      }
    }
  }
  if (outlineMode === 'gradient') {
    var lightRad = (lightAngle * Math.PI) / 180;
    var lightDirX = Math.cos(lightRad);
    var lightDirY = Math.sin(lightRad);
    for (var gy = 0; gy < h; gy++) {
      for (var gx = 0; gx < w; gx++) {
        if (outlineColor[gy][gx] === null) continue;
        if (outlineDist[gy][gx] === Infinity) continue;
        var gdx = outlineDirX[gy][gx];
        var gdy = outlineDirY[gy][gx];
        var dot = gdx * lightDirX + gdy * lightDirY;
        var t = (dot + 1) / 2;
        var srcC = outlineSrcColor[gy][gx];
        if (srcC) {
          var darkVersion = pxDarkenColor(srcC, 0.3);
          var lightVersion = pxLightenColor(srcC, 0.5);
          outlineColor[gy][gx] = pxLerpColor(darkVersion, lightVersion, t);
        }
      }
    }
  }
  var result = pixels.map(function (row, y) {
    return row.map(function (pixel, x) {
      if (pixel !== null) {
        if (!edgesOnly) {
          var isEdge = false;
          for (var ei = 0; ei < DIRS_4.length; ei++) {
            var ey = y + DIRS_4[ei][0];
            var ex = x + DIRS_4[ei][1];
            if (ey < 0 || ey >= h || ex < 0 || ex >= w || !opaque[ey][ex]) { isEdge = true; break; }
          }
          if (isEdge) {
            if (outlineMode === 'solid') return color;
            if (outlineMode === 'darken') return pxDarkenColor(pixel, 0.4);
            return color;
          }
        }
        return pixel;
      }
      return outlineColor[y][x];
    });
  });
  return result;
}
var PX_BAYER_2 = [[0, 2], [3, 1]];
var PX_BAYER_4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
var PX_BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
function pxDither(pixels, pattern) {
  var bayer = pattern === 'bayer2' ? PX_BAYER_2 : pattern === 'bayer8' ? PX_BAYER_8 : PX_BAYER_4;
  var size = bayer.length;
  var maxVal = size * size;
  var h = pixels.length;
  var w = pixels[0] ? pixels[0].length : 0;
  var result = pxEmptyGrid(h, w);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var color = pixels[y][x];
      if (!color) continue;
      var brightness = pxHexBrightness(color);
      var threshold = bayer[y % size][x % size] / maxVal;
      if (brightness >= threshold) result[y][x] = color;
    }
  }
  return result;
}
function pxPixelDisplace(pixels, intensity, frequency, currentFrame) {
  var h = pixels.length;
  var w = pixels[0] ? pixels[0].length : 0;
  var result = pxEmptyGrid(h, w);
  var timeOffset = currentFrame * frequency * Math.PI * 2;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var color = pixels[y][x];
      if (!color) continue;
      var dx = Math.round(Math.sin((y * frequency + timeOffset) * Math.PI * 2) * intensity);
      var dy = Math.round(Math.cos((x * frequency + timeOffset) * Math.PI * 2) * intensity);
      var nx = x + dx;
      var ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) result[ny][nx] = color;
    }
  }
  return result;
}
function pxCleanup(pixels, minSizeRaw) {
  var minSize = Math.max(1, Math.round(Number(minSizeRaw) || 2));
  if (minSize <= 1) return pixels;
  var h = pixels.length;
  var w = h > 0 ? pixels[0].length : 0;
  if (w === 0) return pixels;
  function solid(x, y) {
    var c = pixels[y] ? pixels[y][x] : undefined;
    return c !== null && c !== undefined && c !== '';
  }
  var seen = new Uint8Array(w * h);
  var out = pixels.map(function (row) { return row.slice(); });
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (!solid(x, y) || seen[y * w + x]) continue;
      var comp = [];
      var stack = [y * w + x];
      seen[y * w + x] = 1;
      while (stack.length) {
        var cur = stack.pop();
        comp.push(cur);
        var cx = cur % w, cy = (cur / w) | 0;
        var nbrs = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (var ni = 0; ni < 4; ni++) {
          var nx = nbrs[ni][0], ny = nbrs[ni][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var idx = ny * w + nx;
          if (seen[idx] || !solid(nx, ny)) continue;
          seen[idx] = 1;
          stack.push(idx);
        }
      }
      if (comp.length < minSize) {
        for (var ci = 0; ci < comp.length; ci++) out[(comp[ci] / w) | 0][comp[ci] % w] = null;
      }
    }
  }
  return out;
}
function pxCylinderRotate(pixels, angleDeg, axisOffsetX, radiusShrinkRatio, projection, smooth, backFill) {
  if (angleDeg === 0) return pixels;
  var h = pixels.length;
  var w = pixels[0] ? pixels[0].length : 0;
  if (w === 0 || h === 0) return pixels;
  var result = pxEmptyGrid(h, w);
  var cx = Math.floor(w / 2) + axisOffsetX;
  var effectiveHalfW = Math.max(1, (w / 2) * radiusShrinkRatio);
  var angleRad = (angleDeg * Math.PI) / 180;
  var viewOffset = projection === 'oblique' ? Math.PI / 6 : 0;
  var textureTileWidth = 2 * effectiveHalfW;
  var textureStartX = cx - effectiveHalfW;
  var leftEdgeX = Math.round(textureStartX);
  var rightEdgeX = Math.round(cx + effectiveHalfW);
  var leftEdgeColors = [], rightEdgeColors = [];
  for (var ei = 0; ei < h; ei++) { leftEdgeColors.push(null); rightEdgeColors.push(null); }
  if (backFill === 'extend') {
    for (var ey = 0; ey < h; ey++) {
      for (var searchX = leftEdgeX; searchX <= rightEdgeX; searchX++) {
        var sxa = Math.max(0, Math.min(w - 1, searchX));
        if (pixels[ey][sxa] !== null) { leftEdgeColors[ey] = pixels[ey][sxa]; break; }
      }
      for (var searchX2 = rightEdgeX; searchX2 >= leftEdgeX; searchX2--) {
        var sxb = Math.max(0, Math.min(w - 1, searchX2));
        if (pixels[ey][sxb] !== null) { rightEdgeColors[ey] = pixels[ey][sxb]; break; }
      }
    }
  }
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var nx = (x - cx) / effectiveHalfW;
      if (Math.abs(nx) > 1) { result[y][x] = pixels[y][x]; continue; }
      var thetaOut = nx * (Math.PI / 2) + viewOffset;
      var cosFactor = Math.cos(thetaOut);
      var isEdge = Math.abs(thetaOut - viewOffset) > Math.PI / 2 - 0.01;
      if (isEdge) {
        if (backFill === 'none') {
          continue;
        } else if (backFill === 'extend') {
          if (thetaOut - viewOffset > 0) result[y][x] = rightEdgeColors[y];
          else result[y][x] = leftEdgeColors[y];
          continue;
        }
      }
      var thetaSrc = thetaOut + angleRad;
      var srcNx = thetaSrc / (Math.PI * 2);
      var srcX;
      if (smooth) srcX = textureStartX + srcNx * textureTileWidth;
      else srcX = Math.round(textureStartX + srcNx * textureTileWidth);
      var localX = ((srcX - textureStartX) % textureTileWidth + textureTileWidth) % textureTileWidth;
      srcX = Math.round(textureStartX + localX);
      srcX = Math.max(0, Math.min(w - 1, srcX));
      var compressedSrcX = cx + (srcX - cx) * cosFactor;
      if (smooth) {
        var x0 = Math.floor(compressedSrcX);
        var x1 = (x0 + 1) % w;
        var frac = compressedSrcX - x0;
        var wx0 = ((x0 % w) + w) % w;
        var c0 = pixels[y][wx0];
        var c1 = pixels[y][x1];
        if (c0 && c1) {
          var rgb0 = pxHexToRgb(c0);
          var rgb1 = pxHexToRgb(c1);
          result[y][x] = pxRgbToHex(
            rgb0[0] + (rgb1[0] - rgb0[0]) * frac,
            rgb0[1] + (rgb1[1] - rgb0[1]) * frac,
            rgb0[2] + (rgb1[2] - rgb0[2]) * frac);
        } else {
          result[y][x] = c0 || c1;
        }
      } else {
        var nearestX = ((Math.round(compressedSrcX) % w) + w) % w;
        result[y][x] = pixels[y][nearestX];
      }
    }
  }
  return result;
}
function pxSphereRotate(pixels, angleDeg, mode, centerX, centerY, maxLatitude, radiusShrinkRatio, backFill) {
  if (angleDeg === 0) return pixels;
  var h = pixels.length;
  var w = pixels[0] ? pixels[0].length : 0;
  if (w === 0 || h === 0) return pixels;
  var result = pxEmptyGrid(h, w);
  var cx = Math.floor(w / 2) + centerX;
  var cy = Math.floor(h / 2) + centerY;
  var angleRad = (angleDeg * Math.PI) / 180;
  var effectiveRadiusX = (w / 2) * radiusShrinkRatio;
  var effectiveRadiusY = (h / 2) * radiusShrinkRatio;
  var textureWidth = 2 * effectiveRadiusX;
  var textureHeight = 2 * effectiveRadiusY;
  var textureStartX = cx - effectiveRadiusX;
  var textureStartY = cy - effectiveRadiusY;
  if (mode === 'mercator') {
    var maxLatRad = (maxLatitude * Math.PI) / 180;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = x - cx;
        var dy = y - cy;
        var nx = dx / effectiveRadiusX;
        var ny = dy / effectiveRadiusY;
        var r2 = nx * nx + ny * ny;
        if (r2 > 1) { result[y][x] = pixels[y][x]; continue; }
        var nz = Math.sqrt(Math.max(0, 1 - r2));
        var lat = Math.asin(Math.max(-1, Math.min(1, -ny * Math.sin(maxLatRad))));
        var lon = Math.atan2(nx, nz);
        var srcLon = lon - angleRad;
        var normalizedSrcLon = ((srcLon % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        var isBackHemisphere = Math.abs(normalizedSrcLon) > Math.PI / 2;
        if (isBackHemisphere) {
          if (backFill === 'none') {
            continue;
          } else if (backFill === 'extend') {
            var dist = Math.sqrt(r2);
            if (dist > 0.001) {
              var edgeNx = nx / dist;
              var edgeNy = ny / dist;
              var edgeX = Math.round(cx + edgeNx * effectiveRadiusX);
              var edgeY = Math.round(cy + edgeNy * effectiveRadiusY);
              if (edgeX >= 0 && edgeX < w && edgeY >= 0 && edgeY < h) {
                result[y][x] = pixels[edgeY][edgeX];
              }
            }
            continue;
          }
        }
        var srcX = cx + (srcLon / Math.PI) * effectiveRadiusX;
        var srcY = cy - (lat / maxLatRad) * effectiveRadiusY;
        var localSrcX = ((srcX - textureStartX) % textureWidth + textureWidth) % textureWidth;
        var sx = Math.max(0, Math.min(w - 1, Math.round(textureStartX + localSrcX)));
        var sy = Math.max(0, Math.min(h - 1, Math.round(srcY)));
        result[y][x] = pixels[sy][sx];
      }
    }
  } else {
    for (var ry = 0; ry < h; ry++) {
      var rny = (ry - cy) / effectiveRadiusY;
      var latRad = rny * (Math.PI / 2);
      var cosLat = Math.cos(latRad);
      var shiftPixels = angleRad / (2 * Math.PI) * textureWidth * cosLat;
      var shiftRounded = Math.round(shiftPixels);
      for (var rx = 0; rx < w; rx++) {
        var rdx = (rx - cx) / effectiveRadiusX;
        var rdy = (ry - cy) / effectiveRadiusY;
        var rr2 = rdx * rdx + rdy * rdy;
        if (rr2 > 1) { result[ry][rx] = pixels[ry][rx]; continue; }
        var localX = rx - cx;
        var shiftedLocalX = localX - shiftRounded;
        var wrappedLocalX = ((shiftedLocalX + effectiveRadiusX) % textureWidth + textureWidth) % textureWidth - effectiveRadiusX;
        var ssrcX = Math.max(0, Math.min(w - 1, Math.round(cx + wrappedLocalX)));
        var isBack = Math.abs(shiftedLocalX) > effectiveRadiusX;
        if (isBack) {
          if (backFill === 'none') {
            continue;
          } else if (backFill === 'extend') {
            var rdist = Math.sqrt(rr2);
            if (rdist > 0.001) {
              var redgeNx = rdx / rdist;
              var redgeX = Math.round(cx + redgeNx * effectiveRadiusX);
              if (redgeX >= 0 && redgeX < w) {
                result[ry][rx] = pixels[ry][redgeX];
              }
            } else {
              result[ry][rx] = pixels[ry][ssrcX];
            }
            continue;
          }
        }
        result[ry][rx] = pixels[ry][ssrcX];
      }
    }
  }
  return result;
}
function pxBend(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var h = grid.h, w = grid.w;
  var direction = String(params.direction || 'horizontal');
  var curvature = Number(params.curvature !== undefined && params.curvature !== null ? params.curvature : 0.3);
  var bendMode = String(params.bendMode || 'arc');
  var sPeriods = Number(params.sPeriods !== undefined && params.sPeriods !== null ? params.sPeriods : 1);
  var centerBias = Number(params.centerBias !== undefined && params.centerBias !== null ? params.centerBias : 0) / 100;
  var falloff = Number(params.falloff !== undefined && params.falloff !== null ? params.falloff : 1);
  var phaseSpeed = Number(params.phaseSpeed !== undefined && params.phaseSpeed !== null ? params.phaseSpeed : 0);
  var smoothSampling = Boolean(params.smoothSampling);
  var holeFill = String(params.holeFill || 'edge_copy');
  if (curvature === 0) return pixels;
  var elapsed = pxElapsed(currentFrame, frameRate);
  var phase = phaseSpeed * elapsed;
  var cx = w / 2 + (centerBias * w / 2);
  var cy = h / 2;
  var result = pxEmptyGrid(h, w);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var nx = (x - cx) / (w / 2);
      var ny = (y - cy) / (h / 2);
      var displacement;
      if (bendMode === 'arc') {
        var ta = direction === 'horizontal' ? nx : ny;
        displacement = curvature * ta * ta * Math.sign(ta) * 1;
      } else if (bendMode === 's_curve') {
        var ts = direction === 'horizontal' ? nx : ny;
        displacement = curvature * Math.sin(ts * Math.PI * sPeriods + phase) * 1;
      } else {
        var tf = direction === 'horizontal' ? nx : ny;
        var absT = Math.abs(tf);
        var sign = Math.sign(tf) || 1;
        displacement = curvature * sign * Math.pow(absT, 1 + falloff) * 1;
      }
      if (direction === 'horizontal') {
        var distFactorH = 1 - Math.min(1, Math.abs(ny) * falloff);
        displacement *= distFactorH;
      } else {
        var distFactorV = 1 - Math.min(1, Math.abs(nx) * falloff);
        displacement *= distFactorV;
      }
      var sx, sy;
      if (direction === 'horizontal') {
        sx = x;
        sy = y - Math.round(displacement * (h / 2));
      } else {
        sx = x - Math.round(displacement * (w / 2));
        sy = y;
      }
      if (smoothSampling) {
        var srcX = direction === 'horizontal' ? x : x - displacement * (w / 2);
        var srcY = direction === 'horizontal' ? y - displacement * (h / 2) : y;
        var x0 = Math.floor(srcX), y0 = Math.floor(srcY);
        var x1 = x0 + 1, y1 = y0 + 1;
        var c00 = (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) ? pixels[y0][x0] : null;
        var c10 = (x1 >= 0 && x1 < w && y0 >= 0 && y0 < h) ? pixels[y0][x1] : null;
        var c01 = (x0 >= 0 && x0 < w && y1 >= 0 && y1 < h) ? pixels[y1][x0] : null;
        var c11 = (x1 >= 0 && x1 < w && y1 >= 0 && y1 < h) ? pixels[y1][x1] : null;
        if (c00 || c10 || c01 || c11) {
          if (c00) result[y][x] = c00;
          else if (c10) result[y][x] = c10;
          else if (c01) result[y][x] = c01;
          else if (c11) result[y][x] = c11;
        }
      } else {
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) result[y][x] = pixels[sy][sx];
      }
    }
  }
  pxHoleFill(result, holeFill);
  return result;
}
function pxEllipticalCompress(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var h = grid.h, w = grid.w;
  var compressAxis = String(params.compressAxis || 'y');
  var compressRatio = Number(params.compressRatio !== undefined && params.compressRatio !== null ? params.compressRatio : 0.6);
  var centerX = Number(params.centerX !== undefined && params.centerX !== null ? params.centerX : 0) / 100;
  var centerY = Number(params.centerY !== undefined && params.centerY !== null ? params.centerY : 0) / 100;
  var preserveArea = Boolean(params.preserveArea);
  var anisotropy = Number(params.anisotropy !== undefined && params.anisotropy !== null ? params.anisotropy : 0);
  var phaseSpeed = Number(params.phaseSpeed !== undefined && params.phaseSpeed !== null ? params.phaseSpeed : 0);
  var holeFill = String(params.holeFill || 'edge_copy');
  var elapsed = pxElapsed(currentFrame, frameRate);
  var phase = phaseSpeed * elapsed;
  var scaleX, scaleY;
  var effectiveCompress = compressRatio + (1 - compressRatio) * (1 - 1);
  if (compressAxis === 'y') {
    scaleX = preserveArea ? 1 / effectiveCompress : 1;
    scaleY = effectiveCompress;
  } else if (compressAxis === 'x') {
    scaleX = effectiveCompress;
    scaleY = preserveArea ? 1 / effectiveCompress : 1;
  } else {
    scaleX = effectiveCompress;
    scaleY = effectiveCompress;
  }
  var anisoAngle = anisotropy * Math.PI / 4 + phase * 0.1;
  var cx = w / 2 + centerX * w / 2;
  var cy = h / 2 + centerY * h / 2;
  var result = pxEmptyGrid(h, w);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var dx = x - cx;
      var dy = y - cy;
      if (anisotropy !== 0) {
        var cosA = Math.cos(-anisoAngle);
        var sinA = Math.sin(-anisoAngle);
        var rdx = dx * cosA - dy * sinA;
        var rdy = dx * sinA + dy * cosA;
        dx = rdx;
        dy = rdy;
      }
      var srcDx = dx / scaleX;
      var srcDy = dy / scaleY;
      if (anisotropy !== 0) {
        var cosA2 = Math.cos(anisoAngle);
        var sinA2 = Math.sin(anisoAngle);
        var rdx2 = srcDx * cosA2 - srcDy * sinA2;
        var rdy2 = srcDx * sinA2 + srcDy * cosA2;
        srcDx = rdx2;
        srcDy = rdy2;
      }
      var sx = Math.round(srcDx + cx);
      var sy = Math.round(srcDy + cy);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) result[y][x] = pixels[sy][sx];
    }
  }
  pxHoleFill(result, holeFill);
  return result;
}
function pxDumbbellStretch(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var h = grid.h, w = grid.w;
  var direction = String(params.direction || 'horizontal');
  var neckRatio = Number(params.neckRatio !== undefined && params.neckRatio !== null ? params.neckRatio : 0.4);
  var endRatio = Number(params.endRatio !== undefined && params.endRatio !== null ? params.endRatio : 1.3);
  var transitionWidth = Number(params.transitionWidth !== undefined && params.transitionWidth !== null ? params.transitionWidth : 0.3);
  var stretchLength = Number(params.stretchLength !== undefined && params.stretchLength !== null ? params.stretchLength : 1.2);
  var centerX = Number(params.centerX !== undefined && params.centerX !== null ? params.centerX : 0) / 100;
  var centerY = Number(params.centerY !== undefined && params.centerY !== null ? params.centerY : 0) / 100;
  var phaseSpeed = Number(params.phaseSpeed !== undefined && params.phaseSpeed !== null ? params.phaseSpeed : 0);
  var holeFill = String(params.holeFill || 'edge_copy');
  var elapsed = pxElapsed(currentFrame, frameRate);
  var phase = phaseSpeed * elapsed;
  var eNeck = 1 + (neckRatio - 1) * 1;
  var eEnd = 1 + (endRatio - 1) * 1;
  var eStretch = 1 + (stretchLength - 1) * 1;
  var cx = w / 2 + centerX * w / 2;
  var cy = h / 2 + centerY * h / 2;
  var result = pxEmptyGrid(h, w);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var dx = x - cx;
      var dy = y - cy;
      if (phase !== 0) {
        var cosP = Math.cos(-phase * 0.05);
        var sinP = Math.sin(-phase * 0.05);
        var prdx = dx * cosP - dy * sinP;
        var prdy = dx * sinP + dy * cosP;
        dx = prdx;
        dy = prdy;
      }
      var srcDx, srcDy;
      if (direction === 'horizontal') {
        var th = eStretch !== 0 ? dx / (w / 2 * eStretch) : dx / (w / 2);
        var absTh = Math.min(1, Math.abs(th));
        var halfTrans = transitionWidth / 2;
        var perpScaleH;
        if (absTh < 0.5 - halfTrans) perpScaleH = eNeck;
        else if (absTh > 0.5 + halfTrans) perpScaleH = eEnd;
        else {
          var interpTh = (absTh - (0.5 - halfTrans)) / (2 * halfTrans);
          var smoothH = (1 - Math.cos(interpTh * Math.PI)) / 2;
          perpScaleH = eNeck + (eEnd - eNeck) * smoothH;
        }
        srcDx = dx / eStretch;
        srcDy = dy / perpScaleH;
      } else {
        var tv = eStretch !== 0 ? dy / (h / 2 * eStretch) : dy / (h / 2);
        var absTv = Math.min(1, Math.abs(tv));
        var halfTransV = transitionWidth / 2;
        var perpScaleV;
        if (absTv < 0.5 - halfTransV) perpScaleV = eNeck;
        else if (absTv > 0.5 + halfTransV) perpScaleV = eEnd;
        else {
          var interpTv = (absTv - (0.5 - halfTransV)) / (2 * halfTransV);
          var smoothV = (1 - Math.cos(interpTv * Math.PI)) / 2;
          perpScaleV = eNeck + (eEnd - eNeck) * smoothV;
        }
        srcDx = dx / perpScaleV;
        srcDy = dy / eStretch;
      }
      if (phase !== 0) {
        var cosP2 = Math.cos(phase * 0.05);
        var sinP2 = Math.sin(phase * 0.05);
        var urdx = srcDx * cosP2 - srcDy * sinP2;
        var urdy = srcDx * sinP2 + srcDy * cosP2;
        srcDx = urdx;
        srcDy = urdy;
      }
      var sx = Math.round(srcDx + cx);
      var sy = Math.round(srcDy + cy);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) result[y][x] = pixels[sy][sx];
    }
  }
  pxHoleFill(result, holeFill);
  return result;
}
function pxPillowStretch(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var h = grid.h, w = grid.w;
  var bulgeAmount = Number(params.bulgeAmount !== undefined && params.bulgeAmount !== null ? params.bulgeAmount : 0.4);
  var centerX = Number(params.centerX !== undefined && params.centerX !== null ? params.centerX : 0) / 100;
  var centerY = Number(params.centerY !== undefined && params.centerY !== null ? params.centerY : 0) / 100;
  var radiusX = Number(params.radiusX !== undefined && params.radiusX !== null ? params.radiusX : 100) / 100;
  var radiusY = Number(params.radiusY !== undefined && params.radiusY !== null ? params.radiusY : 100) / 100;
  var falloffCurve = String(params.falloffCurve || 'cosine');
  var phaseSpeed = Number(params.phaseSpeed !== undefined && params.phaseSpeed !== null ? params.phaseSpeed : 0);
  var holeFill = String(params.holeFill || 'edge_copy');
  if (bulgeAmount === 0) return pixels;
  var elapsed = pxElapsed(currentFrame, frameRate);
  var phase = phaseSpeed * elapsed;
  var cx = w / 2 + centerX * w / 2;
  var cy = h / 2 + centerY * h / 2;
  var rx = w / 2 * radiusX;
  var ry = h / 2 * radiusY;
  var effectiveBulge = bulgeAmount * 1;
  var result = pxEmptyGrid(h, w);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var dx = x - cx;
      var dy = y - cy;
      var nx = rx > 0 ? dx / rx : 0;
      var ny = ry > 0 ? dy / ry : 0;
      var dist = Math.sqrt(nx * nx + ny * ny);
      if (dist > 1.001) {
        if (x >= 0 && x < w && y >= 0 && y < h) result[y][x] = pixels[y][x];
        continue;
      }
      var factor;
      var t = dist;
      if (falloffCurve === 'cosine') factor = Math.cos(t * Math.PI / 2);
      else if (falloffCurve === 'linear') factor = 1 - t;
      else if (falloffCurve === 'quadratic') factor = (1 - t) * (1 - t);
      else factor = Math.exp(-3 * t);
      var animatedBulge = effectiveBulge + Math.sin(phase) * 0.05;
      var displacement = animatedBulge * factor;
      var srcDx = dx / (1 + displacement);
      var srcDy = dy / (1 + displacement);
      var sx = Math.round(srcDx + cx);
      var sy = Math.round(srcDy + cy);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) result[y][x] = pixels[sy][sx];
    }
  }
  pxHoleFill(result, holeFill);
  return result;
}
function pxHyperbolicStretch(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var h = grid.h, w = grid.w;
  var intensity = Number(params.intensity !== undefined && params.intensity !== null ? params.intensity : 0.5);
  var direction = String(params.direction || 'radial');
  var centerX = Number(params.centerX !== undefined && params.centerX !== null ? params.centerX : 0) / 100;
  var centerY = Number(params.centerY !== undefined && params.centerY !== null ? params.centerY : 0) / 100;
  var asymmetry = Number(params.asymmetry !== undefined && params.asymmetry !== null ? params.asymmetry : 0);
  var falloff = Number(params.falloff !== undefined && params.falloff !== null ? params.falloff : 1);
  var phaseSpeed = Number(params.phaseSpeed !== undefined && params.phaseSpeed !== null ? params.phaseSpeed : 0);
  var holeFill = String(params.holeFill || 'edge_copy');
  if (intensity === 0) return pixels;
  var elapsed = pxElapsed(currentFrame, frameRate);
  var phase = phaseSpeed * elapsed;
  var effectiveIntensity = intensity * 1;
  var cx = w / 2 + centerX * w / 2;
  var cy = h / 2 + centerY * h / 2;
  var result = pxEmptyGrid(h, w);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var dx = x - cx;
      var dy = y - cy;
      var srcDx, srcDy;
      if (direction === 'radial') {
        var dist = Math.sqrt(dx * dx + dy * dy);
        var maxDist = Math.sqrt((w / 2) * (w / 2) + (h / 2) * (h / 2));
        var nd = maxDist > 0 ? dist / maxDist : 0;
        var k = effectiveIntensity * falloff;
        var tanhK = Math.tanh(k);
        var srcNd;
        if (tanhK > 0.001) {
          var arg = nd * tanhK;
          srcNd = Math.abs(arg) < 0.999 ? Math.atanh(arg) / k : nd;
        } else {
          srcNd = nd;
        }
        var asymAngle = Math.atan2(dy, dx) + asymmetry * Math.PI / 4;
        var asymFactor = 1 + asymmetry * 0.3 * Math.cos(asymAngle + phase * 0.1);
        if (dist > 0.001) {
          var ratio = (srcNd * asymFactor) / nd;
          srcDx = dx * ratio;
          srcDy = dy * ratio;
        } else {
          srcDx = dx;
          srcDy = dy;
        }
      } else {
        var isHorizontal = direction === 'horizontal';
        var halfDim = isHorizontal ? w / 2 : h / 2;
        var component = isHorizontal ? dx : dy;
        var nc = halfDim > 0 ? component / halfDim : 0;
        var k2 = effectiveIntensity * falloff;
        var tanhK2 = Math.tanh(k2);
        var srcNc;
        if (tanhK2 > 0.001) {
          var arg2 = nc * tanhK2;
          srcNc = Math.abs(arg2) < 0.999 ? Math.atanh(arg2) / k2 : nc;
        } else {
          srcNc = nc;
        }
        srcNc *= 1 + asymmetry * 0.3 * Math.sign(srcNc) * (1 + Math.sin(phase * 0.1));
        if (isHorizontal) {
          srcDx = srcNc * halfDim;
          srcDy = dy;
        } else {
          srcDx = dx;
          srcDy = srcNc * halfDim;
        }
      }
      var sx = Math.round(srcDx + cx);
      var sy = Math.round(srcDy + cy);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) result[y][x] = pixels[sy][sx];
    }
  }
  pxHoleFill(result, holeFill);
  return result;
}
function pxRingRipple(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var h = grid.h, w = grid.w;
  var amplitude = Number(params.amplitude !== undefined && params.amplitude !== null ? params.amplitude : 3);
  var frequency = Number(params.frequency !== undefined && params.frequency !== null ? params.frequency : 0.15);
  var speed = Number(params.speed !== undefined && params.speed !== null ? params.speed : 6.28);
  var centerX = Number(params.centerX !== undefined && params.centerX !== null ? params.centerX : 0) / 100;
  var centerY = Number(params.centerY !== undefined && params.centerY !== null ? params.centerY : 0) / 100;
  var damping = Number(params.damping !== undefined && params.damping !== null ? params.damping : 0.02);
  var rippleMode = String(params.rippleMode || 'radial');
  var spiralTwist = Number(params.spiralTwist !== undefined && params.spiralTwist !== null ? params.spiralTwist : 2);
  var phaseSpeed = Number(params.phaseSpeed !== undefined && params.phaseSpeed !== null ? params.phaseSpeed : 0);
  var smoothSampling = Boolean(params.smoothSampling);
  var holeFill = String(params.holeFill || 'edge_copy');
  if (amplitude === 0) return pixels;
  var elapsed = pxElapsed(currentFrame, frameRate);
  var timePhase = speed * elapsed + phaseSpeed * elapsed;
  var cx = w / 2 + centerX * w / 2;
  var cy = h / 2 + centerY * h / 2;
  var effectiveAmplitude = amplitude * 1;
  var result = pxEmptyGrid(h, w);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var dx = x - cx;
      var dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.001) {
        result[y][x] = pixels[y][x];
        continue;
      }
      var dampFactor = Math.exp(-damping * dist);
      var wave = Math.sin(2 * Math.PI * dist * frequency - timePhase);
      var displacement = effectiveAmplitude * wave * dampFactor;
      var dirX, dirY;
      if (rippleMode === 'spiral') {
        var angle = Math.atan2(dy, dx) + spiralTwist * dist * 0.01;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
      } else {
        dirX = dx / dist;
        dirY = dy / dist;
      }
      var srcX = x - displacement * dirX;
      var srcY = y - displacement * dirY;
      if (smoothSampling) {
        var sx0 = Math.floor(srcX), sy0 = Math.floor(srcY);
        var sx1 = sx0 + 1, sy1 = sy0 + 1;
        var c00 = (sx0 >= 0 && sx0 < w && sy0 >= 0 && sy0 < h) ? pixels[sy0][sx0] : null;
        var c10 = (sx1 >= 0 && sx1 < w && sy0 >= 0 && sy0 < h) ? pixels[sy0][sx1] : null;
        var c01 = (sx0 >= 0 && sx0 < w && sy1 >= 0 && sy1 < h) ? pixels[sy1][sx0] : null;
        var c11 = (sx1 >= 0 && sx1 < w && sy1 >= 0 && sy1 < h) ? pixels[sy1][sx1] : null;
        if (c00) result[y][x] = c00;
        else if (c10) result[y][x] = c10;
        else if (c01) result[y][x] = c01;
        else if (c11) result[y][x] = c11;
      } else {
        var sx = Math.round(srcX);
        var sy = Math.round(srcY);
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) result[y][x] = pixels[sy][sx];
      }
    }
  }
  pxHoleFill(result, holeFill);
  return result;
}
function pxLocalInflate(pixels, params) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var h = grid.h, w = grid.w;
  var cx = Number(params.centerX !== undefined && params.centerX !== null ? params.centerX : w / 2);
  var cy = Number(params.centerY !== undefined && params.centerY !== null ? params.centerY : h / 2);
  var radius = Math.max(0.001, Number(params.radius !== undefined && params.radius !== null ? params.radius : Math.min(w, h) / 4));
  var strength = Number(params.strength !== undefined && params.strength !== null ? params.strength : 4);
  var falloff = Number(params.falloff !== undefined && params.falloff !== null ? params.falloff : 1);
  var result = [];
  for (var y = 0; y < h; y++) {
    var row = [];
    for (var x = 0; x < w; x++) {
      var dx = x - cx;
      var dy = y - cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius && d > 0.0001) {
        var t = 1 - d / radius;
        var disp = strength * Math.pow(t, falloff);
        var sx = Math.round(x - (dx / d) * disp);
        var sy = Math.round(y - (dy / d) * disp);
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          row.push(pixels[sy] ? (pixels[sy][sx] !== undefined ? pixels[sy][sx] : null) : null);
        } else {
          row.push(null);
        }
      } else {
        row.push(pixels[y] ? (pixels[y][x] !== undefined ? pixels[y][x] : null) : null);
      }
    }
    result.push(row);
  }
  return result;
}
function pxFxNum(p, k, d) {
  var v = Number(p[k]);
  return Number.isFinite(v) ? v : d;
}
function pxFxStr(p, k, d) {
  var v = p[k];
  return typeof v === 'string' && v ? v : d;
}
function pxFxClone(pixels) {
  return pixels.map(function (row) { return row.slice(); });
}
function pxFxStamp(out, x, y, color, onlyEmpty) {
  if (y < 0 || y >= out.length) return;
  var row = out[y];
  if (x < 0 || x >= row.length) return;
  if (onlyEmpty && row[x]) return;
  row[x] = color;
}
function pxFxHexRgb(hex) {
  var m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
function pxFxMixHex(a, b, f) {
  var ca = pxFxHexRgb(a), cb = pxFxHexRgb(b);
  var t = Math.max(0, Math.min(1, f));
  var v = ca.map(function (c, i) { return Math.round(c + (cb[i] - c) * t); });
  return '#' + v.map(function (c) { return c.toString(16).padStart(2, '0'); }).join('');
}
function pxFxHash01() {
  var s = 0;
  for (var i = 0; i < arguments.length; i++) s += (arguments[i] + 1) * 2654435761 % 4294967296;
  var x = Math.sin(s * 0.0000168079 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function pxFxVnoise(x, y, seed) {
  var xi = Math.floor(x), yi = Math.floor(y);
  var xf = x - xi, yf = y - yi;
  var su = xf * xf * (3 - 2 * xf), sv = yf * yf * (3 - 2 * yf);
  var a = pxFxHash01(xi, yi, seed), b = pxFxHash01(xi + 1, yi, seed);
  var c = pxFxHash01(xi, yi + 1, seed), d = pxFxHash01(xi + 1, yi + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
function pxFxSilhouette(pixels, w, h) {
  function solid(x, y) { return x >= 0 && y >= 0 && x < w && y < h && !!pixels[y][x]; }
  var count = 0, cx = 0, cy = 0, groundY = -1;
  var tops = [];
  for (var ti = 0; ti < w; ti++) tops.push(-1);
  var boundary = [];
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (!pixels[y][x]) continue;
      count++; cx += x; cy += y;
      if (tops[x] === -1) tops[x] = y;
      if (y > groundY) groundY = y;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) boundary.push([x, y]);
    }
  }
  return { solid: solid, count: count, cx: count ? cx / count : w / 2, cy: count ? cy / count : h / 2, groundY: groundY, tops: tops, boundary: boundary };
}
function pxHeatFlame(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var w = grid.w, h = grid.h;
  var out = pxFxClone(pixels);
  var sil = pxFxSilhouette(pixels, w, h);
  if (!sil.count) return out;
  var heightPx = Math.max(2, pxFxNum(params, 'heightPx', 14));
  var speed = pxFxNum(params, 'speed', 1.2);
  var seed = pxFxNum(params, 'seed', 3);
  var hot = pxFxStr(params, 'colorHot', '#fff3c4');
  var cool = pxFxStr(params, 'colorCool', '#ff5a00');
  var t = pxElapsed(currentFrame, frameRate);
  for (var x = 0; x < w; x++) {
    var top = sil.tops[x];
    if (top < 0) continue;
    var n = pxFxVnoise(x * 0.33, t * speed * 2 + seed * 7.7, seed | 0);
    var fh = Math.max(1, Math.round(heightPx * (0.45 + 0.55 * n)));
    for (var k = 1; k <= fh; k++) {
      var y = top - k;
      if (y < 0) break;
      var sway = Math.round((pxFxVnoise(x * 0.2, t * speed * 2 + k * 0.35, (seed | 0) + 40) - 0.5) * k * 0.36);
      var heat = 1 - k / (fh + 1);
      pxFxStamp(out, x + sway, y, pxFxMixHex(cool, hot, Math.pow(heat, 1.35)), true);
    }
  }
  return out;
}
function pxCrystalCage(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var w = grid.w, h = grid.h;
  var out = pxFxClone(pixels);
  var sil = pxFxSilhouette(pixels, w, h);
  if (!sil.boundary.length) return out;
  var count = Math.max(1, Math.min(16, Math.round(pxFxNum(params, 'count', 6))));
  var lengthPx = Math.max(3, pxFxNum(params, 'lengthPx', 16));
  var speed = pxFxNum(params, 'speed', 0.8);
  var seed = pxFxNum(params, 'seed', 5);
  var color = pxFxStr(params, 'color', '#9fe8ff');
  var core = pxFxStr(params, 'coreColor', '#ffffff');
  var t = pxElapsed(currentFrame, frameRate);
  var B = sil.boundary.length;
  for (var i = 0; i < count; i++) {
    var idx = Math.min(B - 1, Math.floor((i + pxFxHash01(seed, i, 7) * 0.6) * (B / count)));
    var ax = sil.boundary[idx][0], ay = sil.boundary[idx][1];
    var dx = ax - sil.cx, dy = ay - sil.cy;
    var dl = Math.hypot(dx, dy);
    if (dl < 0.5) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
    var pulse = 0.85 + 0.15 * Math.sin(t * speed * Math.PI * 2 + i * 1.7);
    var L = Math.max(2, Math.round(lengthPx * pulse));
    for (var s = 1; s <= L; s++) {
      var px = ax + dx * s, py = ay + dy * s;
      pxFxStamp(out, Math.round(px), Math.round(py), core, true);
      if (s < L * 0.7) {
        pxFxStamp(out, Math.round(px - dy), Math.round(py + dx), color, true);
        pxFxStamp(out, Math.round(px + dy), Math.round(py - dx), color, true);
      }
    }
  }
  return out;
}
function pxVoidVortex(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var w = grid.w, h = grid.h;
  var out = pxFxClone(pixels);
  var arms = Math.max(1, Math.min(8, Math.round(pxFxNum(params, 'arms', 3))));
  var speed = pxFxNum(params, 'speed', 0.5);
  var seed = pxFxNum(params, 'seed', 7);
  var color = pxFxStr(params, 'color', '#b18cff');
  var deep = pxFxStr(params, 'colorDeep', '#4a1e80');
  var t = pxElapsed(currentFrame, frameRate);
  var cx = w / 2, cy = h / 2;
  var R = pxFxNum(params, 'radius', 0) > 0 ? pxFxNum(params, 'radius', 0) : Math.min(w, h) * 0.72;
  var steps = 46;
  var tick = Math.floor(t * 8);
  for (var a = 0; a < arms; a++) {
    for (var j = 0; j < steps; j++) {
      var f = j / steps;
      if (pxFxHash01(seed, a, j, tick) > 1 - f * 0.75) continue;
      var ang = a * (Math.PI * 2 / arms) + f * 4.2 + t * speed * Math.PI * 2;
      var r = 2 + f * R;
      var x = Math.round(cx + Math.cos(ang) * r);
      var y = Math.round(cy + Math.sin(ang) * r * 0.8);
      pxFxStamp(out, x, y, pxFxMixHex(color, deep, f), true);
      if (f < 0.4) pxFxStamp(out, x + 1, y, pxFxMixHex(color, deep, f), true);
    }
  }
  return out;
}
function pxGroundWave(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var w = grid.w, h = grid.h;
  var out = pxFxClone(pixels);
  var sil = pxFxSilhouette(pixels, w, h);
  if (!sil.count || sil.groundY < 0) return out;
  var speed = pxFxNum(params, 'speed', 0.9);
  var seed = pxFxNum(params, 'seed', 11);
  var color = pxFxStr(params, 'color', '#d8c9a3');
  var deep = pxFxStr(params, 'colorDeep', '#8a7648');
  var t = pxElapsed(currentFrame, frameRate);
  var bx = 0, bn = 0;
  for (var gx = 0; gx < w; gx++) if (pixels[sil.groundY][gx]) { bx += gx; bn++; }
  var cxB = bn ? bx / bn : w / 2;
  var gy = sil.groundY;
  for (var ring = 0; ring < 2; ring++) {
    var ph = (t * speed + ring * 0.5) % 1;
    var rx = 2 + ph * w * 0.52;
    var ry = Math.max(1, rx * 0.3);
    var pts = Math.max(12, Math.round(rx * 2.2));
    for (var vi = 0; vi < pts; vi++) {
      var th = (vi / pts) * Math.PI * 2;
      var x = Math.round(cxB + Math.cos(th) * rx);
      var y = Math.round(gy + Math.sin(th) * ry * 0.5);
      if (pxFxHash01(seed, ring, vi, Math.floor(t * 8)) > 1 - ph * 0.55) continue;
      var c = pxFxMixHex(color, deep, ph);
      if (y >= gy - 1) pxFxStamp(out, x, y, c, false);
      else pxFxStamp(out, x, y, c, true);
    }
    if (ph < 0.35) {
      for (var k = 0; k < 3; k++) {
        var d = 2 + k * 2 + Math.floor(ph * 8);
        pxFxStamp(out, Math.round(cxB - d), gy, deep, false);
        pxFxStamp(out, Math.round(cxB + d), gy, deep, false);
      }
    }
  }
  return out;
}
function pxSwordRing(pixels, params, currentFrame, frameRate) {
  var grid = pxGuard(pixels, 1);
  if (!grid) return pixels;
  var w = grid.w, h = grid.h;
  var out = pxFxClone(pixels);
  var count = Math.max(1, Math.min(12, Math.round(pxFxNum(params, 'count', 5))));
  var speed = pxFxNum(params, 'speed', 0.45);
  var color = pxFxStr(params, 'color', '#d9ecff');
  var edge = pxFxStr(params, 'colorEdge', '#5a7ea6');
  var t = pxElapsed(currentFrame, frameRate);
  var cx = w / 2, cy = h / 2;
  var orbitRX = (pxFxNum(params, 'orbitRX', 130) / 100) * (w / 2);
  var orbitRY = (pxFxNum(params, 'orbitRY', 62) / 100) * (h / 2);
  var L = Math.max(5, Math.round(Math.min(w, h) * 0.34));
  for (var i = 0; i < count; i++) {
    var ang = t * speed * Math.PI * 2 + i * (Math.PI * 2 / count);
    var px = cx + Math.cos(ang) * orbitRX;
    var py = cy + Math.sin(ang) * orbitRY;
    var tx = -Math.sin(ang) * orbitRX, ty = Math.cos(ang) * orbitRY;
    var tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    var nx = -ty, ny = tx;
    for (var s = -Math.floor(L / 2); s <= Math.floor(L / 2); s++) {
      var bx2 = px + tx * s, by2 = py + ty * s;
      var isTip = Math.abs(s) >= Math.floor(L / 2) - 1;
      pxFxStamp(out, Math.round(bx2), Math.round(by2), color, true);
      if (!isTip) {
        pxFxStamp(out, Math.round(bx2 + nx), Math.round(by2 + ny), edge, true);
        pxFxStamp(out, Math.round(bx2 - nx), Math.round(by2 - ny), edge, true);
      }
      if (s === -Math.floor(L / 6)) {
        pxFxStamp(out, Math.round(bx2 + nx * 2), Math.round(by2 + ny * 2), edge, true);
        pxFxStamp(out, Math.round(bx2 - nx * 2), Math.round(by2 - ny * 2), edge, true);
      }
    }
  }
  return out;
}
var PX_PIXEL_TYPES = {
  color_replace: 1, outline: 1, cleanup: 1, dither: 1, pixel_displace: 1,
  mirror: 1, flip: 1, cylinder_rotate: 1, sphere_rotate: 1,
  bend: 1, elliptical_compress: 1, dumbbell_stretch: 1, pillow_stretch: 1,
  hyperbolic_stretch: 1, ring_ripple: 1, local_inflate: 1,
  heat_flame: 1, crystal_cage: 1, void_vortex: 1, ground_wave: 1, sword_ring: 1,
};
function evalPixelChain(nodes, outId, ctx) {
  ctx = ctx || {};
  var frame = ctx.frame || 0;
  var frameRate = ctx.frameRate || 60;
  var vars = ctx.vars || {};
  var nodeState = ctx.nodeState || new Map();
  var nodeOutputs = ctx.nodeOutputs || new Map();
  var statePrefix = ctx.statePrefix || '';
  var byId = new Map();
  for (var ni = 0; ni < nodes.length; ni++) byId.set(nodes[ni].id, nodes[ni]);
  var memo = new Map();
  var visiting = new Set();
  function timeValue() { return frameRate > 0 ? frame / frameRate : 0; }
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
  function rawInput(node, port) {
    var inputs = node.inputs || {};
    if (!Object.prototype.hasOwnProperty.call(inputs, port)) return undefined;
    var inp = inputs[port];
    if (inp && inp.n !== undefined) {
      var src = nodeValue(inp.n);
      return src[inp.o || 'out'];
    }
    if (inp && inp.v !== undefined) return inp.v;
    if (inp && inp.s !== undefined) return { __pxs: inp.s };
    return undefined;
  }
  function unwrapStr(v) {
    return v && typeof v === 'object' && '__pxs' in v ? v.__pxs : v;
  }
  function P(node, port, dflt) {
    var inputs = node.inputs || {};
    if (Object.prototype.hasOwnProperty.call(inputs, port)) {
      var v = rawInput(node, port);
      return v === undefined ? 0 : v;
    }
    if (node.params && node.params[port] !== undefined) return node.params[port];
    return dflt;
  }
  function PN(node, port, dflt) { var v = P(node, port, dflt); var x = Number(v); return isFinite(x) ? x : dflt; }
  function numOf(v) { var x = Number(unwrapStr(v)); return isFinite(x) ? x : 0; }
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
  function pixelParams(node, mode) {
    var params = {};
    var src = node.params || {};
    for (var k in src) params[k] = src[k];
    var inputs = node.inputs || {};
    for (var port in inputs) {
      if (port === 'pixels' || port === 't' || port === 'gate') continue;
      var v = rawInput(node, port);
      if (mode === 'num') params[port] = v === undefined ? 0 : numOf(v);
      else params[port] = v === undefined ? 0 : unwrapStr(v);
    }
    return params;
  }
  function bypassPixels(node) {
    var pin = node.inputs && node.inputs.pixels;
    if (pin && pin.n !== undefined) {
      var src = nodeValue(pin.n);
      var px = src[pin.o || 'pixels'];
      return px !== undefined ? { pixels: px } : {};
    }
    return {};
  }
  function evalNode(node) {
    var prm = node.params || {};
    if (prm.enabled === false) {
      return PX_PIXEL_TYPES[node.type] ? bypassPixels(node) : {};
    }
    if (node.inputs && Object.prototype.hasOwnProperty.call(node.inputs, 'gate')) {
      if (PN(node, 'gate', 1) < 0.5) {
        return PX_PIXEL_TYPES[node.type] ? bypassPixels(node) : {};
      }
    }
    switch (node.type) {
      case 'sprite_source': return ctx.pixels ? { pixels: ctx.pixels } : {};
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
        var vv = vars[String(prm.name !== undefined ? prm.name : '')];
        return { out: Number(vv !== undefined ? vv : (prm.default !== undefined ? prm.default : 0)) };
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
        var omega = Math.sqrt(spStiff / spMass);
        var gamma = spDamp / (2 * spMass);
        var dOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
        var spVal = (spRest > 0 ? spRest : spAmp) * Math.exp(-gamma * spt) * Math.cos(dOmega * spt) + spRest;
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
    if (PX_PIXEL_TYPES[node.type]) {
      var pixIn = rawInput(node, 'pixels');
      if (pixIn === undefined || pixIn === null || !Array.isArray(pixIn)) return {};
      var ty = node.type;
      if (ty === 'mirror') return { pixels: pixIn.map(function (row) { return row.slice().reverse(); }) };
      if (ty === 'flip') return { pixels: pixIn.slice().reverse() };
      if (ty === 'color_replace') {
        var rp = pixelParams(node, 'raw');
        return { pixels: pxColorReplace(pixIn, String(rp.sourceColor), String(rp.targetColor), Number(rp.tolerance) || 0) };
      }
      if (ty === 'outline') {
        var op = pixelParams(node, 'raw');
        return { pixels: pxOutline(pixIn,
          Number(op.thickness) || 1,
          (op.color && String(op.color)) || '#000000',
          String(op.directions !== undefined && op.directions !== null ? op.directions : '8'),
          String(op.outlineMode !== undefined && op.outlineMode !== null ? op.outlineMode : 'solid'),
          String(op.blendMode !== undefined && op.blendMode !== null ? op.blendMode : 'normal'),
          op.edgesOnly !== undefined ? Boolean(op.edgesOnly) : true,
          Number(op.lightAngle !== undefined && op.lightAngle !== null ? op.lightAngle : 315)) };
      }
      if (ty === 'dither') {
        var dp = pixelParams(node, 'raw');
        return { pixels: pxDither(pixIn, String(dp.pattern) || 'bayer4') };
      }
      if (ty === 'pixel_displace') {
        var xp = pixelParams(node, 'num');
        return { pixels: pxPixelDisplace(pixIn, Number(xp.intensity) || 2, Number(xp.frequency) || 0.1, frame) };
      }
      if (ty === 'cleanup') {
        var cp = pixelParams(node, 'num');
        return { pixels: pxCleanup(pixIn, cp.minSize) };
      }
      if (ty === 'cylinder_rotate') {
        var yp = pixelParams(node, 'raw');
        return { pixels: pxCylinderRotate(pixIn,
          Number(yp.angle) || 0,
          Number(yp.axisOffsetX) || 0,
          Number(yp.radiusShrinkRatio !== undefined && yp.radiusShrinkRatio !== null ? yp.radiusShrinkRatio : (yp.radiusScale !== undefined && yp.radiusScale !== null ? yp.radiusScale : 1)),
          String(yp.projection) || 'front',
          Boolean(yp.smooth),
          String(yp.backFill !== undefined && yp.backFill !== null ? yp.backFill : (Boolean(yp.seamFill) ? 'cyclic' : 'none'))) };
      }
      if (ty === 'sphere_rotate') {
        var zp = pixelParams(node, 'raw');
        return { pixels: pxSphereRotate(pixIn,
          Number(zp.angle) || 0,
          String(zp.mode) || 'segmented',
          Number(zp.centerX) || 0,
          Number(zp.centerY) || 0,
          Number(zp.maxLatitude) || 85,
          Number(zp.radiusShrinkRatio !== undefined && zp.radiusShrinkRatio !== null ? zp.radiusShrinkRatio : (zp.radiusScale !== undefined && zp.radiusScale !== null ? zp.radiusScale : 1)),
          String(zp.backFill || 'cyclic')) };
      }
      var gp = pixelParams(node, 'num');
      if (ty === 'bend') return { pixels: pxBend(pixIn, gp, frame, frameRate) };
      if (ty === 'elliptical_compress') return { pixels: pxEllipticalCompress(pixIn, gp, frame, frameRate) };
      if (ty === 'dumbbell_stretch') return { pixels: pxDumbbellStretch(pixIn, gp, frame, frameRate) };
      if (ty === 'pillow_stretch') return { pixels: pxPillowStretch(pixIn, gp, frame, frameRate) };
      if (ty === 'hyperbolic_stretch') return { pixels: pxHyperbolicStretch(pixIn, gp, frame, frameRate) };
      if (ty === 'ring_ripple') return { pixels: pxRingRipple(pixIn, gp, frame, frameRate) };
      if (ty === 'local_inflate') return { pixels: pxLocalInflate(pixIn, gp) };
      if (ty === 'heat_flame') return { pixels: pxHeatFlame(pixIn, gp, frame, frameRate) };
      if (ty === 'crystal_cage') return { pixels: pxCrystalCage(pixIn, gp, frame, frameRate) };
      if (ty === 'void_vortex') return { pixels: pxVoidVortex(pixIn, gp, frame, frameRate) };
      if (ty === 'ground_wave') return { pixels: pxGroundWave(pixIn, gp, frame, frameRate) };
      if (ty === 'sword_ring') return { pixels: pxSwordRing(pixIn, gp, frame, frameRate) };
      return {};
    }
    return {};
  }
  if (!byId.has(outId)) return null;
  var rec = nodeValue(outId);
  // 断链（终点无像素输出）：编辑器 screen 以空网格上屏，如实返回 []
  return rec && rec.pixels !== undefined ? rec.pixels : [];
}
`;

/** 像素链支持的节点类型（convert 提取校验与方言标注共用） */
export const PIXEL_CHAIN_PIXEL_TYPES = [
  'color_replace', 'outline', 'cleanup', 'dither', 'pixel_displace',
  'mirror', 'flip', 'cylinder_rotate', 'sphere_rotate',
  'bend', 'elliptical_compress', 'dumbbell_stretch', 'pillow_stretch',
  'hyperbolic_stretch', 'ring_ripple', 'local_inflate',
  'heat_flame', 'crystal_cage', 'void_vortex', 'ground_wave', 'sword_ring',
] as const;

/** 像素链数值子图可用的节点类型（与 eval-src 实现集对齐） */
export const PIXEL_CHAIN_NUMERIC_TYPES = [
  'time', 'timeGate', 'const', 'var',
  'add', 'sub', 'mul', 'div', 'blend', 'sin', 'cos', 'keyframes',
  'waveform', 'ease', 'timeRemap', 'switch', 'step', 'hold', 'nodeRef',
  'pendulum', 'breath', 'shake', 'float', 'wobble', 'bounce', 'elastic',
  'wheel', 'noise', 'wave', 'spring', 'jitter',
  'translate', 'rotate', 'uniform_scale', 'skew', 'non_uniform_stretch',
  'curve',
] as const;

/** 探针/测试用：在 Node 里加载像素链求值器（与模板内嵌的是同一份源） */
export function createPixelRuntime(): {
  evalPixelChain: (
    nodes: unknown,
    outId: string,
    ctx?: Record<string, unknown>,
  ) => (string | null)[][] | null;
} {
  const factory = new Function(`${PIXEL_SRC}\nreturn { evalPixelChain };`);
  return factory() as never;
}
