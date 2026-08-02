// Icon generator — run `node icon.js` to rebuild icon16/48/128.png.
// Not part of the extension. A PNG is deflated scanlines plus three chunks, and zlib is in Node's
// stdlib, so this needs no dependencies and the artwork stays editable instead of being a binary
// blob nobody can change.
const zlib = require("zlib");
const fs = require("fs");

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A point is inside a rounded rect when it is within r of the rect shrunk by r on every side.
const inRound = (px, py, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

// A caption line with one word picked out — the whole product in three bars.
const BG_TOP = [0x1b, 0x1b, 0x24];
const BG_BOT = [0x10, 0x10, 0x16];
const BARS = [
  { x0: 0.16, x1: 0.84, y0: 0.34, y1: 0.46, c: [0xf2, 0xf2, 0xf4] },
  { x0: 0.16, x1: 0.5, y0: 0.56, y1: 0.68, c: [0xff, 0xcc, 0x00] }, // the highlighted word
  { x0: 0.55, x1: 0.84, y0: 0.56, y1: 0.68, c: [0x5a, 0x5a, 0x66] },
];

// Rendered at 4x and boxed down: cheap antialiasing, and the only way rounded corners survive 16px.
function render(size, ss = 4) {
  const n = size * ss;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = (x * ss + sx + 0.5) / n;
          const py = (y * ss + sy + 0.5) / n;
          if (!inRound(px, py, 0, 0, 1, 1, 0.22)) continue;
          const t = py;
          let c = BG_TOP.map((v, i) => v + (BG_BOT[i] - v) * t);
          for (const bar of BARS) {
            const h = (bar.y1 - bar.y0) / 2;
            if (inRound(px, py, bar.x0, bar.y0, bar.x1, bar.y1, h)) c = bar.c;
          }
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const k = (y * size + x) * 4;
      const hits = a / 255;
      // Straight (non-premultiplied) alpha: average the colour over covered samples only.
      out[k] = hits ? r / hits : 0;
      out[k + 1] = hits ? g / hits : 0;
      out[k + 2] = hits ? b / hits : 0;
      out[k + 3] = a / (ss * ss);
    }
  }
  return png(size, size, out);
}

for (const size of [16, 48, 128]) {
  fs.writeFileSync(`icon${size}.png`, render(size));
  console.log(`icon${size}.png`);
}
