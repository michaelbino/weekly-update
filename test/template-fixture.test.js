// Integration test against a real documents.get response of the seeded template Doc.
const test = require('node:test');
const assert = require('node:assert/strict');
const NL = require('../apps-script/Newsletter.js');
const { NEWSLETTER_CONFIG } = require('../apps-script/Config.js');
const fixture = require('./fixtures/template-doc.json');

const model = NL.nlParseDocument(fixture);
const headings = model.blocks.filter((b) => b.type === 'heading').map((b) => b.runs.map((r) => r.text).join(''));

test('template matches the sections of example.eml', () => {
  assert.equal(model.title, 'The Weekly Update');
  assert.equal(model.subtitle, 'September 21, 2026');
  assert.deepEqual(headings, [
    'Reminder: School is closed\u000bon Monday, September 21 Yom Kippur',
    'View Your School Pictures from September 4, 2026 Online',
    'Mark Your Calendar - Week of September 21',
    'Welcome Back Dance, September 24, 6 - 8 pm',
    'Attendance Information',
    'Dining Services Information',
    'Winter Sports Information',
    'Yearbook Information',
    'LMS/LHS PTO',
  ]);
});

test('images, attachments and lists are recognised', () => {
  assert.equal(NL.nlCollectImages(model).length, 6);
  const atts = NL.nlCollectAttachments(model);
  assert.deepEqual(atts.map((a) => a.title), ['happinessad26.27.pdf', 'LMS yearbook order form.pdf']);
  assert.ok(model.blocks.some((b) => b.type === 'list' && b.items[0].ordered));
  assert.ok(model.blocks.some((b) => b.type === 'divider'), 'explicit horizontal rule survives');
});

test('renders a complete email with one divider per section', () => {
  const html = NL.nlRenderHtml(model, { config: NEWSLETTER_CONFIG, viewInBrowserUrl: 'https://docs.google.com/document/d/x/pub' });
  const dividers = html.match(/border-top:2px solid #c73a3a/g).length;
  assert.equal(dividers, headings.length - 1 + 1, 'auto dividers + the explicit rule');
  for (const s of ['https://gofan.co/event/6902010?schoolId=NJ21578_1', 'mailto:office@example.org',
    'Enter code: XXXXXXXXXX', 'YBKICONS', 'Thank you for your support.']) {
    assert.ok(html.includes(s.replace(/&/g, '&amp;')), `missing ${s}`);
  }
  assert.ok(html.length < 102 * 1024, 'stays under Gmail\'s 102KB clipping limit');
  const text = NL.nlRenderText(model, { config: NEWSLETTER_CONFIG });
  assert.match(text, /WINTER SPORTS INFORMATION/);
});
