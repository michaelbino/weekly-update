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
const { NEWSLETTER_THEME } = require('../apps-script/Theme.js');

const USAGE = `Usage:
  newsletter render  (--doc <id|url> | --json <file>) [--out <dir>] [--config <file>] [--view-url <url>]
  newsletter send    --doc <id|url> [--to <email>] [--config <file>] [--view-url <url>]
  newsletter seed    --doc <id|url> [--attachment-url <url>]
  newsletter preview [--doc <id|url> | --json <file>] [--theme <file>] [--lang <code>] [--watch]
  newsletter check-theme [--theme <file>]          validate apps-script/Theme.js (or another theme file)
`;
const FIXTURE = new URL('../test/fixtures/template-doc.json', import.meta.url);
const ENGINE_DIR = new URL('../apps-script/', import.meta.url).pathname;

/** Loads Config/Layout/Theme/Newsletter fresh, so edits show up without restarting. */
export function loadEngine(themeFile) {
  const themePath = themeFile ? path.resolve(themeFile) : null;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ENGINE_DIR) || key === themePath) delete require.cache[key];
  }
  return {
    NL: require('../apps-script/Newsletter.js'),
    Layout: require('../apps-script/Layout.js'),
    config: require('../apps-script/Config.js').NEWSLETTER_CONFIG,
    theme: require(themePath || '../apps-script/Theme.js').NEWSLETTER_THEME,
  };
}

/** Grey placeholder with the image's proportions (fixture image URLs expire). */
function placeholder(img) {
  const w = 700;
  const h = img.widthPt && img.heightPt ? Math.round((w * img.heightPt) / img.widthPt) : 300;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#d9d4cc"/>` +
    `<text x="50%" y="50%" font-family="Arial" font-size="22" fill="#6b645b" text-anchor="middle">${(img.alt || 'image').replace(/[<&"]/g, '')}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

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
  const opts = { config, subject: config.subject || subject || model.title, viewInBrowserUrl, resolveImage, theme: NEWSLETTER_THEME };
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

async function cmdPreview(o) {
  const json = o.doc ? fetchDoc(docIdFrom(o.doc)) : JSON.parse(fs.readFileSync(o.json || FIXTURE, 'utf8'));
  const out = path.join(o.out || 'out', 'preview.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const render = () => {
    try {
      const { NL, Layout, config, theme } = loadEngine(o.theme);
      const problems = Layout.nlValidateTheme(theme);
      problems.forEach((p) => console.warn(`Theme: ${p}`));
      const model = NL.nlParseDocument(json);
      const source = config.sourceLanguage || 'en';
      const lang = o.lang || source;
      const languages = [source, ...NL.nlParseLanguages(config.translateLanguages, source)]
        .map((code) => ({ code, url: `?lang=${code}` }));
      let html = NL.nlRenderHtml(model, {
        config, theme, lang, languages,
        viewInBrowserUrl: 'https://example.org/view-in-browser',
        originalUrl: lang !== source ? '#' : '',
        translateHtml: lang !== source ? (h) => h : undefined, // layout preview only; no real translation
        resolveImage: o.doc ? undefined : placeholder,
      });
      if (o.watch) html = html.replace('<head>', '<head><meta http-equiv="refresh" content="2">');
      fs.writeFileSync(out, html);
      console.log(`${new Date().toLocaleTimeString()}  wrote ${out} (${Math.round(html.length / 1024)} KB)${problems.length ? '  - fix the theme warnings above' : ''}`);
    } catch (e) {
      console.error(`${new Date().toLocaleTimeString()}  render failed: ${e.message}`);
    }
  };
  render();
  if (!o.watch) return;
  console.log(`Watching ${ENGINE_DIR}${o.theme ? ' and ' + o.theme : ''} - open ${path.resolve(out)} (it refreshes itself). Ctrl+C to stop.`);
  let timer;
  const rerender = () => { clearTimeout(timer); timer = setTimeout(render, 150); };
  fs.watch(ENGINE_DIR, rerender);
  if (o.theme) fs.watch(path.resolve(o.theme), rerender);
  await new Promise(() => {});
}

export function checkTheme(themeFile) {
  const { NL, Layout, config, theme } = loadEngine(themeFile);
  const problems = Layout.nlValidateTheme(theme);
  if (!problems.length) {
    // Render the sample issue in both directions to catch template runtime errors.
    const model = NL.nlParseDocument(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
    for (const lang of ['en', 'ar']) {
      NL.nlRenderHtml(model, { config, theme, lang, languages: [{ code: 'en', url: '#' }], viewInBrowserUrl: '#',
        originalUrl: lang === 'en' ? '' : '#', translateHtml: lang === 'en' ? undefined : (h) => h });
    }
  }
  return problems;
}

async function cmdCheckTheme(o) {
  const problems = checkTheme(o.theme);
  if (problems.length) {
    problems.forEach((p) => console.error(`Theme: ${p}`));
    process.exit(1);
  }
  console.log('Theme OK');
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
      lang: { type: 'string' }, watch: { type: 'boolean' }, theme: { type: 'string' },
    },
  });
  const commands = { render: cmdRender, send: cmdSend, seed: cmdSeed, preview: cmdPreview, 'check-theme': cmdCheckTheme };
  const needsDoc = ['render', 'send', 'seed'].includes(cmd);
  if (!commands[cmd] || (needsDoc && !values.doc && !values.json)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  await commands[cmd](values);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('newsletter.mjs')) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
