# wiegand-formats

Access-control credential bit layouts, **keyed by format ID rather than bit count**.

A bit count does not identify a format. That sounds pedantic until a card that
should open a door doesn't, and the numbers on screen look perfectly sensible:

16 layouts in total, 3 of them implemented here. The other 13 are published so
that `formatsForBits()` can explain *why* a frame is ambiguous instead of
silently decoding it wrong.

| Bit count | Known layouts | Field split differs? |
|---|---|---|
| 26 | HID H10301 | no — this one really is standard |
| 34 | HID H10306 / Honeywell N10002, AWID RS2 | **yes**: 16+16 vs 8+24 |
| 36 | Keyscan C15001, Simplex S12906, AWID 36 | **yes**, and Keyscan never published theirs |
| 37 | HID H10302, HID H10304, HID generic, PointGuard MDI | **yes**: no facility code vs 16-bit facility code |
| 32 | ATS, generic WIE32, Kantech K32, Nedap, Maxxess | **yes**, at least five ways |

Feed an AWID RS2 34-bit card to a tool that assumes H10306 and you get a facility
code and card number that are both wrong, both plausible, and both accepted by the
controller. Same for a 37-bit H10302 frame read as H10304.

So this package refuses to switch on `bits`. Every call takes a format id.

```js
import { buildFrame, parseFrame, formatsForBits } from 'wiegand-formats';

buildFrame('hid-h10301', { fc: 94, cn: 62286 });
// { ok: true, bits: 26, text: '10101111011110011010011101', hex: '02BDE69D', ... }

parseFrame('000000000010010101010100100010101010', 'keyscan-c15001');
// { ok: true, fields: { oem: 1, fc: 42, cn: 42069 }, parity: { ok: true, ... } }

formatsForBits(37);
// 4 layouts, none of them implemented here — because all four need you to say which
```

## What is implemented

| id | name | bits | notes |
|---|---|---|---|
| `hid-h10301` | HID H10301 | 26 | the actual standard; 8 facility + 16 card |
| `hid-h10306` | HID H10306 / Honeywell N10002 | 34 | 16 + 16 |
| `keyscan-c15001` | Keyscan C15001 | 36 | 10 OEM + 8 facility + 16 card; **bit map is third-party** |

Everything else in `data/formats.json` carries `"implemented": false` and a note
explaining what is missing. Two reasons to publish layouts it won't encode:

1. `formatsForBits()` can then tell you *why* a frame is ambiguous instead of
   just failing;
2. the table itself is the useful part. Most of these splits are only documented
   in vendor PDFs and forum threads.

## Parity is checked, never assumed

`parseFrame` returns field values **and** `parity: { evenOk, oddOk, ok }`. A failed
check is not a thrown error — a frame captured off a reader with a bad cable is
exactly when you most want the field values plus a flag.

Parity coverage is stored as 1-based bit ranges and is computed on ranges, not on
fields: in a 26-bit frame the even region cuts the card number in half, and in a
36-bit frame it cuts the facility code into 7+1.

## Known disagreement: 37-bit parity

H10302 and H10304 carry 35 data bits, which cannot be split into two equal halves.
The sources do not agree on the boundary:

- Nedap Invexs manual: first 18 bits, then 18 bits starting at bit 18;
- `promptzero/pacs`: first 18 data bits, last 18 data bits, overlapping at bit 18;
- Suprema BioStar: 19 bits from bit 0, 19 bits from bit 18.

That is why no 37-bit layout is implemented here. Encoder/decoder pairs that both
use the same wrong boundary pass their own round-trip tests and still reject real
cards. This needs a real frame, not more reading.

## Data format

`data/formats.json` — one array, one entry per layout:

```json
{
  "id": "keyscan-c15001",
  "name": "Keyscan C15001",
  "aliases": ["36-bit", "Keyscan 36-bit"],
  "bits": 36,
  "fields": [
    { "name": "oem", "role": "format", "bits": 10 },
    { "name": "fc", "role": "facility", "bits": 8 },
    { "name": "cn", "role": "card", "bits": 16 }
  ],
  "parity": { "even": [2, 18], "odd": [19, 35] },
  "ranges": { "fc": [0, 255], "cn": [0, 65535], "oem": [0, 1023] },
  "confidence": "medium",
  "implemented": true,
  "note": "…",
  "sources": ["…"]
}
```

`confidence` is one of `high` / `medium` / `low` and is defined in `meta.confidence`.
`null` for `fields` or `parity` means *not published*, not *no parity* — the
generic 32-bit layouts really do have no parity bits, and say so.

## Corrections are the point

If a row is wrong, the fix is worth more than a star. Open an issue with either a
vendor document or a real frame plus its expected decode. Vendor PDFs move, so
sources are named rather than linked; a citation that survives link rot beats a
dead URL.

## Test

```
npm test        # node --test; 15 cases, external frames, no fixtures invented here
```

The three reference frames in the suite come from published bit maps
(Maxxess AN-012 for 26/34, accessgrid for Keyscan C15001) and are cross-checked
against a live decoder.

## License

MIT.

## See also

A browser version of the three implemented formats — with copy buttons and a
frame-width selector — lives at <https://toolstead.net/wiegand-26-34-converter/>.
The data here is the same data that page is built from.
