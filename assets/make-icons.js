'use strict';

/**
 * 图标生成脚本（零依赖，仅使用 Node 内置 zlib）
 * 运行：node assets/make-icons.js
 * 产出：
 *   assets/icon.png       512x512  应用图标（窗口/通用）
 *   assets/tray-icon.png  64x64    托盘图标
 *   assets/icon.ico       16/32/48/64/256 多尺寸（Windows 打包用）
 *   assets/icon.icns      128/256/512/1024（macOS 打包用）
 * 图案：淡粉圆角方形 + 白色手绘内边框 + 深粉爱心 + 白色小星星点缀
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 像素绘制 ---------------- */

function surface(size) {
  return { size, px: Buffer.alloc(size * size * 4) };
}

function blend(s, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= s.size || y >= s.size || a <= 0) return;
  const i = (y * s.size + x) * 4;
  const ia = s.px[i + 3] / 255;
  const na = a / 255;
  const oa = na + ia * (1 - na);
  if (oa <= 0) return;
  s.px[i] = Math.round((r * na + s.px[i] * ia * (1 - na)) / oa);
  s.px[i + 1] = Math.round((g * na + s.px[i + 1] * ia * (1 - na)) / oa);
  s.px[i + 2] = Math.round((b * na + s.px[i + 2] * ia * (1 - na)) / oa);
  s.px[i + 3] = Math.round(oa * 255);
}

function inRoundedRect(size, x, y, inset, radius) {
  const h = size / 2 - inset;
  const r = Math.max(1, radius - inset);
  const dx = Math.abs(x + 0.5 - size / 2);
  const dy = Math.abs(y + 0.5 - size / 2);
  if (dx > h || dy > h) return false;
  if (dx <= h - r || dy <= h - r) return true;
  const ex = dx - (h - r);
  const ey = dy - (h - r);
  return ex * ex + ey * ey <= r * r;
}

// 心形隐函数: (x^2+y^2-1)^3 - x^2*y^3 <= 0 （y 轴向上）
function inHeart(u, v) {
  const a = u * u + v * v - 1;
  return a * a * a - u * u * v * v * v <= 0;
}

// 四角星（加号 + 菱形）
function inSparkle(x, y, r) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const d = ax + ay;
  const m = Math.min(ax, ay);
  return (d <= r && m <= r * 0.22) || d <= r * 0.5;
}

function drawIcon(size) {
  const s = surface(size);
  const R = size * 0.24; // 爱心缩放半径
  const cx = size * 0.5;
  const cy = size * 0.56;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 1) 背景圆角方形（粉白 -> 浅粉 渐变）
      if (!inRoundedRect(size, x, y, 0, size * 0.26)) continue;
      const t = y / size;
      const bgR = 255;
      const bgG = Math.round(247 - 13 * t);
      const bgB = Math.round(250 - 8 * t);
      blend(s, x, y, bgR, bgG, bgB, 255);

      // 2) 白色手绘内边框
      const inOuter = inRoundedRect(size, x, y, size * 0.055, size * 0.24);
      const inInner = inRoundedRect(size, x, y, size * 0.10, size * 0.22);
      if (inOuter && !inInner) blend(s, x, y, 255, 255, 255, 235);

      // 3) 爱心
      const u = (x + 0.5 - cx) / R;
      const v = (cy - y - 0.5) / R;
      if (inHeart(u, v)) {
        const deep = u * u + v * v > 1.4; // 边缘略深
        blend(s, x, y, deep ? 224 : 244, deep ? 123 : 164, deep ? 98 : 138, 255);
      }
      // 爱心高光
      const hu = (x + 0.5 - (cx - R * 0.42)) / (R * 0.30);
      const hv = (cy - y - 0.5 - R * 0.42) / (R * 0.22);
      if (hu * hu + hv * hv <= 1) blend(s, x, y, 255, 255, 255, 110);

      // 4) 小星星点缀
      const sx = x + 0.5 - size * 0.78;
      const sy = y + 0.5 - size * 0.24;
      if (inSparkle(sx, sy, size * 0.075)) blend(s, x, y, 255, 255, 255, 230);

      const sx2 = x + 0.5 - size * 0.20;
      const sy2 = y + 0.5 - size * 0.80;
      if (inSparkle(sx2, sy2, size * 0.05)) blend(s, x, y, 246, 198, 216, 235);
    }
  }
  return s;
}

/* ---------------- ICO / ICNS ---------------- */

function buildICO(sizeList) {
  const images = sizeList.map((n) => ({ size: n, png: encodePNG(drawIcon(n).px, n) }));
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const dirSize = 16 * count;
  let offset = 6 + dirSize;
  const entries = images.map((img) => {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size; // width
    e[1] = img.size >= 256 ? 0 : img.size; // height
    e[2] = 0; // palette
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(img.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.png.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

function buildICNS(sizeList) {
  const ostypes = { 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
  const entries = sizeList.map((n) => {
    const png = encodePNG(drawIcon(n).px, n);
    const head = Buffer.alloc(8);
    head.write(ostypes[n] || 'ic09', 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const total = 8 + entries.reduce((sum, e) => sum + e.length, 0);
  const magic = Buffer.alloc(8);
  magic.write('icns', 0, 'ascii');
  magic.writeUInt32BE(total, 4);
  return Buffer.concat([magic, ...entries]);
}

/* ---------------- 输出 ---------------- */

const outDir = __dirname;
const jobs = [
  ['icon.png', encodePNG(drawIcon(512).px, 512)],
  ['tray-icon.png', encodePNG(drawIcon(64).px, 64)],
  ['icon.ico', buildICO([16, 32, 48, 64, 256])],
  ['icon.icns', buildICNS([128, 256, 512, 1024])],
];

for (const [name, buf] of jobs) {
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`生成 ${name} (${(buf.length / 1024).toFixed(1)} KB)`);
}
console.log('全部图标生成完毕 ♥');
