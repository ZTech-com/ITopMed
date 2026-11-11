/**
 * Generates the PWA / home-screen PNG icons without native dependencies:
 * a rounded square with the ITop Med blue gradient and a white medical cross.
 *   npx tsx scripts/generate-icons.ts
 * Output: public/icons/*.png (committed), referenced by src/app/manifest.ts.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size: number, rgba: Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** maskable: full-bleed background (OS applies the mask) and a smaller cross in the safe zone. */
function draw(size: number, opts: { maskable?: boolean; radius?: number }) {
  const out = new Uint8Array(size * size * 4);
  const S = 4; // supersampling
  const r = opts.maskable ? 0 : (opts.radius ?? 0.22) * size;
  const arm = (opts.maskable ? 0.27 : 0.33) * size; // half length of cross arm
  const thick = (opts.maskable ? 0.075 : 0.09) * size; // half thickness
  const c = size / 2;
  const insideRounded = (x: number, y: number) => {
    if (r === 0) return true;
    const dx = Math.max(r - x, 0, x - (size - r));
    const dy = Math.max(r - y, 0, y - (size - r));
    return dx * dx + dy * dy <= r * r;
  };
  const insideCross = (x: number, y: number) => {
    const ax = Math.abs(x - c);
    const ay = Math.abs(y - c);
    const bar = (u: number, v: number) => (u <= arm - thick && v <= thick) || (u > arm - thick && (u - (arm - thick)) ** 2 + v ** 2 <= thick ** 2 && u <= arm);
    return bar(ax, ay) || bar(ay, ax);
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S;
          const y = py + (sy + 0.5) / S;
          if (insideRounded(x, y)) {
            bg++;
            if (insideCross(x, y)) fg++;
          }
        }
      const t = (px + py) / (2 * size); // diagonal gradient #2b8cff → #0a55c4
      const R = 0x2b + (0x0a - 0x2b) * t;
      const G = 0x8c + (0x55 - 0x8c) * t;
      const B = 0xff + (0xc4 - 0xff) * t;
      const f = fg / (S * S);
      const a = bg / (S * S);
      const i = (py * size + px) * 4;
      out[i] = Math.round(R * (1 - f) + 255 * f);
      out[i + 1] = Math.round(G * (1 - f) + 255 * f);
      out[i + 2] = Math.round(B * (1 - f) + 255 * f);
      out[i + 3] = Math.round(255 * a);
    }
  }
  return png(size, out);
}

const dir = path.join(process.cwd(), "public", "icons");
fs.mkdirSync(dir, { recursive: true });
const files: [string, Buffer][] = [
  ["icon-192.png", draw(192, {})],
  ["icon-512.png", draw(512, {})],
  ["maskable-512.png", draw(512, { maskable: true })],
  ["maskable-192.png", draw(192, { maskable: true })],
  // iOS ignores transparency and applies its own rounding: full-bleed square.
  ["apple-touch-icon.png", draw(180, { maskable: true })],
  ["favicon-32.png", draw(32, { radius: 0.2 })],
];
for (const [name, buf] of files) fs.writeFileSync(path.join(dir, name), buf);
console.log(`Generated ${files.length} icons in public/icons`);
