// Runs the Apps Script files in a VM context with mocked Google services.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('./fixtures/template-doc.json');

const SRC = ['Config.js', 'Newsletter.js', 'WebApp.js', 'Code.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'));

function makeEnv(opts = {}) {
  const calls = { snapshots: [], served: [], mail: [], alerts: [], dialogs: [], created: [], shared: [], revUpdates: [], copies: [], prompts: [] };
  const files = {}; // name -> content in the Doc's folder
  const ANYONE = 'ANYONE_WITH_LINK';
  let fileSeq = 0;

  const allFiles = {};
  function mockFile(id, name, content, access, mime, parent) {
    const f = {
      id, name, content, access: access || 'PRIVATE', description: '',
      getDescription: () => f.description, setDescription: (d) => { f.description = d; },
      getId: () => id, getName: () => name, getUrl: () => 'https://docs.google.com/document/d/' + id + '/edit',
      getBlob: () => ({ getDataAsString: () => f.content }),
      setContent: (c) => { f.content = c; files[name] = f; },
      getSharingAccess: () => f.access,
      setSharing: (a) => { if (opts.sharingBlocked) throw new Error('Sharing disabled by admin'); f.access = a; calls.shared.push(id); },
      getMimeType: () => mime || 'application/pdf', getSize: () => 1468006,
      getParents: () => iter([parent || folder]),
      makeCopy: (n) => { calls.copies.push(n); return mockFile('copy1', n); },
    };
    allFiles[id] = f;
    return f;
  }
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const snapFolder = {
    getId: () => 'SNAPFOLDER',
    createFile: (n, c, m) => { const f = mockFile('snap' + ++fileSeq + 'abcdefghij', n, c, 'PRIVATE', m, snapFolder); calls.snapshots.push(f.id); return f; },
  };
  const folder = {
    getId: () => 'FOLDER',
    getFilesByName: (n) => iter(files[n] ? [files[n]] : []),
    createFile: (a, b) => {
      const f = typeof a === 'string' ? mockFile('f' + ++fileSeq, a, b) : mockFile('img' + ++fileSeq, a.getName(), '');
      files[f.name] = f; calls.created.push(f.name); return f;
    },
  };
  const blob = (type) => {
    const b = { name: '', getBytes: () => [1, 2, 250], getContentType: () => type, getName: () => b.name, setName: (n) => { b.name = n; return b; } };
    return b;
  };
  const docFile = mockFile('DOC1', 'Weekly Update - Week of 9/21');
  const docProps = {};
  const paragraphs = [{ getHeading: () => 'SUBTITLE', setText: (t) => { calls.subtitle = t; } }];
  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' },
    alert: (...a) => { calls.alerts.push(a); return opts.confirm || 'YES'; },
    prompt: (title, msg) => { calls.prompts.push(msg); return { getSelectedButton: () => 'OK', getResponseText: () => opts.promptText || '' }; },
    showModalDialog: (h, t) => calls.dialogs.push(t),
    showSidebar: (h) => calls.dialogs.push('sidebar'),
    createMenu: () => { const m = { items: [], addItem: (l, f) => { m.items.push(f); return m; }, addSeparator: () => m, addToUi: () => { calls.menu = m.items; } }; return m; },
  };

  const ctx = {
    console,
    DocumentApp: {
      getUi: () => ui,
      getActiveDocument: () => ({ getId: () => 'DOC1', getName: () => docFile.getName(), getUrl: () => docFile.getUrl() }),
      openById: () => ({ getBody: () => ({ getParagraphs: () => paragraphs }) }),
      ParagraphHeading: { SUBTITLE: 'SUBTITLE' },
    },
    Docs: { Documents: { get: () => JSON.parse(JSON.stringify(fixture)) } },
    Drive: {
      Revisions: {
        list: () => ({ revisions: [{ id: '1' }, { id: '7' }] }),
        update: (res, id, rev) => calls.revUpdates.push({ res, id, rev }),
        get: () => ({ publishedLink: 'https://docs.google.com/document/d/e/PUB/pub' }),
      },
    },
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE', ANYONE_WITH_LINK: ANYONE },
      Permission: { VIEW: 'VIEW' },
      getFileById: (id) => {
        if (id === 'DOC1') return docFile;
        if (allFiles[id]) return allFiles[id];
        if (id === 'missing000000') throw new Error('not found');
        return mockFile(id, 'attachment.pdf', '', ANYONE);
      },
      getFolderById: (id) => { assert.equal(id, 'SNAPFOLDER'); return snapFolder; },
      getFoldersByName: () => iter([folder]),
      createFolder: () => folder,
      getRootFolder: () => folder,
    },
    MimeType: { PLAIN_TEXT: 'text/plain', HTML: 'text/html' },
    MailApp: { sendEmail: (...a) => calls.mail.push(a) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'editor@example.com' }), getScriptTimeZone: () => 'America/New_York' },
    PropertiesService: { getDocumentProperties: () => ({ getProperty: (k) => docProps[k] || null, setProperty: (k, v) => { docProps[k] = v; } }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getBlob: () => blob('image/jpeg') }) },
    ScriptApp: { getOAuthToken: () => 'tok' },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      computeDigest: () => [0, 15, -1, 16],
      formatDate: (d, tz, f) => (f === 'M/d' ? `${d.getMonth() + 1}/${d.getDate()}` : `F:${d.toISOString().slice(0, 10)}`),
    },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({ setWidth() { return this; }, setHeight() { return this; }, setTitle() { return this; } }) }),
      createHtmlOutput: (content) => {
        const out = { content, setWidth() { return out; }, setHeight() { return out; },
          setTitle(t) { out.title = t; return out; }, addMetaTag(n, v) { out.meta = [n, v]; return out; } };
        calls.served.push(out);
        return out;
      },
      createHtmlOutputFromFile: () => ({ setTitle() { return this; } }),
    },
  };
  vm.createContext(ctx);
  SRC.forEach((s) => vm.runInContext(s, ctx));
  if (opts.deployment !== false) {
    vm.runInContext("var NEWSLETTER_DEPLOYMENT = { webAppUrl: 'https://script.google.com/macros/s/DEP/exec', snapshotFolderId: 'SNAPFOLDER' };", ctx);
  }
  return { ctx, calls, files, docProps };
}

test('onOpen installs the Newsletter menu', () => {
  const { ctx, calls } = makeEnv();
  ctx.onOpen();
  assert.deepEqual(calls.menu, ['showPreview', 'sendPreviewToMe', 'sendPreviewToTeam', 'publishWebVersion',
    'startNextIssue', 'showSettings', 'showHelp']);
});

test('send preview to me: Drive-hosted images, subject from Doc name, warning when unpublished', () => {
  const { ctx, calls } = makeEnv();
  ctx.sendPreviewToMe();
  assert.equal(calls.mail.length, 1);
  const [to, subject, text, options] = calls.mail[0];
  assert.equal(to, 'editor@example.com');
  assert.equal(subject, 'Weekly Update - Week of 9/21');
  assert.match(text, /THE WEEKLY UPDATE/);
  assert.equal(options.name, 'LMS Nation');
  assert.match(options.htmlBody, /https:\/\/lh3\.googleusercontent\.com\/d\/img\d+/);
  assert.ok(!options.htmlBody.includes('lh7-rt.googleusercontent.com'), 'no expiring Docs image URLs');
  assert.deepEqual(Object.keys(options.inlineImages), []);
  assert.equal(calls.created.filter((n) => n === '000fff10.jpg').length, 1, 'identical images uploaded once');
  assert.match(calls.alerts[0][1], /not published yet/);
  assert.match(options.htmlBody, /href="https:\/\/docs.google.com\/document\/d\/DOC1\/edit"[^>]*>View in browser/);
});

test('falls back to inline CID images when public sharing is blocked', () => {
  const { ctx, calls } = makeEnv({ sharingBlocked: true });
  ctx.sendPreviewToMe();
  const options = calls.mail[0][3];
  assert.ok(Object.keys(options.inlineImages).length >= 1);
  assert.match(options.htmlBody, /src="cid:img\d+"/);
  assert.match(calls.alerts[0][1], /embedded in the message/);
});

test('without a web app deployment, publish falls back to publishing the Doc', () => {
  const { ctx, calls, docProps } = makeEnv({ deployment: false });
  ctx.publishWebVersion();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.revUpdates[0])), { res: { published: true, publishAuto: true, publishedOutsideDomain: true }, id: 'DOC1', rev: '7' });
  assert.equal(docProps.publishedUrl, 'https://docs.google.com/document/d/e/PUB/pub');
  ctx.sendPreviewToMe();
  assert.match(calls.mail[0][3].htmlBody, /href="https:\/\/docs.google.com\/document\/d\/e\/PUB\/pub"/);
});

test('publish is skipped when the editor declines', () => {
  const { ctx, calls } = makeEnv({ confirm: 'NO' });
  ctx.publishWebVersion();
  assert.equal(calls.revUpdates.length, 0);
  assert.equal(calls.snapshots.length, 0);
});

test('publish writes an email-look snapshot and the email links to the web app', () => {
  const { ctx, calls, docProps } = makeEnv();
  ctx.publishWebVersion();
  assert.equal(calls.revUpdates.length, 0, 'the Doc itself is not published');
  assert.equal(calls.snapshots.length, 1);
  const snapId = calls.snapshots[0];
  assert.equal(docProps.snapshotFileId, snapId);
  const url = 'https://script.google.com/macros/s/DEP/exec?issue=' + snapId;
  assert.match(calls.alerts[1][1], new RegExp('Web version: ' + url.replace(/[?.]/g, '\\$&')));

  const snap = ctx.DriveApp.getFileById(snapId);
  assert.match(snap.content, /class="nl-banner-title"/, 'snapshot is the rendered email');
  assert.ok(!snap.content.includes('View in browser'), 'no self-link bar on the web version');
  assert.equal(snap.description, 'Weekly Update - Week of 9/21');

  ctx.sendPreviewToMe();
  assert.ok(calls.mail[0][3].htmlBody.includes('href="' + url + '"'), 'View in browser points at the snapshot');
  assert.ok(!/not published yet/.test(calls.alerts[2][1]));
  assert.equal(calls.snapshots.length, 1, 'republishing reuses the same file and link');
});

test('send preview refreshes a published snapshot; Preview dialog never writes one', () => {
  const { ctx, calls } = makeEnv();
  ctx.publishWebVersion();
  const snap = ctx.DriveApp.getFileById(calls.snapshots[0]);
  snap.content = 'stale';
  ctx.showPreview();
  assert.equal(snap.content, 'stale');
  ctx.sendPreviewToMe();
  assert.match(snap.content, /^<!DOCTYPE html>/);
});

test('send preview before publishing does not create a snapshot', () => {
  const { ctx, calls } = makeEnv();
  ctx.sendPreviewToMe();
  assert.equal(calls.snapshots.length, 0);
  assert.match(calls.alerts[0][1], /not published yet/);
});

test('doGet serves snapshots from the snapshot folder only', () => {
  const { ctx, calls } = makeEnv();
  ctx.publishWebVersion();
  const id = calls.snapshots[0];
  const page = ctx.doGet({ parameter: { issue: id } });
  assert.match(page.content, /class="nl-banner-title"/);
  assert.equal(page.title, 'Weekly Update - Week of 9/21');
  assert.deepEqual(Array.from(page.meta), ['viewport', 'width=device-width, initial-scale=1']);

  for (const issue of ['DOC1', 'someOtherFile123', 'missing000000', '../etc', undefined]) {
    const res = ctx.doGet({ parameter: issue === undefined ? {} : { issue } });
    assert.match(res.content, /could not be found/, `refused ${issue}`);
  }
  assert.match(ctx.doGet(undefined).content, /could not be found/);
});

test('doGet refuses everything when the web app is not configured', () => {
  const { ctx } = makeEnv({ deployment: false });
  assert.match(ctx.doGet({ parameter: { issue: 'snap1abcdefghij' } }).content, /could not be found/);
});

test('settings are stored next to the Doc and override defaults', () => {
  const { ctx, files, calls } = makeEnv();
  ctx.saveSettings({ senderName: 'LMS Office', accentColor: '#c73a3a', autoDividers: false, bogus: 'x' });
  const saved = JSON.parse(files['Newsletter settings.json'].content);
  assert.deepEqual(saved, { senderName: 'LMS Office', autoDividers: false });
  ctx.sendPreviewToMe();
  assert.equal(calls.mail[0][3].name, 'LMS Office');
});

test('send preview to team validates and remembers recipients', () => {
  const { ctx, calls, files } = makeEnv({ promptText: 'a@x.org, nope; b@y.org' });
  ctx.sendPreviewToTeam();
  assert.equal(calls.mail[0][0], 'a@x.org,b@y.org');
  assert.equal(JSON.parse(files['Newsletter settings.json'].content).previewRecipients, 'a@x.org, b@y.org');
});

test('start next issue copies the Doc with next Monday in the name and date', () => {
  const { ctx, calls } = makeEnv();
  ctx.startNextIssue();
  assert.match(calls.copies[0], /^Weekly Update - Week of \d{1,2}\/\d{1,2}$/);
  assert.match(calls.subtitle, /^F:\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(calls.dialogs, ['Next issue ready']);
});

test('nextMonday_ always moves forward to a Monday', () => {
  const { ctx } = makeEnv();
  for (const d of ['2026-09-21', '2026-09-25', '2026-09-27']) {
    const r = ctx.nextMonday_(new Date(d + 'T12:00:00'));
    assert.equal(r.getDay(), 1);
    assert.ok(r > new Date(d + 'T12:00:00'));
  }
});
