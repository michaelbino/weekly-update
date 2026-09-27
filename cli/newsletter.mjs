#!/usr/bin/env node
// Local companion to the Apps Script: render a newsletter Doc to HTML, send a
// preview through Gmail, or seed a freshly imported template Doc. Uses `gws`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { gws, docIdFrom } from './gws.mjs';
import { buildMime } from './mime.mjs';
import { buildSeedRequests, buildListRequests, listKindsFromHtml } from './seed.mjs';

const require = createRequire(import.meta.url);
const { NEWSLETTER_CONFIG } = require('../apps-script/Config.js');
const NL = require('../apps-script/Newsletter.js');

const USAGE = `Usage:
  newsletter render (--doc <id|url> | --json <file>) [--out <dir>] [--config <file>] [--view-url <url>]
  newsletter send   --doc <id|url> [--to <email>] [--config <file>] [--view-url <url>]
  newsletter seed   --doc <id|url> [--attachment-url <url>]
`;

export function loadConfig(file) {
  const extra = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { ...NEWSLETTER_CONFIG, ...extra };
}

export function fetchDoc(docId) {
  return gws(['docs', 'documents', 'get'], { params: { documentId: docId } });
}

function docName(docId) {
  try {
    return gws(['drive', 'files', 'get'], { params: { fileId: docId, fields: 'name' } }).name;
  } catch {
    return '';
  }
}

export function build(docJson, { config, subject, viewInBrowserUrl, resolveImage }) {
  const model = NL.nlParseDocument(docJson);
  const opts = { config, subject: config.subject || subject || model.title, viewInBrowserUrl, resolveImage };
  return {
    model,
    subject: opts.subject,
    html: NL.nlRenderHtml(model, opts),
    text: NL.nlRenderText(model, opts),
  };
}

async function cmdRender(o) {
  const docId = o.doc && docIdFrom(o.doc);
  const json = o.json ? JSON.parse(fs.readFileSync(o.json, 'utf8')) : fetchDoc(docId);
  const config = loadConfig(o.config);
  const out = build(json, {
    config,
    subject: docId ? docName(docId) : json.title,
    viewInBrowserUrl: o['view-url'] || (docId ? `https://docs.google.com/document/d/${docId}/pub` : ''),
  });
  const dir = o.out || 'out';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'newsletter.html'), out.html);
  fs.writeFileSync(path.join(dir, 'newsletter.txt'), out.text);
  fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify(out.model, null, 2));
  if (o.doc && o['save-json']) fs.writeFileSync(o['save-json'], JSON.stringify(json, null, 2));
  console.log(`Subject: ${out.subject}\nWrote ${path.join(dir, 'newsletter.html')}`);
}

async function cmdSend(o) {
  const docId = docIdFrom(o.doc);
  const json = fetchDoc(docId);
  const config = loadConfig(o.config);
  // gmail.send cannot read the profile; Drive's about.get knows who is signed in.
  const to = o.to || gws(['drive', 'about', 'get'], { params: { fields: 'user(emailAddress)' } }).user.emailAddress;

  // Embed images: the Docs API contentUri links expire after ~30 minutes.
  const model = NL.nlParseDocument(json);
  const inline = [];
  const srcById = {};
  for (const [i, img] of NL.nlCollectImages(model).entries()) {
    if (srcById[img.objectId] || !img.contentUri) continue;
    const res = await fetch(img.contentUri);
    if (!res.ok) throw new Error(`image ${i + 1}: HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/png';
    const cid = `img${i}@newsletter`;
    inline.push({ cid, contentType, data: Buffer.from(await res.arrayBuffer()), filename: `image${i}.${contentType.split('/')[1]}` });
    srcById[img.objectId] = `cid:${cid}`;
  }

  const out = build(json, {
    config,
    subject: docName(docId),
    viewInBrowserUrl: o['view-url'] || `https://docs.google.com/document/d/${docId}/pub`,
    resolveImage: (img) => srcById[img.objectId] || img.contentUri,
  });
  const mime = buildMime({
    to,
    replyTo: config.replyTo || undefined,
    subject: out.subject,
    text: out.text,
    html: out.html,
    inline,
  }); // Gmail fills in From with the authenticated account

  // gws only uploads files under the working directory.
  fs.mkdirSync('out', { recursive: true });
  const tmp = path.join('out', 'message.eml');
  fs.writeFileSync(tmp, mime);
  const sent = gws(['gmail', 'users', 'messages', 'send'], {
    params: { userId: 'me' },
    upload: tmp,
    uploadType: 'message/rfc822',
  });
  console.log(`Sent "${out.subject}" to ${to} (message ${sent.id})`);
}

async function cmdSeed(o) {
  const docId = docIdFrom(o.doc);
  const json = fetchDoc(docId);
  const seedHtml = fs.readFileSync(new URL('../template/weekly-update.html', import.meta.url), 'utf8');
  const requests = o['lists-only']
    ? buildListRequests(json.body.content.filter((el) => el.paragraph), listKindsFromHtml(seedHtml))
    : buildSeedRequests(json, { attachmentUrl: o['attachment-url'], listKinds: listKindsFromHtml(seedHtml) });
  if (!requests.length) { console.log('Nothing to seed.'); return; }
  gws(['docs', 'documents', 'batchUpdate'], { params: { documentId: docId }, json: { requests } });
  console.log(`Applied ${requests.length} edits to ${docId}`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      doc: { type: 'string' }, json: { type: 'string' }, out: { type: 'string' },
      config: { type: 'string' }, to: { type: 'string' }, 'view-url': { type: 'string' },
      'attachment-url': { type: 'string' }, 'save-json': { type: 'string' }, 'lists-only': { type: 'boolean' },
    },
  });
  const commands = { render: cmdRender, send: cmdSend, seed: cmdSeed };
  if (!commands[cmd] || (!values.doc && !values.json)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  await commands[cmd](values);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('newsletter.mjs')) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
