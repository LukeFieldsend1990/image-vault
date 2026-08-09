/**
 * Minimal text extraction from a Chromium-generated PDF.
 *
 * Written rather than pulled from npm because the whole point of the print
 * check is to assert that certain strings are *absent* from the PDF, and an
 * extractor that quietly returns nothing turns every absence assertion into a
 * false pass. A dependency would hide that; forty lines of parsing here can be
 * checked against a known-present string on every run, which is what
 * `print-custody-check.mjs` does before trusting any absence.
 *
 * What Chromium actually emits, and therefore what this has to handle:
 *
 *   - Every content stream is FlateDecode-compressed, so the raw bytes contain
 *     no readable text at all.
 *   - Fonts are subset Type3 fonts, so the string literals hold glyph indices,
 *     not characters. Each font carries a `/ToUnicode` CMap that maps them back.
 *   - Those indices are font-scoped and collide freely between fonts, so the
 *     current font has to be tracked through `Tf` operators rather than merging
 *     every CMap into one table.
 *   - Text is written as hex strings (`<17> Tj`), usually one glyph per
 *     operator with `Td` moves in between, so words arrive letter by letter.
 */

import { inflateSync } from "node:zlib";

/** Inflate every FlateDecode stream, keyed by the object number that owns it. */
function parseObjects(raw) {
  const objects = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const num = Number(m[1]);
    const end = raw.indexOf("endobj", m.index);
    if (end === -1) continue;
    const body = raw.slice(m.index, end);
    let stream = null;
    const sm = /stream\r?\n/.exec(body);
    if (sm) {
      const start = sm.index + sm[0].length;
      const se = body.indexOf("endstream", start);
      if (se !== -1) {
        try {
          stream = inflateSync(Buffer.from(body.slice(start, se), "latin1")).toString("latin1");
        } catch {
          /* image or font program, not text */
        }
      }
    }
    objects.set(num, { body, stream });
  }
  return objects;
}

function hexToString(hex) {
  let s = "";
  for (let i = 0; i + 1 < hex.length; i += 4) {
    const unit = hex.slice(i, i + 4);
    if (unit.length < 4) break;
    s += String.fromCharCode(parseInt(unit, 16));
  }
  return s;
}

/** Parse a ToUnicode CMap into { width, map }. */
function parseCMap(src) {
  const map = new Map();
  let width = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(src);
  if (cs) {
    const first = /<([0-9a-fA-F]+)>/.exec(cs[1]);
    if (first) width = Math.max(1, first[1].length / 2);
  }
  for (const block of src.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const [, from, to] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(parseInt(from, 16), hexToString(to));
    }
  }
  for (const block of src.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const [, lo, hi, dst] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const start = parseInt(lo, 16);
      const end = parseInt(hi, 16);
      const base = parseInt(dst.slice(-4), 16);
      for (let i = 0; i <= end - start && i < 0x10000; i++) {
        map.set(start + i, String.fromCharCode(base + i));
      }
    }
  }
  return { width, map };
}

/** Resource name (`F4`) → its ToUnicode CMap. */
function buildFontTable(raw, objects) {
  const nameToObj = new Map();
  for (const dict of raw.match(/\/Font\s*<<[\s\S]*?>>/g) || []) {
    for (const [, name, num] of dict.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      nameToObj.set(name, Number(num));
    }
  }
  const fonts = new Map();
  for (const [name, num] of nameToObj) {
    const font = objects.get(num);
    if (!font) continue;
    const ref = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font.body);
    if (!ref) continue;
    const cmap = objects.get(Number(ref[1]));
    if (cmap?.stream) fonts.set(name, parseCMap(cmap.stream));
  }
  return fonts;
}

function decodeHex(hex, font) {
  if (!font) return "";
  const step = font.width * 2;
  let out = "";
  for (let i = 0; i + step <= hex.length; i += step) {
    out += font.map.get(parseInt(hex.slice(i, i + step), 16)) ?? "";
  }
  return out;
}

/** Literal strings are rare in Chromium output but cost little to support. */
function decodeLiteral(payload, font) {
  if (!font) return "";
  const bytes = [];
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] !== "\\") {
      bytes.push(payload.charCodeAt(i) & 0xff);
      continue;
    }
    const c = payload[++i];
    const simple = { n: 10, r: 13, t: 9, b: 8, f: 12 }[c];
    if (simple !== undefined) bytes.push(simple);
    else if (c >= "0" && c <= "7") {
      let oct = c;
      while (oct.length < 3 && payload[i + 1] >= "0" && payload[i + 1] <= "7") oct += payload[++i];
      bytes.push(parseInt(oct, 8));
    } else bytes.push(payload.charCodeAt(i) & 0xff);
  }
  let out = "";
  for (let i = 0; i + font.width <= bytes.length; i += font.width) {
    let code = 0;
    for (let k = 0; k < font.width; k++) code = (code << 8) | bytes[i + k];
    out += font.map.get(code) ?? "";
  }
  return out;
}

function streamText(stream, fonts) {
  const out = [];
  let font = null;
  // One pass over the stream, in document order, so `Tf` selects the font for
  // the operators that follow it.
  const ops = /\/(F\d+)[\d.\s]+Tf|<([0-9a-fA-F]*)>\s*Tj|\(((?:\\.|[^\\()])*)\)\s*Tj|\[((?:[^\][]|\\.)*)\]\s*TJ/g;
  let m;
  while ((m = ops.exec(stream)) !== null) {
    if (m[1]) font = fonts.get(m[1]) ?? null;
    else if (m[2] !== undefined) out.push(decodeHex(m[2], font));
    else if (m[3] !== undefined) out.push(decodeLiteral(m[3], font));
    else if (m[4] !== undefined) {
      for (const [, hex, lit] of m[4].matchAll(/<([0-9a-fA-F]*)>|\(((?:\\.|[^\\()])*)\)/g)) {
        out.push(hex !== undefined ? decodeHex(hex, font) : decodeLiteral(lit, font));
      }
    }
  }
  return out.join("");
}

/**
 * Text per printed page, in page order. Chromium emits one glyph per operator
 * with positioning between them, so no word or line structure survives — the
 * result is suitable for substring assertions and for eyeballing what landed on
 * which page, not for reading as prose.
 */
export function pdfPages(buf) {
  const raw = buf.toString("latin1");
  const objects = parseObjects(raw);
  const fonts = buildFontTable(raw, objects);

  const pages = [];
  for (const [, obj] of objects) {
    if (!/\/Type\s*\/Page[^s]/.test(obj.body)) continue;
    const ref = /\/Contents\s+(\d+)\s+0\s+R/.exec(obj.body);
    const content = ref ? objects.get(Number(ref[1]))?.stream : obj.stream;
    pages.push(content ? streamText(content, fonts) : "");
  }
  return pages;
}

export function pdfText(buf) {
  return pdfPages(buf).join("");
}

export function pdfPageCount(buf) {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}
