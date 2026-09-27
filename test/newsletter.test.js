const test = require('node:test');
const assert = require('node:assert/strict');
const NL = require('../apps-script/Newsletter.js');
const { NEWSLETTER_CONFIG } = require('../apps-script/Config.js');
const { run, para, image, doc, inlineImage, bulletList, numberList } = require('./helpers/docbuilder.js');

const cfg = { ...NEWSLETTER_CONFIG };
const render = (model, extra) => NL.nlRenderHtml(model, { config: cfg, viewInBrowserUrl: 'https://example.com/pub', ...extra });

test('title and subtitle become the banner, not body blocks', () => {
  const m = NL.nlParseDocument(doc([
    para('The Weekly Update', { style: 'TITLE' }),
    para('September 21, 2026', { style: 'SUBTITLE' }),
    para('Hello'),
  ]));
  assert.equal(m.title, 'The Weekly Update');
  assert.equal(m.subtitle, 'September 21, 2026');
  assert.deepEqual(m.blocks.map((b) => b.type), ['paragraph']);
  const html = render(m);
  assert.match(html, /class="nl-banner-title"[^>]*>The Weekly Update<\/h1>/);
  assert.match(html, /September 21, 2026/);
});

test('image above the title replaces the text banner', () => {
  const m = NL.nlParseDocument(doc([
    para([image('i1')]),
    para('The Weekly Update', { style: 'TITLE' }),
  ], { inlineObjects: { i1: inlineImage('https://img/banner.png', 468, 'Banner') } }));
  assert.equal(m.banner.contentUri, 'https://img/banner.png');
  const html = render(m);
  assert.ok(!html.includes('class="nl-banner-title"'));
  assert.match(html, /<img src="https:\/\/img\/banner.png"[^>]*alt="Banner"/);
});

test('text styles, links and colours map to inline HTML', () => {
  const m = NL.nlParseDocument(doc([para([
    run('bold', { bold: true }), run(' '), run('ital', { italic: true }), run(' '),
    run('under', { underline: true }), run(' '),
    run('link', { link: { url: 'https://gofan.co/x' }, underline: true, foregroundColor: { color: { rgbColor: { blue: 1 } } } }),
    run(' '), run('red', { foregroundColor: { color: { rgbColor: { red: 0.8 } } } }),
    run(' '), run('black', { foregroundColor: { color: { rgbColor: {} } } }),
  ])]));
  const html = render(m);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>ital<\/em>/);
  assert.match(html, /<u>under<\/u>/);
  assert.match(html, /<a href="https:\/\/gofan.co\/x" target="_blank" style="color:#1c6e98;text-decoration:underline;">link<\/a>/);
  assert.match(html, /<span style="color:#cc0000;">red<\/span>/);
  assert.ok(!/<u>link/.test(html), 'Docs link underline is not doubled');
  assert.ok(!/color:#000000/.test(html), 'default black is left to the theme');
});

test('unsafe link schemes are dropped and text is escaped', () => {
  const m = NL.nlParseDocument(doc([para([run('<b>x</b>', { link: { url: 'javascript:alert(1)' } })])]));
  const html = render(m);
  assert.ok(!html.includes('javascript:'));
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.equal(NL.nlSafeUrl_('www.ltps.org'), 'https://www.ltps.org');
});

test('bulleted and numbered lists, nesting and continued numbering', () => {
  const m = NL.nlParseDocument(doc([
    para('one', { list: 'n' }), para('two', { list: 'n' }), para('sub', { list: 'n', level: 1 }),
    para('break'),
    para('three', { list: 'n' }),
    para('dot', { list: 'b' }),
  ], { lists: { n: numberList, b: bulletList } }));
  const types = m.blocks.map((b) => b.type);
  assert.deepEqual(types, ['list', 'paragraph', 'list', 'list']);
  assert.equal(m.blocks[2].items[0].number, 3, 'numbering continues across the interruption');
  const html = render(m);
  assert.match(html, /<ol style="[^"]*list-style-type:decimal;[^"]*"><li style="margin:0;">one<\/li><li style="margin:0;">two<ol[^>]*list-style-type:lower-alpha/);
  assert.match(html, /<ol start="3"/);
  assert.match(html, /<ul style="[^"]*list-style-type:disc/);
});

test('automatic dividers before Heading 1 sections, none before the first', () => {
  const m = NL.nlParseDocument(doc([
    para('A', { style: 'HEADING_1' }), para('text'),
    para('B', { style: 'HEADING_1' }), para('sub', { style: 'HEADING_2' }), para('text'),
  ]));
  const groups = NL.nlGroupBlocks_(m.blocks, cfg);
  assert.deepEqual(groups.map((g) => g.type), ['heading', 'rich', 'divider', 'heading', 'heading', 'rich']);
  assert.deepEqual(NL.nlGroupBlocks_(m.blocks, { ...cfg, autoDividers: false }).map((g) => g.type),
    ['heading', 'rich', 'heading', 'heading', 'rich']);
});

test('horizontal rule becomes a divider; blank lines collapse to one spacer', () => {
  const m = NL.nlParseDocument(doc([
    para('a'), para(''), para(''), para('b'),
    { paragraph: { elements: [{ horizontalRule: {} }, run('\n')], paragraphStyle: { namedStyleType: 'NORMAL_TEXT' } } },
    para('c'), para(''),
  ]));
  assert.deepEqual(m.blocks.map((b) => b.type), ['paragraph', 'spacer', 'paragraph', 'divider', 'paragraph']);
});

test('full-width images bleed; small images keep their size', () => {
  const m = NL.nlParseDocument(doc([para([image('big')]), para([image('small')], { align: 'CENTER' })], {
    inlineObjects: { big: inlineImage('https://img/big.png', 468, 'Big'), small: inlineImage('https://img/s.png', 117, 'Small') },
  }));
  const html = render(m, { resolveImage: (img) => 'https://cdn/' + img.objectId });
  assert.match(html, /<img src="https:\/\/cdn\/big" width="700" alt="Big" style="display:block;width:100%/);
  assert.match(html, /<img class="nl-img-sized" src="https:\/\/cdn\/small" width="175" height="88"/);
  assert.ok(!html.includes('https://img/'), 'resolver replaces temporary Docs URLs');
});

test('a paragraph that is only a Drive link becomes a download card', () => {
  const url = 'https://drive.google.com/file/d/1PkiRk9OH7UsUYV404hNlxXUYkOccoU_7/view';
  const m = NL.nlParseDocument(doc([
    para([run('flyer.pdf', { link: { url } })]),
    para([run('see '), run('flyer', { link: { url } })]),
    para([run('site', { link: { url: 'https://gofan.co' } })]),
  ]));
  assert.deepEqual(m.blocks.map((b) => b.type), ['attachment', 'paragraph', 'paragraph']);
  assert.equal(m.blocks[0].fileId, '1PkiRk9OH7UsUYV404hNlxXUYkOccoU_7');
  m.blocks[0].size = 1468006;
  const html = render(m);
  assert.match(html, />PDF<\/div>/);
  assert.match(html, />Download<\/div>/);
  assert.match(html, />1\.4 MB<\/div>/);
});

test('rich link chips to Google Docs render as Open cards', () => {
  const m = NL.nlParseDocument(doc([para([{ richLink: { richLinkProperties: {
    title: 'Permission slip', uri: 'https://docs.google.com/document/d/abcdefghijklmnop/edit', mimeType: 'application/vnd.google-apps.document',
  } } }])]));
  assert.equal(m.blocks[0].type, 'attachment');
  assert.match(render(m), />Open<\/div>/);
});

test('tables render with cell content', () => {
  const m = NL.nlParseDocument(doc([{ table: { tableRows: [{ tableCells: [
    { content: [para([run('Day', { bold: true })])] }, { content: [para('Event')] },
  ] }] } }]));
  assert.equal(m.blocks[0].type, 'table');
  assert.match(render(m), /<td class="nl-rich"[^>]*><p[^>]*><strong>Day<\/strong><\/p><\/td>/);
});

test('soft line breaks become <br>', () => {
  const m = NL.nlParseDocument(doc([para('Line one\u000bLine two', { style: 'HEADING_1' })]));
  assert.match(render(m), /Line one<br>Line two/);
});

test('email chrome: preheader, view in browser, responsive CSS, footer', () => {
  const m = NL.nlParseDocument(doc([para('T', { style: 'TITLE' }), para('S', { style: 'SUBTITLE' }), para('x')]));
  const html = render(m);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /mso-hide:all;">T S&nbsp;/);
  assert.match(html, /<a href="https:\/\/example.com\/pub"[^>]*>View in browser<\/a>/);
  assert.match(html, /@media screen and \(max-width:630px\)/);
  assert.match(html, />LMS Nation<\/div>/);
  assert.match(html, /2565 Princeton Pike/);
  assert.match(render(m, { config: { ...cfg, preheader: 'Custom' } }), /mso-hide:all;">Custom&nbsp;/);
  assert.ok(!render(m, { viewInBrowserUrl: '' }).includes('View in browser'));
});

test('plain text alternative', () => {
  const m = NL.nlParseDocument(doc([
    para('The Weekly Update', { style: 'TITLE' }),
    para('Dance', { style: 'HEADING_1' }),
    para([run('Tickets '), run('here', { link: { url: 'https://gofan.co' } })]),
    para('a', { list: 'n' }), para('b', { list: 'n' }),
  ], { lists: { n: numberList } }));
  const text = NL.nlRenderText(m, { config: cfg, viewInBrowserUrl: 'https://example.com/pub' });
  assert.match(text, /^THE WEEKLY UPDATE\n/);
  assert.match(text, /View in browser: https:\/\/example.com\/pub/);
  assert.match(text, /DANCE\n=====/);
  assert.match(text, /Tickets here \(https:\/\/gofan.co\)/);
  assert.match(text, /1\. a\n2\. b/);
});

test('empty and tabbed documents do not throw', () => {
  assert.deepEqual(NL.nlParseDocument({}).blocks, []);
  const tabbed = { tabs: [{ documentTab: doc([para('In a tab')]) }] };
  assert.equal(NL.nlParseDocument(tabbed).blocks[0].type, 'paragraph');
});

/* ---------------- translation ---------------- */

// Fake Translate: marks every text segment, leaves tags and attributes alone.
function fakeTranslator(calls) {
  return (html) => {
    calls.push(html);
    return html.split(/(<[^>]+>)/).map((part) => (part.startsWith('<') || !/[A-Za-z]/.test(part) ? part : `«${part}»`)).join('');
  };
}

const txDoc = () => NL.nlParseDocument(doc([
  para('The Weekly Update', { style: 'TITLE' }), para('September 21, 2026', { style: 'SUBTITLE' }),
  para('Dance', { style: 'HEADING_1' }),
  para([run('Tickets '), run('here', { link: { url: 'https://gofan.co/x' } })]), para('Bring ID'),
  para('one', { list: 'n' }),
  para([image('i1')]),
  para([run('form.pdf', { link: { url: 'https://drive.google.com/file/d/1PkiRk9OH7UsUYV404hNlxXUYkOccoU_7/view' } })]),
], { lists: { n: numberList }, inlineObjects: { i1: inlineImage('https://img/f.png', 468, 'Dance "flyer"') } }));

const languages = [{ code: 'en', url: 'https://w/exec?issue=S' }, { code: 'es', url: 'https://w/exec?issue=S&lang=es' }, { code: 'ar', url: 'https://w/exec?issue=S&lang=ar' }];

test('translated page: text translated, tags/links/styles intact, one call per section', () => {
  const calls = [];
  const html = render(txDoc(), { viewInBrowserUrl: '', lang: 'es', languages, originalUrl: 'https://w/exec?issue=S', translateHtml: fakeTranslator(calls) });
  assert.match(html, /<html lang="es" xmlns/);
  assert.match(html, /class="nl-banner-title"[^>]*>«The Weekly Update»<\/h1>/);
  assert.match(html, /«Dance»<\/h2>/);
  assert.match(html, /<p style="[^"]*">«Tickets »<a href="https:\/\/gofan.co\/x" target="_blank" style="color:#1c6e98;text-decoration:underline;">«here»<\/a><\/p><p style="[^"]*">«Bring ID»<\/p>/);
  assert.match(html, /alt="«Dance &quot;flyer&quot;»"/, 'alt text translated and re-escaped');
  assert.match(html, /«form.pdf»<\/td>/);
  assert.match(html, /«Download»<\/div>/);
  assert.match(html, /«Machine-translated by Google Translate\.[^»]*»/);
  assert.match(html, /<a href="https:\/\/w\/exec\?issue=S"[^>]*>«Read the original \(English\)»<\/a>/);
  // Title, subtitle, heading, one rich group (2 paragraphs + list), alt, attachment title, Download, notice x2
  assert.ok(calls.length <= 10, `expected batched calls, got ${calls.length}`);
  assert.ok(!calls.some((c) => /^\s*$/.test(c)), 'no calls for empty fragments');
  assert.ok(!html.includes('LMS Nation»'), 'footer brand name is not translated');
});

test('language row: current language bold, others linked, RTL names marked', () => {
  const html = render(txDoc(), { viewInBrowserUrl: 'https://w/exec?issue=S', languages });
  assert.match(html, /<strong lang="en" style="color:#222222;">English<\/strong>/);
  assert.match(html, /<a href="https:\/\/w\/exec\?issue=S&amp;lang=es"[^>]*lang="es"[^>]*>Español<\/a>/);
  assert.match(html, /lang="ar" dir="rtl"[^>]*>العربية<\/a>/);
  assert.match(html, /View in browser<\/a><\/td><\/tr><tr><td dir="ltr"[^>]*><span aria-hidden="true">&#127760;<\/span>/);
  assert.ok(!render(txDoc(), { viewInBrowserUrl: 'https://v' }).includes('&#127760;'), 'no row without languages');
});

test('right-to-left languages flip direction and alignment', () => {
  const html = render(txDoc(), { lang: 'ar', languages, originalUrl: 'https://w/o', translateHtml: (h) => h });
  assert.match(html, /<html lang="ar" dir="rtl"/);
  assert.match(html, /class="nl-box" align="right"[^>]*><div class="nl-rich" style="[^"]*text-align:right;"/);
  assert.match(html, /<ol style="margin:0;padding:0 1.6em 0 0;/);
  assert.ok(!/class="nl-box" align="left"/.test(html));
});

test('original rendering is unchanged when no translator is given', () => {
  const calls = [];
  const plain = render(txDoc());
  assert.ok(!plain.includes('«'));
  assert.ok(!plain.includes('Machine-translated'));
  assert.match(plain, /<html lang="en" xmlns/);
  assert.equal(calls.length, 0);
});

test('language list parsing', () => {
  assert.deepEqual(NL.nlParseLanguages('es, zh-CN;ko  ht,ar,es,EN,en,b@d,x', 'en'), ['es', 'zh-CN', 'ko', 'ht', 'ar']);
  assert.deepEqual(NL.nlParseLanguages('', 'en'), []);
  assert.equal(NL.nlLanguageName('zh-CN'), '中文(简体)');
  assert.equal(NL.nlLanguageName('xx'), 'XX');
  assert.ok(NL.nlIsRtl('ar') && NL.nlIsRtl('fa') && !NL.nlIsRtl('es'));
});
