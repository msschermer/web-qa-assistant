import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildWorkbook, sheetName, columnName } from '../packages/report/workbook.js';
import { buildAuditWorkbook, workbookFilename } from '../packages/report/audit-workbook.js';

/**
 * Read the zip back the way a spreadsheet application would: walk the central
 * directory, inflate each entry, verify its declared sizes. A workbook that
 * only "looks like" a zip is a file the recipient cannot open, and that failure
 * happens on their machine rather than ours.
 */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(offset), 0x02014b50, 'central directory entry signature');
    const csize = buf.readUInt32LE(offset + 20);
    const usize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, `local header for ${name}`);
    const localNameLen = buf.readUInt16LE(local + 26);
    const extraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + localNameLen + extraLen;
    const content = inflateRawSync(buf.subarray(start, start + csize)).toString('utf8');
    assert.equal(Buffer.byteLength(content), usize, `${name} inflates to its declared size`);
    files.set(name, content);
    offset += 46 + nameLen + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
  }
  return files;
}

const tabsOf = (files) => [...files.get('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);

const plan = {
  changeSummary: { total: 3, sitewide: 1, template: 0, page: 2, findings: 9 },
  informational: { patterns: 1, findings: 4, rules: ['analytics.ga4'] },
  priorities: [{
    order: 1, id: 'integrity', title: 'Resolve crawl and link integrity', summary: 'Fix broken targets.',
    unblocks: 'Everything after this is measured on pages that resolve.',
    severity: 'high', confidence: 'confirmed', changes: 2, findings: 7,
    actions: [{
      id: 'link-targets', title: 'Repair or redirect broken link targets', changeCount: 2,
      changes: [
        { id: 'C01', ruleId: 'navigation.link-404', location: 'The link href and its destination', current: '"Home" → https://example.com/gone', action: 'Fix or remove the link.', doneWhen: 'The link resolves.', scope: 'sitewide', scopeLabel: 'Sitewide', effort: 'One change, applied once', pages: 6, instances: 6, severity: 'high', confidence: 'confirmed', urls: ['https://example.com/a', 'https://example.com/b'] },
        { id: 'C02', ruleId: 'seo.description-missing', location: 'The <meta name="description"> tag', current: '', absence: 'not present', action: 'Write one.', doneWhen: 'View source shows a description.', scope: 'page', scopeLabel: 'Single page', effort: 'One page', pages: 1, instances: 1, severity: 'medium', confidence: 'confirmed', urls: ['https://example.com/c'] }
      ]
    }]
  }]
};
const audit = { id: 'audit_test', site_origin: 'https://example.com', completed_at: '2026-01-02T03:04:05.000Z' };

test('the workbook is a zip a spreadsheet application can actually open', () => {
  const files = readZip(buildAuditWorkbook({ audit, urlCounts: { fetched: 6 }, plan, include: { scan: true, plan: true } }));
  // The four parts without which no reader will open the file.
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) {
    assert.ok(files.has(required), `${required} is missing`);
  }
  // Every declared sheet has a part and a relationship, or the workbook opens empty.
  const tabs = tabsOf(files);
  for (let i = 0; i < tabs.length; i++) assert.ok(files.has(`xl/worksheets/sheet${i + 1}.xml`), `sheet${i + 1} part`);
  const rels = files.get('xl/_rels/workbook.xml.rels');
  for (let i = 0; i < tabs.length; i++) assert.match(rels, new RegExp(`Id="rId${i + 1}"`));
  for (const [name, content] of files) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) assert.match(content, /^<\?xml version="1\.0"/, `${name} declares itself`);
  }
});

test('the operator gets exactly the deliverables they asked for', () => {
  assert.deepEqual(
    tabsOf(readZip(buildAuditWorkbook({ audit, plan, include: { scan: true, plan: true } }))),
    ['About this report', 'Action plan', 'Plan phases', 'Findings', 'Pages', 'Links']
  );
  assert.deepEqual(
    tabsOf(readZip(buildAuditWorkbook({ audit, plan, include: { scan: false, plan: true } }))),
    ['About this report', 'Action plan', 'Plan phases']
  );
  assert.deepEqual(
    tabsOf(readZip(buildAuditWorkbook({ audit, plan, include: { scan: true, plan: false } }))),
    ['About this report', 'Findings', 'Pages', 'Links']
  );
  // Asking for nothing is a caller error, not an empty file the operator has to
  // open to discover is empty.
  assert.throws(() => buildAuditWorkbook({ audit, plan, include: { scan: false, plan: false } }), /at least one/);
  // And a plan tab is never emitted without a plan behind it.
  assert.deepEqual(
    tabsOf(readZip(buildAuditWorkbook({ audit, plan: null, include: { scan: true, plan: true } }))),
    ['About this report', 'Findings', 'Pages', 'Links']
  );
});

test('the file states its own coverage limit, because it outlives the screen', () => {
  const files = readZip(buildAuditWorkbook({ audit, urlCounts: { fetched: 10, queued: 183 }, plan, findingCount: 56, include: { scan: false, plan: true } }));
  const cover = files.get('xl/worksheets/sheet1.xml');
  assert.match(cover, /Coverage limit/);
  assert.match(cover, /183 discovered pages were never fetched/);
  assert.match(cover, /describes the 10 pages that were, not the whole site/);
  // The cover reports what the audit found, not what this file happens to
  // carry: a plan-only export still came from an audit with findings, and
  // printing zero there would read as "nothing was found".
  assert.match(cover, /Findings recorded.*?<v>56<\/v>/s);
  // Which then reconciles: 46 planned + 10 informational = 56 recorded.
  assert.match(cover, /Findings they cover.*?<v>9<\/v>/s);
  assert.match(cover, /4 informational observations across 1 pattern\./);
  // A cross-reference to a tab this file does not contain is worse than none.
  assert.ok(!/They are in the Findings tab/.test(cover));
  const withScan = readZip(buildAuditWorkbook({ audit, urlCounts: { fetched: 10, queued: 183 }, plan, include: { scan: true, plan: true } })).get('xl/worksheets/sheet1.xml');
  assert.match(withScan, /They are in the Findings tab/);
});

test('the action plan is a tracker: one row per change, with the operator’s own columns left empty', () => {
  const files = readZip(buildAuditWorkbook({ audit, plan, include: { scan: false, plan: true } }));
  const sheet = files.get('xl/worksheets/sheet2.xml');
  const rows = [...sheet.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(rows.length, 3, 'a header and the two changes');
  assert.match(sheet, /<t xml:space="preserve">C01<\/t>/);
  assert.match(sheet, /<t xml:space="preserve">C02<\/t>/);
  // Owner, Status and Notes are the columns the recipient writes in. Lumen
  // emits them empty and never fills them.
  for (const header of ['Owner', 'Status', 'Notes']) assert.match(sheet, new RegExp(`>${header}<`));
  const lastThree = sheet.match(/<row r="2">.*?<\/row>/s)[0].match(/<c r="[A-Z]+2"[^>]*\/>/g) || [];
  assert.ok(lastThree.length >= 3, 'the operator’s columns are emitted as empty cells');
  // A missing value says it is missing rather than being left blank, and the
  // page a change lands on travels with it.
  assert.match(sheet, /not present/);
  assert.match(sheet, /https:\/\/example\.com\/a/);
});

test('page content cannot break the file', () => {
  // A scanner quotes whatever the page contained: markup, ampersands, quotes,
  // and occasionally a control character. Any one of those unescaped makes the
  // workbook unopenable, and the operator finds out in front of a client.
  const files = readZip(buildWorkbook([{
    name: 'Findings',
    columns: [{ key: 'text', label: 'Detail' }, { key: 'n', label: 'Count' }],
    rows: [{ text: '<img src="x" & y> \u0007 "quoted" \u001F', n: 42 }, { text: 'plain', n: 0 }]
  }]));
  const sheet = files.get('xl/worksheets/sheet1.xml');
  assert.ok(!/<img/.test(sheet), 'markup is escaped');
  assert.match(sheet, /&lt;img src=&quot;x&quot; &amp; y&gt;/);
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(sheet), 'control characters are stripped');
  // Numbers stay numbers so the recipient can sort and sum them.
  assert.match(sheet, /<v>42<\/v>/);
  assert.match(sheet, /<v>0<\/v>/);
});

test('sheet names and columns obey the format’s own limits', () => {
  const taken = new Set();
  assert.equal(sheetName('Findings', taken), 'Findings');
  assert.equal(sheetName('Findings', taken), 'Findings 2', 'a duplicate name makes the workbook unopenable');
  assert.equal(sheetName('a/b\\c?d*e[f]g:h', new Set()), 'a b c d e f g h');
  assert.ok(sheetName('x'.repeat(60), new Set()).length <= 31);
  assert.equal(sheetName('', new Set()), 'Sheet');
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(701), 'ZZ');
});

test('the same audit exports the same bytes twice', () => {
  // A deliverable that changes on every download cannot be checksummed or
  // diffed by whoever receives it, so the timestamp inside the container is
  // fixed rather than taken from the clock.
  const args = { audit, urlCounts: { fetched: 6 }, plan, include: { scan: false, plan: true }, generatedAt: '2026-01-02T03:04:05.000Z' };
  assert.ok(buildAuditWorkbook(args).equals(buildAuditWorkbook(args)));
});

test('the filename says what the file is without being opened', () => {
  assert.equal(workbookFilename(audit, { scan: true, plan: true }), 'example.com-audit-2026-01-02.xlsx');
  assert.equal(workbookFilename(audit, { scan: false, plan: true }), 'example.com-action-plan-2026-01-02.xlsx');
  assert.equal(workbookFilename(audit, { scan: true, plan: false }), 'example.com-scan-results-2026-01-02.xlsx');
});

test('a drafted replacement travels in its own column, labelled as a proposal', () => {
  // The Action Plan's most valuable column used to hold a generic instruction
  // while the consultant wrote the actual sixty characters by hand. A drafted
  // value sits beside that instruction rather than replacing it: merging them
  // would let a model's sentence be read as the audit's finding.
  const drafted = JSON.parse(JSON.stringify(plan));
  drafted.priorities[0].actions[0].changes[0].draft = 'Repair the shared navigation link on every page';
  drafted.priorities[0].actions[0].changes[0].draftBy = 'byo';
  const files = readZip(buildAuditWorkbook({ audit, plan: drafted, include: { scan: false, plan: true } }));
  const sheet = files.get('xl/worksheets/sheet2.xml');
  assert.match(sheet, />Drafted value</);
  assert.match(sheet, />Drafted by</);
  assert.match(sheet, /Repair the shared navigation link on every page/);
  assert.match(sheet, /Your model, unchecked/, 'the reader is told a model wrote it and nobody checked it');
  // The deterministic instruction is still there beside it.
  assert.match(sheet, /Fix or remove the link\./);

  // The cover says so too, because a spreadsheet is forwarded and a column
  // header will not carry the caveat to whoever opens it next.
  const cover = files.get('xl/worksheets/sheet1.xml');
  assert.match(cover, /Drafted values/);
  assert.match(cover, /a proposal to review, not a finding/);
  assert.match(cover, /nothing was applied to the site/);

  // With nothing drafted the file makes no such claim at all.
  const plainCover = readZip(buildAuditWorkbook({ audit, plan, include: { scan: false, plan: true } })).get('xl/worksheets/sheet1.xml');
  assert.ok(!/Drafted values/.test(plainCover));
});
