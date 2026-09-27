/**
 * Google Docs glue for the newsletter: menu, preview, send, publish, next issue.
 * Rendering lives in Newsletter.js; brand defaults in Config.js.
 */

var NL_SETTINGS_FILE = 'Newsletter settings.json';
var NL_PUBLISHED_URL_KEY = 'publishedUrl';

function onOpen() {
  DocumentApp.getUi().createMenu('Newsletter')
    .addItem('Preview', 'showPreview')
    .addItem('Send preview to me', 'sendPreviewToMe')
    .addItem('Send preview to team', 'sendPreviewToTeam')
    .addSeparator()
    .addItem('Publish web version (View in browser link)', 'publishWebVersion')
    .addItem('Start next issue (make a copy)', 'startNextIssue')
    .addSeparator()
    .addItem('Settings…', 'showSettings')
    .addItem('How to write the newsletter', 'showHelp')
    .addToUi();
}

function onInstall() { onOpen(); }

/* ---------------- menu actions ---------------- */

function showPreview() {
  var built = buildNewsletter_({ hosting: 'contentUri' });
  var t = HtmlService.createTemplateFromFile('Preview');
  t.html = built.html;
  t.subject = built.subject;
  t.warnings = built.warnings;
  DocumentApp.getUi().showModalDialog(t.evaluate().setWidth(900).setHeight(700), 'Newsletter preview');
}

function sendPreviewToMe() {
  var me = Session.getEffectiveUser().getEmail();
  sendPreview_([me]);
}

function sendPreviewToTeam() {
  var ui = DocumentApp.getUi();
  var cfg = getConfig_();
  var res = ui.prompt('Send preview to team',
    'Comma-separated email addresses.' + (cfg.previewRecipients ? '\nLeave blank to reuse: ' + cfg.previewRecipients : ''),
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var list = (res.getResponseText() || cfg.previewRecipients).split(/[,;\s]+/).filter(function (s) { return /@/.test(s); });
  if (!list.length) { ui.alert('No valid email addresses entered.'); return; }
  saveSettings_({ previewRecipients: list.join(', ') });
  sendPreview_(list);
}

function sendPreview_(recipients) {
  var built = buildNewsletter_({});
  var cfg = built.config;
  var options = { htmlBody: built.html, name: cfg.senderName, inlineImages: built.inlineImages };
  if (cfg.replyTo) options.replyTo = cfg.replyTo;
  MailApp.sendEmail(recipients.join(','), built.subject, built.text, options);

  var msg = 'Sent "' + built.subject + '" to ' + recipients.join(', ') + '.';
  if (built.warnings.length) msg += '\n\n' + built.warnings.join('\n');
  DocumentApp.getUi().alert('Preview sent', msg, DocumentApp.getUi().ButtonSet.OK);
}

function publishWebVersion() {
  var ui = DocumentApp.getUi();
  var dep = nlDeployment_();
  var ok = ui.alert('Publish web version', dep
    ? 'This publishes the newsletter, looking exactly like the email, at a public link. ' +
      'The "View in browser" link in the email will point there, and every "Send preview" refreshes it.\n\nContinue?'
    : 'The web app is not set up, so this publishes the Doc itself to the web (anyone with the link can read it). ' +
      'It updates automatically as you edit.\n\nContinue?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  var url;
  var warnings = [];
  if (dep) {
    nlEnsureSnapshot_(DocumentApp.getActiveDocument().getName());
    var built = buildNewsletter_({});
    url = built.viewInBrowserUrl;
    warnings = built.warnings;
  } else {
    url = publishDoc_(DocumentApp.getActiveDocument().getId());
  }
  showLinkDialog_('Published', {
    message: 'The web version is live. This is where "View in browser" in the email goes.',
    url: url,
    label: 'Open web version',
    warnings: warnings,
    note: dep ? 'Each "Send preview" refreshes this page. The link stays the same.' : ''
  });
}

/** Modal with a primary "open" button, copy-link button and optional warnings. */
function showLinkDialog_(title, opts) {
  var t = HtmlService.createTemplateFromFile('LinkDialog');
  t.message = opts.message;
  t.url = opts.url;
  t.label = opts.label;
  t.warnings = opts.warnings || [];
  t.note = opts.note || '';
  var height = 170 + t.warnings.length * 56 + (t.note ? 24 : 0);
  DocumentApp.getUi().showModalDialog(t.evaluate().setWidth(460).setHeight(height), title);
}

function startNextIssue() {
  var ui = DocumentApp.getUi();
  var doc = DocumentApp.getActiveDocument();
  var monday = nextMonday_(new Date());
  var tz = Session.getScriptTimeZone();
  var suggested = doc.getName().replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/, '').trim();
  if (!/week of$/i.test(suggested)) suggested = 'Weekly Update - Week of';
  suggested += ' ' + Utilities.formatDate(monday, tz, 'M/d');

  var res = ui.prompt('Start next issue',
    'Name for the new issue (also the email subject).\nLeave blank for "' + suggested + '".', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var name = res.getResponseText().trim() || suggested;

  var file = DriveApp.getFileById(doc.getId());
  var parents = file.getParents();
  var copy = parents.hasNext() ? file.makeCopy(name, parents.next()) : file.makeCopy(name);

  // Refresh the date line (Subtitle) in the copy.
  var body = DocumentApp.openById(copy.getId()).getBody();
  var paras = body.getParagraphs();
  for (var i = 0; i < paras.length; i++) {
    if (paras[i].getHeading() === DocumentApp.ParagraphHeading.SUBTITLE) {
      paras[i].setText(Utilities.formatDate(monday, tz, 'MMMM d, yyyy'));
      break;
    }
  }

  showLinkDialog_('Next issue ready', {
    message: 'Created "' + name + '".',
    url: copy.getUrl(),
    label: 'Open the new issue',
    note: 'The first time you use the Newsletter menu in the new copy, Google will ask you to authorize it once.'
  });
}

function showSettings() {
  var t = HtmlService.createTemplateFromFile('Settings');
  t.config = getConfig_();
  DocumentApp.getUi().showSidebar(t.evaluate().setTitle('Newsletter settings'));
}

function showHelp() {
  DocumentApp.getUi().showSidebar(
    HtmlService.createHtmlOutputFromFile('Help').setTitle('Writing the newsletter'));
}

/* ---------------- settings ---------------- */

function getConfig_() {
  return Object.assign({}, NEWSLETTER_CONFIG, readSettings_());
}

function settingsFolder_() {
  var parents = DriveApp.getFileById(DocumentApp.getActiveDocument().getId()).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

function readSettings_() {
  try {
    var files = settingsFolder_().getFilesByName(NL_SETTINGS_FILE);
    return files.hasNext() ? JSON.parse(files.next().getBlob().getDataAsString()) : {};
  } catch (e) {
    return {};
  }
}

/** Called from Settings.html. Only known keys are stored. */
function saveSettings_(values) {
  var current = readSettings_();
  Object.keys(values).forEach(function (k) {
    if (!(k in NEWSLETTER_CONFIG)) return;
    var v = values[k];
    if (typeof NEWSLETTER_CONFIG[k] === 'boolean') v = v === true || v === 'true' || v === 'on';
    if (v === NEWSLETTER_CONFIG[k] || v === '' && NEWSLETTER_CONFIG[k] === '') delete current[k];
    else current[k] = v;
  });
  var json = JSON.stringify(current, null, 2);
  var folder = settingsFolder_();
  var files = folder.getFilesByName(NL_SETTINGS_FILE);
  if (files.hasNext()) files.next().setContent(json);
  else folder.createFile(NL_SETTINGS_FILE, json, MimeType.PLAIN_TEXT);
  return getConfig_();
}

function saveSettings(values) { return saveSettings_(values); }

/* ---------------- build ---------------- */

/**
 * Builds subject, HTML, plain text and inline images for the active Doc.
 * opts.hosting: 'contentUri' uses the Docs API's temporary image URLs (preview only).
 */
function buildNewsletter_(opts) {
  opts = opts || {};
  var gdoc = DocumentApp.getActiveDocument();
  var docId = gdoc.getId();
  var cfg = getConfig_();
  var json = Docs.Documents.get(docId);
  var model = nlParseDocument(json);
  var warnings = [];
  var inlineImages = {};
  var srcById = {};

  var hosting = opts.hosting || cfg.imageHosting;
  nlCollectImages(model).forEach(function (img, i) {
    if (srcById[img.objectId] || !img.contentUri) return;
    if (hosting === 'contentUri') { srcById[img.objectId] = img.contentUri; return; }
    var blob = fetchImage_(img, i);
    if (hosting === 'drive') {
      try {
        srcById[img.objectId] = hostOnDrive_(blob, cfg.imageFolderName);
        return;
      } catch (e) {
        hosting = 'inline';
        warnings.push('Images could not be shared publicly from Drive (' + e.message + '), so they were embedded in the message instead.');
      }
    }
    var key = 'img' + i;
    inlineImages[key] = blob;
    srcById[img.objectId] = 'cid:' + key;
  });

  nlCollectAttachments(model).forEach(function (att) {
    try {
      var f = DriveApp.getFileById(att.fileId);
      att.mimeType = att.mimeType || f.getMimeType();
      if (!/google-apps/.test(att.mimeType)) att.size = f.getSize();
      if (f.getSharingAccess() === DriveApp.Access.PRIVATE) {
        warnings.push('"' + att.title + '" is not shared; readers will not be able to open it.');
      }
    } catch (e) { /* not accessible to us: render without size */ }
  });

  // Snapshots are only written by real sends/publishes, never by the Preview dialog.
  var snapshot = opts.hosting === 'contentUri' ? null : nlExistingSnapshot_();
  var viewUrl = cfg.viewInBrowserUrl || (snapshot ? nlSnapshotUrl_(snapshot) : '') ||
    PropertiesService.getDocumentProperties().getProperty(NL_PUBLISHED_URL_KEY) || '';
  if (!viewUrl) {
    viewUrl = gdoc.getUrl();
    warnings.push('The web version is not published yet, so "View in browser" points to the editable Doc. Use Newsletter > Publish web version.');
  }

  var subject = cfg.subject || gdoc.getName();
  var source = cfg.sourceLanguage || 'en';
  var languages = snapshot ? nlParseLanguages(cfg.translateLanguages, source) : [];
  var originalUrl = snapshot ? nlSnapshotUrl_(snapshot) : '';
  // Language row: the original plus one web page per translation (only once a web version exists).
  var languageLinks = languages.length ? [{ code: source, url: originalUrl }].concat(languages.map(function (lang) {
    return { code: lang, url: originalUrl + '&lang=' + encodeURIComponent(lang) };
  })) : [];
  var renderOpts = {
    config: cfg,
    subject: subject,
    viewInBrowserUrl: viewUrl,
    languages: languageLinks,
    resolveImage: function (img) { return srcById[img.objectId] || img.contentUri; }
  };
  if (snapshot) {
    // The web version has no "View in browser" bar and needs publicly hosted images.
    if (hosting === 'inline') warnings.push('Images are embedded in the email only, so they will be missing from the web version.');
    var webOpts = Object.assign({}, renderOpts, { viewInBrowserUrl: '', lang: source });
    nlWriteSnapshot_(snapshot, nlRenderHtml(model, webOpts), subject);
    languages.forEach(function (lang) {
      try {
        var html = nlRenderHtml(model, Object.assign({}, webOpts, {
          lang: lang, originalUrl: originalUrl, translateHtml: nlTranslator_(lang, source)
        }));
        nlWriteTranslation_(snapshot, lang, html, subject + ' (' + nlLanguageName(lang) + ')');
      } catch (e) {
        warnings.push('Could not translate into ' + nlLanguageName(lang) + ' (' + e.message + '). ' +
          'Its link shows the previous translation, or the original if there is none. Try again later.');
      }
    });
  }
  return {
    subject: subject,
    html: nlRenderHtml(model, renderOpts),
    text: nlRenderText(model, renderOpts),
    inlineImages: inlineImages,
    warnings: warnings,
    viewInBrowserUrl: viewUrl,
    config: cfg
  };
}

/**
 * Google Translate via LanguageApp (no API key). HTML mode keeps tags and styles.
 * Results are cached by content for 6 hours so resending a preview only
 * translates sections that changed.
 */
function nlTranslator_(lang, source) {
  var cache = CacheService.getScriptCache();
  return function (html) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, lang + '|' + html, Utilities.Charset.UTF_8)
      .map(function (b) { return ((b + 256) % 256).toString(16).replace(/^(.)$/, '0$1'); }).join('');
    var key = 'tx:' + digest;
    var hit = cache.get(key);
    if (hit !== null) return hit;
    var out = LanguageApp.translate(html, source, lang, { contentType: 'html' });
    try { cache.put(key, out, 21600); } catch (e) { /* value too large to cache */ }
    return out;
  };
}

function fetchImage_(img, i) {
  var resp = UrlFetchApp.fetch(img.contentUri, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Could not download image ' + (i + 1) + ' from the Doc (HTTP ' + resp.getResponseCode() + ').');
  return resp.getBlob().setName('image' + i);
}

/**
 * Stores the image in a public Drive folder, named by content hash so the same
 * image is uploaded once no matter how many previews are sent.
 */
function hostOnDrive_(blob, folderName) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes())
    .map(function (b) { return ((b + 256) % 256).toString(16).replace(/^(.)$/, '0$1'); }).join('');
  var ext = (blob.getContentType() || 'image/png').split('/')[1].replace('jpeg', 'jpg').replace(/\+.*/, '');
  var name = digest + '.' + ext;
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  var existing = folder.getFilesByName(name);
  var file = existing.hasNext() ? existing.next() : folder.createFile(blob.setName(name));
  if (file.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

/** Publishes the Doc to the web (auto-republish on edit) and returns the public URL. */
function publishDoc_(docId) {
  var revs = Drive.Revisions.list(docId, { fields: 'revisions(id)', pageSize: 1000 }).revisions || [];
  var head = revs[revs.length - 1];
  Drive.Revisions.update({ published: true, publishAuto: true, publishedOutsideDomain: true }, docId, head.id);
  var info = Drive.Revisions.get(docId, head.id, { fields: 'publishedLink' });
  var url = (info && info.publishedLink) || 'https://docs.google.com/document/d/' + docId + '/pub';
  PropertiesService.getDocumentProperties().setProperty(NL_PUBLISHED_URL_KEY, url);
  return url;
}

function nextMonday_(d) {
  var r = new Date(d.getTime());
  r.setDate(r.getDate() + ((8 - r.getDay()) % 7 || 7));
  return r;
}

if (typeof module !== 'undefined') module.exports = { nextMonday_: nextMonday_ };
