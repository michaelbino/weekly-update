const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../apps-script/Layout.js');
const NL = require('../apps-script/Newsletter.js');
const { NEWSLETTER_CONFIG } = require('../apps-script/Config.js');
const { NEWSLETTER_THEME } = require('../apps-script/Theme.js');
const fixture = require('./fixtures/template-doc.json');

const model = NL.nlParseDocument(fixture);
const render = (theme, extra) => NL.nlRenderHtml(model, { config: NEWSLETTER_CONFIG, viewInBrowserUrl: 'https://v', theme, ...extra });

/* ---------------- template engine ---------------- */

test('variables: escaped, raw, dotted paths, missing values', () => {
  assert.equal(L.nlTpl('{{a}}|{{{a}}}', { a: '<b>&"\'' }), '&lt;b&gt;&amp;&quot;&#39;|<b>&"\'');
  assert.equal(L.nlTpl('{{t.width}}px {{ t.width }}px', { t: { width: 700 } }), '700px 700px');
  // A value right before a closing CSS brace must not be read as {{{raw}}}.
  assert.equal(L.nlTpl('.x{color:{{c}}}.y{a:{{{r}}}}', { c: 'red', r: '<b>' }), '.x{color:red}.y{a:<b>}');
  assert.equal(L.nlTpl('[{{nope}}][{{a.b.c}}][{{f}}][{{z}}]', { a: {}, f: false, z: 0 }), '[][][][0]');
});

test('sections: truthy, falsy, inverted, arrays with outer lookups', () => {
  assert.equal(L.nlTpl('{{#x}}yes{{/x}}{{^x}}no{{/x}}', { x: 'v' }), 'yes');
  assert.equal(L.nlTpl('{{#x}}yes{{/x}}{{^x}}no{{/x}}', { x: '' }), 'no');
  assert.equal(L.nlTpl('{{#x}}yes{{/x}}{{^x}}no{{/x}}', { x: [] }), 'no');
  assert.equal(
    L.nlTpl('{{#items}}{{^first}}, {{/first}}{{name}}@{{site}}{{/items}}', { site: 'S', items: [{ name: 'a', first: true }, { name: 'b' }] }),
    'a@S, b@S');
  assert.equal(L.nlTpl('{{#o}}{{k}}{{/o}}', { o: { k: 'inner' }, k: 'outer' }), 'inner');
  // A falsy value on the inner object must not fall through to an outer one.
  assert.equal(L.nlTpl('{{#items}}{{#rtl}}R{{/rtl}}{{/items}}', { rtl: true, items: [{ rtl: false }] }), '');
  assert.equal(L.nlTpl('{{#list}}{{.}};{{/list}}', { list: ['x', 'y'] }), 'x;y;');
});

test('line breaks and following indentation are removed; same-line spaces kept', () => {
  assert.equal(L.nlTpl('<p>\n    <b>A</b> and\n    B</p>', {}), '<p><b>A</b> andB</p>');
});

test('unbalanced sections throw clear errors', () => {
  assert.throws(() => L.nlTpl('{{#a}}x', {}), /\{\{#a\}\} is never closed/);
  assert.throws(() => L.nlTpl('{{#a}}x{{/b}}', {}), /\{\{\/b\}\} does not match \{\{#a\}\}/);
  assert.throws(() => L.nlTpl('x{{/b}}', {}), /does not match any open section/);
});

/* ---------------- themes ---------------- */

test('resolve merges tokens and templates over defaults and appends css', () => {
  const r = L.nlResolveLayout({ tokens: { h1Size: 30 }, templates: { divider: '<hr>' }, css: '.x{\n  color:red}' });
  assert.equal(r.tokens.h1Size, 30);
  assert.equal(r.tokens.h2Size, L.NL_DEFAULT_TOKENS.h2Size);
  assert.equal(r.templates.divider, '<hr>');
  assert.equal(r.templates.header, L.NL_DEFAULT_TEMPLATES.header);
  assert.ok(r.templates.css.endsWith('.x{color:red}'));
  assert.equal(L.NL_DEFAULT_TOKENS.h1Size, 26, 'defaults are not mutated');
});

test('validation catches typos, wrong types and broken templates', () => {
  const problems = L.nlValidateTheme({
    tokens: { h1Szie: 31, cardRadius: 12 },
    templates: { heder: 'x', footer: '{{#a}}x', rich: 42 },
    colours: {},
  });
  assert.deepEqual(problems, [
    'Unknown theme key "colours" (use tokens, templates or css).',
    'Unknown token "h1Szie". Did you mean "h1Size"?',
    'Token "cardRadius" should be a string.',
    'Unknown template "heder". Did you mean "header"?',
    'Template "footer": Template section {{#a}} is never closed',
    'Template "rich" must be a string.',
  ]);
  assert.deepEqual(L.nlValidateTheme(undefined), []);
});

test('the shipped Theme.js is valid', () => {
  assert.deepEqual(L.nlValidateTheme(NEWSLETTER_THEME), []);
});

test('every default template compiles and every token is referenced somewhere', () => {
  const all = Object.values(L.NL_DEFAULT_TEMPLATES).join('') + require('fs').readFileSync(require.resolve('../apps-script/Newsletter.js'), 'utf8');
  for (const [name, src] of Object.entries(L.NL_DEFAULT_TEMPLATES)) assert.doesNotThrow(() => L.nlCompileTpl(src), name);
  for (const token of Object.keys(L.NL_DEFAULT_TOKENS)) {
    assert.ok(all.includes(`t.${token}`), `token "${token}" is never used`);
  }
});

/* ---------------- rendering with themes ---------------- */

test('the default theme and no theme render identically', () => {
  assert.equal(render(NEWSLETTER_THEME), render(undefined));
  assert.equal(render({ tokens: {}, templates: {}, css: '' }), render(undefined));
});

test('token overrides reach headings, dividers, card, images, lists and CSS', () => {
  const html = render({ tokens: {
    h1Size: 31, dividerStyle: 'dotted', dividerWidth: '3px', cardRadius: '12px', width: 640,
    bodySize: 16, listIndent: '2em', mobileBreakpoint: 600, bannerTitleSize: 48,
  } });
  assert.match(html, /<h2 class="nl-h1" style="[^"]*font-size:31px;/);
  assert.match(html, /border-top:3px dotted #c73a3a;/);
  assert.match(html, /class="nl-card" width="640"[^>]*max-width:640px;[^>]*border-radius:12px;/);
  assert.match(html, /<img src="[^"]+" width="640" alt="[^"]*" style="display:block;width:100%;max-width:640px;/);
  assert.match(html, /<p style="margin:0;[^"]*font-size:16px;/);
  assert.match(html, /<ul style="margin:0;padding:0 0 0 2em;/);
  assert.match(html, /@media screen and \(max-width:600px\)/);
  assert.match(html, /class="nl-banner-title" style="[^"]*font-size:48px;/);
  assert.match(html, /border-radius:12px 12px 0 0;/, 'header corners follow the card radius');
});

test('template overrides and extension points', () => {
  const html = render({
    templates: {
      header: '<tr><td class="my-header">{{{title}}} / {{{subtitle}}} / {{c.footerName}}</td></tr>',
      cardBottom: '<tr><td class="social">\n  <a href="https://example.org">Website</a>\n</td></tr>',
    },
    css: '.social a{color:red}',
  });
  assert.match(html, /<td class="my-header">The Weekly Update \/ September 21, 2026 \/ LMS Nation<\/td>/);
  assert.ok(!html.includes('nl-banner-title"'), 'default header replaced');
  assert.match(html, /<tr><td class="social"><a href="https:\/\/example.org">Website<\/a><\/td><\/tr>\n<tr><td bgcolor="#c73a3a"/, 'cardBottom sits right above the footer');
  assert.match(html, /\.social a\{color:red\}<\/style>/);
});

test('translation still applies inside custom templates', () => {
  const mark = (h) => h.split(/(<[^>]+>)/).map((p) => (p.startsWith('<') || !/[A-Za-z]/.test(p) ? p : `«${p}»`)).join('');
  const html = NL.nlRenderHtml(model, {
    config: NEWSLETTER_CONFIG, lang: 'es', translateHtml: mark, originalUrl: 'https://o',
    theme: { templates: { heading: '<tr><td class="h">{{{html}}}</td></tr>' } },
  });
  assert.match(html, /<td class="h">«Attendance Information»<\/td>/);
});

test('settings values are escaped inside templates', () => {
  const html = NL.nlRenderHtml(model, { config: { ...NEWSLETTER_CONFIG, footerName: 'A "B" <C>', accentColor: 'red;"><script>x</script>' } });
  assert.ok(!html.includes('<script>x'));
  assert.match(html, />A &quot;B&quot; &lt;C&gt;<\/div>/);
});

test('CLI check-theme passes for the shipped theme and every example theme', async () => {
  const { checkTheme } = await import('../cli/newsletter.mjs');
  assert.deepEqual(checkTheme(), []);
  const dir = require('path').join(__dirname, '..', 'examples', 'themes');
  const examples = require('fs').readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(examples.length >= 3);
  for (const f of examples) assert.deepEqual(checkTheme(require('path').join(dir, f)), [], f);
});

test('example themes change what they claim to', () => {
  const ex = (name) => require(`../examples/themes/${name}.js`).NEWSLETTER_THEME;
  assert.match(render(ex('rounded')), /border-top:3px dotted #c73a3a;/);
  const mast = render(ex('masthead-left'));
  assert.match(mast, /background:#2b2b2b;[^>]*>September 21, 2026<\/td>/);
  assert.match(mast, /<h2 class="nl-h1" style="[^"]*text-align:left;">Attendance Information<\/h2>/);
  const social = render(ex('social-footer'));
  assert.match(social, /class="nl-pill"><a href="https:\/\/www.example.org\/calendar"/);
  assert.match(social, /\.nl-pill a\{display:inline-block;/);
});

test('docs/THEMING.md documents every token and template', () => {
  const guide = require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'THEMING.md'), 'utf8');
  for (const token of Object.keys(L.NL_DEFAULT_TOKENS)) assert.ok(guide.includes('`' + token + '`'), `token ${token} missing from THEMING.md`);
  for (const name of Object.keys(L.NL_DEFAULT_TEMPLATES)) assert.ok(guide.includes('| `' + name + '` |'), `template ${name} missing from THEMING.md`);
});

test('docs/WEB-SETUP.md lists every Apps Script file to paste', () => {
  const fs = require('fs');
  const path = require('path');
  const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'WEB-SETUP.md'), 'utf8');
  const files = fs.readdirSync(path.join(__dirname, '..', 'apps-script')).filter((f) => f !== 'Deployment.js');
  for (const f of files) {
    const name = f === 'appsscript.json' ? 'appsscript.json' : f.replace(/\.(js|html)$/, '');
    assert.ok(guide.includes('| `' + name + '` |'), `${f} missing from the WEB-SETUP.md file table`);
    assert.ok(guide.includes('`apps-script/' + f + '`'), `${f} source path missing from WEB-SETUP.md`);
  }
});
