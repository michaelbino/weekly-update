import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMime, encodeHeader } from '../cli/mime.mjs';
import { buildSeedRequests, listKindsFromHtml } from '../cli/seed.mjs';
import { docIdFrom, gws } from '../cli/gws.mjs';

const seedImport = JSON.parse(fs.readFileSync(new URL('./fixtures/seed-import.json', import.meta.url)));

test('MIME: alternative text/html with related CID images', () => {
  const raw = buildMime({
    to: 'a@example.com', subject: 'Weekly Update – 9/21', text: 'hi', html: '<p>hi</p>',
    inline: [{ cid: 'img0@n', contentType: 'image/png', data: Buffer.from([1, 2, 3]) }],
  });
  assert.match(raw, /^To: a@example.com\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="(=_alt_[0-9a-f]+)"/);
  assert.match(raw, /Content-Type: multipart\/related/);
  assert.match(raw, /Content-ID: <img0@n>/);
  assert.ok(!/[^\r]\n/.test(raw), 'CRLF line endings only');
  const html = /text\/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(raw)[1];
  assert.equal(Buffer.from(html.replace(/\r\n/g, ''), 'base64').toString(), '<p>hi</p>');
  assert.equal(encodeHeader('plain'), 'plain');
});

test('MIME: no related part without images', () => {
  const raw = buildMime({ to: 'a@b.c', subject: 's', text: 't', html: 'h' });
  assert.ok(!raw.includes('multipart/related'));
});

test('seed: title/subtitle styles, bottom-up image and file replacements', () => {
  const reqs = buildSeedRequests(seedImport, { attachmentUrl: 'https://drive.google.com/file/d/ATTACH/view' });
  assert.equal(reqs[0].updateParagraphStyle.paragraphStyle.namedStyleType, 'TITLE');
  assert.equal(reqs[1].updateParagraphStyle.paragraphStyle.namedStyleType, 'SUBTITLE');
  const images = reqs.filter((r) => r.insertInlineImage);
  assert.equal(images.length, 6);
  assert.ok(images.every((r) => r.insertInlineImage.uri.startsWith('https://cdn.smore.com/')));
  const deletes = reqs.filter((r) => r.deleteContentRange).map((r) => r.deleteContentRange.range.startIndex);
  assert.deepEqual(deletes, [...deletes].sort((a, b) => b - a), 'edits run bottom-up');
  const links = reqs.filter((r) => r.updateTextStyle).map((r) => r.updateTextStyle.textStyle.link.url);
  assert.deepEqual(links, ['https://drive.google.com/file/d/ATTACH/view', 'https://drive.google.com/file/d/ATTACH/view']);
});

test('seed: marker sharing a paragraph with a horizontal rule keeps the rule', () => {
  const para = seedImport.body.content.find((el) => el.paragraph && el.paragraph.elements.some((e) => e.horizontalRule));
  const reqs = buildSeedRequests(seedImport, {});
  const del = reqs.find((r) => r.deleteContentRange && r.deleteContentRange.range.endIndex === para.endIndex - 1);
  assert.ok(del.deleteContentRange.range.startIndex > para.startIndex);
});

test('seed: lists get bullet or number presets matching the seed HTML', () => {
  const html = fs.readFileSync(new URL('../template/weekly-update.html', import.meta.url), 'utf8');
  const kinds = listKindsFromHtml(html);
  assert.deepEqual(kinds.slice(0, 5), ['ul', 'ul', 'ul', 'ol', 'ul']);
  const presets = buildSeedRequests(seedImport, { listKinds: kinds })
    .filter((r) => r.createParagraphBullets).map((r) => r.createParagraphBullets.bulletPreset);
  assert.equal(presets.length, kinds.length);
  assert.equal(presets[3], 'NUMBERED_DECIMAL_ALPHA_ROMAN');
  assert.equal(presets[0], 'BULLET_DISC_CIRCLE_SQUARE');
});

test('docIdFrom accepts URLs and IDs', () => {
  assert.equal(docIdFrom('https://docs.google.com/document/d/1Mz3XCBsUTevAdrsq/edit?usp=x'), '1Mz3XCBsUTevAdrsq');
  assert.equal(docIdFrom('https://drive.google.com/open?id=1Mz3XCBsUTevAdrsq'), '1Mz3XCBsUTevAdrsq');
  assert.equal(docIdFrom('abc'), 'abc');
});

test('gws wrapper passes flags and surfaces API errors (mock binary)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gws-mock-'));
  const bin = path.join(dir, 'gws');
  const log = path.join(dir, 'argv');
  fs.writeFileSync(bin, `#!/bin/sh
printf '%s\\n' "$@" > '${log}'
case "$*" in
  *fail*) echo '{"error":{"code":403,"message":"nope"}}'; exit 1;;
  *) echo '{"ok":true}';;
esac
`, { mode: 0o755 });
  const out = gws(['docs', 'documents', 'get'], { params: { documentId: 'D' }, bin });
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['docs', 'documents', 'get', '--params', '{"documentId":"D"}']);
  assert.throws(() => gws(['fail'], { bin }), /nope/);
});
