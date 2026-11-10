import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formats, findFormat, formatsForBits, implementedFormats, parityOf, buildFrame, parseFrame,
} from '../src/index.mjs';

/* 外部示例帧（不是自己编的）：26/34 来自 Maxxess AN-012 的逐位图交叉核对结果，
   36 位来自 accessgrid 的 Keyscan C15001 示例。三个都在线上工具里跑过。 */
const FRAME26_94_62286 = '10101111011110011010011101';
const FRAME34_94_62286 = '1000000000101111011110011010011101';
const FRAME36_KEYS = '000000000010010101010100100010101010';

test('26 位 H10301：字段 → 帧，与外部示例帧逐位相同', () => {
  const r = buildFrame('hid-h10301', { fc: 94, cn: 62286 });
  assert.equal(r.ok, true);
  assert.equal(r.text, FRAME26_94_62286);
  assert.equal(r.bits, 26);
  assert.equal(r.hex, '02BDE69D');
});

test('26 位 H10301：帧 → 字段，并回报校验成立', () => {
  const r = parseFrame(FRAME26_94_62286, 'hid-h10301');
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, { fc: 94, cn: 62286 });
  assert.equal(r.parity.ok, true);
});

test('34 位 H10306：字段 → 帧，与外部示例帧逐位相同', () => {
  const r = buildFrame('hid-h10306', { fc: 94, cn: 62286 });
  assert.equal(r.ok, true);
  assert.equal(r.text, FRAME34_94_62286);
});

test('34 位 H10306：帧 → 字段', () => {
  const r = parseFrame(FRAME34_94_62286, 'hid-h10306');
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, { fc: 94, cn: 62286 });
});

test('36 位 Keyscan C15001：字段 → 帧，OEM 必须显式给', () => {
  assert.equal(buildFrame('keyscan-c15001', { fc: 42, cn: 42069 }).error, 'missing-field');
  const r = buildFrame('keyscan-c15001', { oem: 1, fc: 42, cn: 42069 });
  assert.equal(r.ok, true);
  assert.equal(r.text, FRAME36_KEYS);
});

test('36 位 Keyscan C15001：帧 → 字段，OEM 一并回报', () => {
  const r = parseFrame(FRAME36_KEYS, 'keyscan-c15001');
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, { oem: 1, fc: 42, cn: 42069 });
  assert.equal(r.parity.ok, true);
});

test('故意错一位：校验必须报警，而不是静默通过', () => {
  const broken = FRAME26_94_62286.slice(0, 5)
    + (FRAME26_94_62286[5] === '1' ? '0' : '1')
    + FRAME26_94_62286.slice(6);
  const r = parseFrame(broken, 'hid-h10301');
  assert.equal(r.ok, true, '校验失败不等于解析失败');
  assert.equal(r.parity.ok, false);
});

test('字段溢出必须指名报错，不许截断', () => {
  const r = buildFrame('hid-h10301', { fc: 300, cn: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'field-overflow');
  assert.equal(r.details.field, 'fc');
  assert.equal(r.details.max, 255);
});

test('37 位不给格式 id = 报歧义，并列出候选（这就是本包存在的理由）', () => {
  const n = formatsForBits(37);
  assert.ok(n.length >= 4, '37 位至少四种已知布局');
  assert.equal(n.filter((f) => f.implemented).length, 0);
  const r = parseFrame('0'.repeat(37));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsupported-length');
  assert.ok(r.details.knownLayouts.length >= 4);
});

test('位宽相同但布局不同的两个 34 位格式，结果必须不同', () => {
  const a = findFormat('hid-h10306');
  const b = findFormat('awid-rs2-34');
  assert.equal(a.bits, b.bits);
  assert.notDeepEqual(a.fields, b.fields);
});

test('未实现的格式：buildFrame 拒绝，并说明原因', () => {
  const r = buildFrame('awid-rs2-34', { site: 1, cn: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not-implemented');
  assert.match(r.message, /reference only/);
});

test('数据完整性：每条都有出处与置信度，实现的必须有校验模型', () => {
  for (const f of formats) {
    assert.ok(f.id && f.name, 'id/name 必填');
    assert.ok(['high', 'medium', 'low'].includes(f.confidence), `${f.id} 置信度不合法`);
    assert.ok(Array.isArray(f.sources) && f.sources.length > 0, `${f.id} 缺出处`);
    if (f.implemented) {
      assert.ok(f.parity && f.parity.even && f.parity.odd, `${f.id} 已实现却没有校验区间`);
      assert.ok(f.fields, `${f.id} 已实现却没有字段定义`);
      const total = 2 + f.fields.reduce((s, x) => s + x.bits, 0);
      assert.equal(total, f.bits, `${f.id} 字段位数 + 2 校验位 ≠ 帧长`);
    }
  }
});

test('parityOf 与校验位语义一致', () => {
  assert.equal(parityOf('1100'), 'even');
  assert.equal(parityOf('1101'), 'odd');
});

test('分隔符不影响解析（抓帧常带空格或点）', () => {
  const spaced = FRAME26_94_62286.replace(/(.{4})/g, '$1 ').trim();
  const r = parseFrame(spaced, 'hid-h10301');
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, { fc: 94, cn: 62286 });
});

test('只有一种已实现布局的位宽，可以省略格式 id', () => {
  const r = parseFrame(FRAME26_94_62286);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'hid-h10301');
  assert.equal(implementedFormats().filter((f) => f.bits === 26).length, 1);
});
