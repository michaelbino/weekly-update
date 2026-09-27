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
