/**
 * wiegand-formats — access-control credential bit layouts, keyed by format ID.
 *
 * The single idea this package encodes: **a bit count is not a format.**
 * 32 bits has at least five mutually incompatible splits, 37 bits at least four,
 * 36 bits at least four. Code that switches on `bits` alone answers some of its
 * callers with a number that looks right and opens the wrong door.
 *
 * So every function here takes a *format id*. Decoding without one is only
 * allowed when the bit count maps to exactly one implemented format.
 */
import data from '../data/formats.json' with { type: 'json' };

/** All known layouts, implemented or not. */
export const formats = data.formats;

/** Curated confidence + version metadata. */
export const meta = data.meta;

const byId = new Map(formats.map((f) => [f.id, f]));

/** Look up one layout. Returns `null` when unknown — never guess. */
export function findFormat(id) {
  return byId.get(String(id)) || null;
}

/** Every *known* layout with this bit count, including ones this package refuses to encode. */
export function formatsForBits(bits) {
  return formats.filter((f) => f.bits === Number(bits));
}

/** Layouts this package can actually build and parse. */
export function implementedFormats() {
  return formats.filter((f) => f.implemented && f.parity && f.fields);
}

const ones = (s) => {
  let n = 0;
  for (const c of s) if (c === '1') n += 1;
  return n;
};

/** `'even'` when the string holds an even number of ones, `'odd'` otherwise. */
export function parityOf(digits) {
  return ones(String(digits)) % 2 === 0 ? 'even' : 'odd';
}

const clean = (text) => String(text ?? '').replace(/[\s._-]+/g, '');

/**
 * Build a frame from field values.
 *
 * @param {string} id format id, e.g. `'hid-h10301'`
 * @param {object} values field values keyed by field name (`fc`, `cn`, `oem`, …)
 * @returns {{ok:true, format:string, bits:number, text:string, hex:string, dec:string, bytes:number}
 *          |{ok:false, error:string, message:string, details?:object}}
 */
export function buildFrame(id, values = {}) {
  const f = findFormat(id);
  if (!f) return { ok: false, error: 'unknown-format', message: `unknown format id: ${id}` };
  if (!f.implemented) {
    return {
      ok: false,
      error: 'not-implemented',
      message: `${f.name} is published for reference only: ${f.note}`,
      details: { id: f.id, confidence: f.confidence },
    };
  }
  if (!f.parity || !f.fields) {
    return { ok: false, error: 'no-parity-model', message: `${f.name} has no published parity model` };
  }

  let payload = '';
  const resolved = {};
  for (const field of f.fields) {
    const raw = values[field.name];
    if (raw === undefined || raw === null || raw === '') {
      return {
        ok: false,
        error: 'missing-field',
        message: `${f.name} needs ${field.name} (${field.bits} bits)`,
        details: { field: field.name, bits: field.bits },
      };
    }
    const v = Number(raw);
    const max = 2 ** field.bits - 1;
    if (!Number.isInteger(v) || v < 0 || v > max) {
      return {
        ok: false,
        error: 'field-overflow',
        message: `${field.name} must be an integer in 0..${max} for ${f.name}, got ${raw}`,
        details: { field: field.name, max },
      };
    }
    resolved[field.name] = v;
    payload += v.toString(2).padStart(field.bits, '0');
  }

  const [evenFrom, evenTo] = f.parity.even;
  const evenLen = evenTo - evenFrom + 1;
  const evenBit = ones(payload.slice(0, evenLen)) % 2;          // makes the head even
  const oddBit = (ones(payload.slice(evenLen)) + 1) % 2;         // makes the tail odd
  const text = `${evenBit}${payload}${oddBit}`;
  const bytes = Math.ceil(f.bits / 8);
  return {
    ok: true,
    format: f.id,
    name: f.name,
    bits: f.bits,
    fields: resolved,
    text,
    hex: BigInt(`0b${text}`).toString(16).toUpperCase().padStart(bytes * 2, '0'),
    dec: BigInt(`0b${text}`).toString(10),
    bytes,
  };
}

/**
 * Decode a frame and check its parity bits.
 *
 * A parity failure is **not** a decode failure: the field values are still
 * returned, with `parity.evenOk` / `parity.oddOk` set. That is what you want
 * when a frame was captured off a reader with a flaky cable.
 *
 * `format` is required whenever the bit count maps to more than one layout.
 * Passing a bit count instead of an id is deliberately not supported.
 *
 * @param {string} text binary frame; spaces, `.` and `-` are ignored
 * @param {string} formatId
 */
export function parseFrame(text, formatId) {
  const cleaned = clean(text);
  if (!cleaned) return { ok: false, error: 'empty', message: 'empty frame' };
  if (!/^[01]+$/.test(cleaned)) {
    return { ok: false, error: 'not-binary', message: 'frame contains characters other than 0 and 1' };
  }

  let f;
  if (formatId === undefined || formatId === null) {
    const candidates = implementedFormats().filter((x) => x.bits === cleaned.length);
    if (candidates.length === 1) {
      [f] = candidates;
    } else if (candidates.length === 0) {
      const known = formatsForBits(cleaned.length);
      return {
        ok: false,
        error: 'unsupported-length',
        message: `${cleaned.length} bits is not an implemented format`,
        details: { bits: cleaned.length, knownLayouts: known.map((x) => ({ id: x.id, name: x.name, implemented: x.implemented })) },
      };
    } else {
      return {
        ok: false,
        error: 'ambiguous-format',
        message: `${cleaned.length} bits matches ${candidates.length} layouts; pass the format id`,
        details: { bits: cleaned.length, candidates: candidates.map((x) => x.id) },
      };
    }
  } else {
    f = findFormat(formatId);
    if (!f) return { ok: false, error: 'unknown-format', message: `unknown format id: ${formatId}` };
    if (!f.implemented) return { ok: false, error: 'not-implemented', message: `${f.name} is published for reference only: ${f.note}` };
  }

  if (cleaned.length !== f.bits) {
    return {
      ok: false,
      error: 'length-mismatch',
      message: `${f.name} is ${f.bits} bits, got ${cleaned.length}`,
    };
  }

  const fields = {};
  let offset = 2;                                // bit 1 is the leading parity bit
  for (const field of f.fields) {
    fields[field.name] = parseInt(cleaned.slice(offset - 1, offset - 1 + field.bits), 2);
    offset += field.bits;
  }

  const [evenFrom, evenTo] = f.parity.even;
  const [oddFrom, oddTo] = f.parity.odd;
  const evenWant = ones(cleaned.slice(evenFrom - 1, evenTo)) % 2;
  const oddWant = (ones(cleaned.slice(oddFrom - 1, oddTo)) + 1) % 2;
  const evenGot = Number(cleaned[0]);
  const oddGot = Number(cleaned[cleaned.length - 1]);
  return {
    ok: true,
    format: f.id,
    name: f.name,
    bits: f.bits,
    fields,
    text: cleaned,
    parity: {
      evenOk: evenGot === evenWant,
      oddOk: oddGot === oddWant,
      evenWant,
      evenGot,
      oddWant,
      oddGot,
      ok: evenGot === evenWant && oddGot === oddWant,
    },
  };
}
