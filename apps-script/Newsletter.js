/**
 * Pure newsletter engine: Google Docs API JSON -> content model -> email HTML / plain text.
 *
 * No Apps Script services are used here so the same file runs in Apps Script
 * (bound to the template Doc) and in Node (CLI + tests).
 */

// Docs page content width in points (8.5in page, 1in margins). Images at or
// near this width render full-bleed in the email.
var NL_DOC_CONTENT_WIDTH_PT = 468;
var NL_EMAIL_WIDTH = 700;
// Native names for the language row; any Google Translate code works, unknown ones show the code.
var NL_LANGUAGE_NAMES = {
  en: 'English', es: 'Español', 'zh-CN': '中文(简体)', 'zh-TW': '中文(繁體)', ko: '한국어', ht: 'Kreyòl ayisyen',
  ar: 'العربية', hi: 'हिन्दी', gu: 'ગુજરાતી', pa: 'ਪੰਜਾਬੀ', bn: 'বাংলা', te: 'తెలుగు', ta: 'தமிழ்', ur: 'اردو',
  pt: 'Português', fr: 'Français', vi: 'Tiếng Việt', ru: 'Русский', uk: 'Українська', pl: 'Polski', ja: '日本語',
  tl: 'Tagalog', fa: 'فارسی', so: 'Soomaali', sw: 'Kiswahili', de: 'Deutsch', it: 'Italiano', iw: 'עברית', he: 'עברית',
  am: 'አማርኛ', ne: 'नेपाली', ps: 'پښتو', my: 'မြန်မာ', km: 'ខ្មែរ', tr: 'Türkçe', el: 'Ελληνικά'
};
var NL_RTL_LANGUAGES = { ar: 1, he: 1, iw: 1, fa: 1, ur: 1, ps: 1, yi: 1, sd: 1, ug: 1, dv: 1 };
var NL_LANG_CODE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Parses "es, zh-CN, ko" into valid, de-duplicated language codes (never the source language). */
function nlParseLanguages(list, source) {
  var seen = {};
  return String(list || '').split(/[\s,;]+/).filter(function (code) {
    if (!NL_LANG_CODE_RE.test(code) || code === (source || 'en') || seen[code]) return false;
    seen[code] = true;
    return true;
  });
}

function nlLanguageName(code) { return NL_LANGUAGE_NAMES[code] || code.toUpperCase(); }
function nlIsRtl(code) { return !!NL_RTL_LANGUAGES[String(code).split('-')[0]]; }

var NL_ORDERED_GLYPHS = {
  DECIMAL: 'decimal', ZERO_DECIMAL: 'decimal-leading-zero',
  UPPER_ALPHA: 'upper-alpha', ALPHA: 'lower-alpha',
  UPPER_ROMAN: 'upper-roman', ROMAN: 'lower-roman'
};

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Converts a Docs API `documents.get` response into a newsletter model:
 *   { title, subtitle, banner, blocks: [...] }
 * Block types: heading, paragraph, list, image, attachment, divider, spacer, table.
 */
function nlParseDocument(doc) {
  var tab = nlFirstTab_(doc);
  var ctx = {
    lists: tab.lists || {},
    inlineObjects: tab.inlineObjects || {},
    positionedObjects: tab.positionedObjects || {},
    listCounters: {}
  };
  var model = { title: '', subtitle: '', banner: null, blocks: [] };
  var seenTitle = false;

  nlWalkContent_((tab.body && tab.body.content) || [], ctx, function (block, para) {
    var style = para && para.paragraphStyle && para.paragraphStyle.namedStyleType;
    if (block.type === 'paragraph' && style === 'TITLE' && !model.title) {
      model.title = nlRunsText_(block.runs).trim();
      seenTitle = true;
      return;
    }
    if (block.type === 'paragraph' && style === 'SUBTITLE' && !model.subtitle) {
      model.subtitle = nlRunsText_(block.runs).trim();
      return;
    }
    // An image placed above the Title replaces the text banner.
    if (block.type === 'image' && !seenTitle && !model.banner && !nlHasContent_(model.blocks)) {
      model.banner = block;
      return;
    }
    model.blocks.push(block);
  });

  model.blocks = nlTidyBlocks_(model.blocks);
  return model;
}

function nlFirstTab_(doc) {
  if (doc.body) return doc;
  if (doc.tabs && doc.tabs.length && doc.tabs[0].documentTab) return doc.tabs[0].documentTab;
  return { body: { content: [] } };
}

function nlHasContent_(blocks) {
  return blocks.some(function (b) { return b.type !== 'spacer'; });
}

/** Walks structural elements, emitting blocks via emit(block, paragraph). */
function nlWalkContent_(content, ctx, emit) {
  var currentList = null;
  content.forEach(function (el) {
    if (el.paragraph) {
      var para = el.paragraph;
      if (para.bullet) {
        var item = nlListItem_(para, ctx);
        if (!currentList || currentList.listId !== para.bullet.listId) {
          currentList = { type: 'list', listId: para.bullet.listId, items: [] };
          emit(currentList, para);
        }
        currentList.items.push(item);
        return;
      }
      currentList = null;
      nlParagraphBlocks_(para, ctx).forEach(function (b) { emit(b, para); });
    } else if (el.table) {
      currentList = null;
      emit(nlTable_(el.table, ctx), null);
    } else {
      // sectionBreak, tableOfContents: ignored
      if (!el.sectionBreak) currentList = null;
    }
  });
}

function nlListItem_(para, ctx) {
  var level = para.bullet.nestingLevel || 0;
  var listId = para.bullet.listId;
  var props = ctx.lists[listId] && ctx.lists[listId].listProperties;
  var nesting = (props && props.nestingLevels && props.nestingLevels[level]) || {};
  var glyph = nesting.glyphType;
  var ordered = !!(glyph && NL_ORDERED_GLYPHS[glyph]);

  // Docs continues numbering across interruptions within the same list.
  var counters = ctx.listCounters[listId] || (ctx.listCounters[listId] = []);
  counters.length = level + 1;
  counters[level] = (counters[level] || 0) + 1;

  var runs = nlRuns_(para.elements || [], ctx).runs;
  return {
    level: level,
    ordered: ordered,
    listStyle: ordered ? NL_ORDERED_GLYPHS[glyph] : 'disc',
    number: counters[level],
    runs: nlTrimRuns_(runs)
  };
}

/** A paragraph can yield several blocks (text, then any images it contains). */
function nlParagraphBlocks_(para, ctx) {
  var style = (para.paragraphStyle && para.paragraphStyle.namedStyleType) || 'NORMAL_TEXT';
  var align = nlAlign_(para.paragraphStyle && para.paragraphStyle.alignment);
  var elements = para.elements || [];
  var out = [];

  if (elements.some(function (e) { return e.horizontalRule; })) {
    out.push({ type: 'divider' });
  }

  var parsed = nlRuns_(elements, ctx);
  var runs = nlTrimRuns_(parsed.runs);
  var text = nlRunsText_(runs).trim();

  (para.positionedObjectIds || []).forEach(function (id) {
    var obj = ctx.positionedObjects[id];
    var img = obj && nlImageFrom_(obj.positionedObjectProperties, id, align);
    if (img) parsed.images.push(img);
  });

  var heading = /^HEADING_(\d)$/.exec(style);
  if (heading && text) {
    out.push({ type: 'heading', level: Math.min(parseInt(heading[1], 10), 3), align: align, runs: runs });
  } else if (style === 'TITLE' || style === 'SUBTITLE') {
    if (text) out.push({ type: 'paragraph', align: align, runs: runs });
  } else if (text) {
    out.push(nlAttachmentFrom_(parsed, runs, text) || { type: 'paragraph', align: align, runs: runs });
  } else if (!parsed.images.length && !out.length) {
    out.push({ type: 'spacer' });
  }

  parsed.images.forEach(function (img) { out.push(img); });
  return out;
}

function nlAlign_(a) {
  return a === 'CENTER' ? 'center' : a === 'END' ? 'right' : a === 'JUSTIFIED' ? 'justify' : '';
}

/** Collects styled text runs and images from paragraph elements. */
function nlRuns_(elements, ctx) {
  var runs = [];
  var images = [];
  var richLinks = [];
  elements.forEach(function (e) {
    if (e.textRun) {
      var ts = e.textRun.textStyle || {};
      var link = ts.link && ts.link.url ? ts.link.url : '';
      runs.push({
        text: e.textRun.content || '',
        bold: !!ts.bold,
        italic: !!ts.italic,
        underline: !!ts.underline && !link,
        strike: !!ts.strikethrough,
        link: link,
        color: link ? '' : nlColor_(ts.foregroundColor),
        script: ts.baselineOffset === 'SUPERSCRIPT' ? 'sup' : ts.baselineOffset === 'SUBSCRIPT' ? 'sub' : ''
      });
    } else if (e.inlineObjectElement) {
      var id = e.inlineObjectElement.inlineObjectId;
      var obj = ctx.inlineObjects[id];
      var img = obj && nlImageFrom_(obj.inlineObjectProperties, id, '');
      if (img) {
        var its = e.inlineObjectElement.textStyle || {};
        if (its.link && its.link.url) img.link = its.link.url;
        images.push(img);
      }
    } else if (e.richLink) {
      var p = e.richLink.richLinkProperties || {};
      richLinks.push(p);
      runs.push({ text: p.title || p.uri || '', link: p.uri || '', bold: false, italic: false,
        underline: false, strike: false, color: '', script: '', richLink: p });
    } else if (e.person) {
      var pp = e.person.personProperties || {};
      runs.push({ text: pp.name || pp.email || '', link: pp.email ? 'mailto:' + pp.email : '',
        bold: false, italic: false, underline: false, strike: false, color: '', script: '' });
    } else if (e.dateElement) {
      var dp = e.dateElement.dateElementProperties || {};
      runs.push({ text: dp.displayText || '', link: '', bold: false, italic: false,
        underline: false, strike: false, color: '', script: '' });
    }
  });
  return { runs: nlMergeRuns_(runs), images: images, richLinks: richLinks };
}

function nlImageFrom_(props, id, align) {
  var eo = props && props.embeddedObject;
  if (!eo || !eo.imageProperties) return null;
  var size = eo.size || {};
  var w = nlPt_(size.width);
  var h = nlPt_(size.height);
  return {
    type: 'image',
    objectId: id,
    contentUri: eo.imageProperties.contentUri || '',
    alt: eo.description || eo.title || '',
    widthPt: w,
    heightPt: h,
    align: align || 'center',
    link: ''
  };
}

function nlPt_(dim) {
  if (!dim || dim.magnitude == null) return 0;
  return dim.unit === 'EMU' ? dim.magnitude / 12700 : dim.magnitude;
}

function nlColor_(fg) {
  var rgb = fg && fg.color && fg.color.rgbColor;
  if (!rgb) return '';
  var hex = '#' + ['red', 'green', 'blue'].map(function (k) {
    var v = Math.round((rgb[k] || 0) * 255);
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
  // Near-black is the Docs default text colour; let the theme decide.
  var lum = (rgb.red || 0) + (rgb.green || 0) + (rgb.blue || 0);
  return lum < 0.25 ? '' : hex;
}

function nlSameStyle_(a, b) {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline &&
    a.strike === b.strike && a.link === b.link && a.color === b.color &&
    a.script === b.script && !a.richLink && !b.richLink;
}

function nlMergeRuns_(runs) {
  var out = [];
  runs.forEach(function (r) {
    if (!r.text) return;
    var last = out[out.length - 1];
    if (last && nlSameStyle_(last, r)) last.text += r.text;
    else out.push(Object.assign({}, r));
  });
  return out;
}

/** Drops the paragraph's trailing newline and trailing whitespace-only runs. */
function nlTrimRuns_(runs) {
  var out = runs.map(function (r) { return Object.assign({}, r); });
  while (out.length) {
    var last = out[out.length - 1];
    last.text = last.text.replace(/\n+$/, '');
    if (last.text === '') out.pop(); else break;
  }
  return out;
}

function nlRunsText_(runs) {
  return runs.map(function (r) { return r.text; }).join('').replace(/\u000b/g, '\n');
}

var NL_DRIVE_FILE_RE = /^https?:\/\/(?:drive|docs)\.google\.com\/(?:file|document|spreadsheets|presentation|forms|drawings)\/(?:u\/\d+\/)?d\/([\w-]{10,})/;
var NL_DRIVE_OPEN_RE = /^https?:\/\/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]{10,})/;

/** A paragraph that is nothing but one Drive file link (or file chip) becomes a download card. */
function nlAttachmentFrom_(parsed, runs, text) {
  var linked = runs.filter(function (r) { return r.text.trim(); });
  if (!linked.length) return null;
  var url = linked[0].link;
  if (!url || !linked.every(function (r) { return r.link === url; })) return null;
  var m = NL_DRIVE_FILE_RE.exec(url) || NL_DRIVE_OPEN_RE.exec(url);
  if (!m) return null;
  var rich = linked[0].richLink || {};
  return {
    type: 'attachment',
    url: url,
    fileId: m[1],
    title: text,
    mimeType: rich.mimeType || '',
    size: 0
  };
}

function nlTable_(table, ctx) {
  var rows = (table.tableRows || []).map(function (row) {
    return (row.tableCells || []).map(function (cell) {
      var blocks = [];
      var cellCtx = Object.assign({}, ctx);
      nlWalkContent_(cell.content || [], cellCtx, function (b) { blocks.push(b); });
      return { blocks: nlTidyBlocks_(blocks), background: nlCellBg_(cell) };
    });
  });
  return { type: 'table', rows: rows };
}

function nlCellBg_(cell) {
  var bg = cell.tableCellStyle && cell.tableCellStyle.backgroundColor;
  var rgb = bg && bg.color && bg.color.rgbColor;
  if (!rgb) return '';
  return '#' + ['red', 'green', 'blue'].map(function (k) {
    var v = Math.round((rgb[k] || 0) * 255);
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

/** Collapses spacers, trims them around headings/dividers and at the ends. */
function nlTidyBlocks_(blocks) {
  var out = [];
  blocks.forEach(function (b) {
    var prev = out[out.length - 1];
    if (b.type === 'spacer') {
      if (!prev || prev.type === 'spacer' || prev.type === 'heading' || prev.type === 'divider') return;
    }
    if ((b.type === 'heading' || b.type === 'divider') && prev && prev.type === 'spacer') out.pop();
    if (b.type === 'divider' && out.length && out[out.length - 1].type === 'divider') return;
    out.push(b);
  });
  while (out.length && (out[out.length - 1].type === 'spacer' || out[out.length - 1].type === 'divider')) out.pop();
  while (out.length && out[0].type === 'divider') out.shift();
  return out;
}

/** Every image in the model (banner, body, tables) for hosting/inlining. */
function nlCollectImages(model) {
  var imgs = [];
  if (model.banner) imgs.push(model.banner);
  (function walk(blocks) {
    blocks.forEach(function (b) {
      if (b.type === 'image') imgs.push(b);
      if (b.type === 'table') b.rows.forEach(function (r) { r.forEach(function (c) { walk(c.blocks); }); });
    });
  })(model.blocks);
  return imgs;
}

function nlCollectAttachments(model) {
  var out = [];
  (function walk(blocks) {
    blocks.forEach(function (b) {
      if (b.type === 'attachment') out.push(b);
      if (b.type === 'table') b.rows.forEach(function (r) { r.forEach(function (c) { walk(c.blocks); }); });
    });
  })(model.blocks);
  return out;
}

/* ------------------------------------------------------------------ */
/* HTML rendering                                                      */
/* ------------------------------------------------------------------ */

function nlEsc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function nlSafeUrl_(url) {
  var u = String(url || '').trim();
  if (/^(https?:|mailto:|tel:|cid:)/i.test(u)) return u;
  if (/^www\./i.test(u)) return 'https://' + u;
  return '';
}

/**
 * Renders the model to a responsive, email-client-safe HTML document.
 * opts: { config, viewInBrowserUrl, subject, resolveImage(img) -> src,
 *         lang, translateHtml(html) -> html, languages: [{code, url}], originalUrl }
 * translateHtml is called once per section (not per paragraph) to keep Translate calls low.
 */
function nlRenderHtml(model, opts) {
  opts = opts || {};
  var c = Object.assign({}, opts.config || {});
  var resolve = opts.resolveImage || function (img) { return img.contentUri; };
  var body = c.bodyFont;
  var pStyle = 'margin:0;font-family:' + body + ';font-size:15px;line-height:1.5;color:' + c.textColor +
    ';overflow-wrap:break-word;word-wrap:break-word;word-break:break-word;';
  var lang = opts.lang || c.sourceLanguage || 'en';
  var rtl = nlIsRtl(lang);
  var translate = opts.translateHtml;
  var ctx = {
    c: c, resolve: resolve, pStyle: pStyle, rtl: rtl, start: rtl ? 'right' : 'left',
    // Translate an HTML fragment; skip calls for fragments with no words.
    tx: function (html) {
      return translate && /[^\s\u00a0]/.test(nlPlain_(html).replace(/&nbsp;/g, '')) ? translate(html) : html;
    },
    txText: function (text) { return translate && text ? nlPlain_(ctx.tx(nlEsc_(text))) : text; }
  };

  var title = model.title || opts.subject || '';
  var preheader = c.preheader || [model.title, model.subtitle].filter(Boolean).join(' ');
  var rows = [];

  rows.push(nlHeaderRow_(model, ctx));
  nlGroupBlocks_(model.blocks, c).forEach(function (g) { rows.push(nlRenderGroup_(g, ctx)); });
  rows.push(nlFooterRow_(ctx));

  var bgStyle = c.backgroundImageUrl
    ? "background:" + c.pageBackground + " url('" + nlEsc_(c.backgroundImageUrl) + "') top center / 100% auto no-repeat;"
    : 'background:' + c.pageBackground + ';';
  var view = nlSafeUrl_(opts.viewInBrowserUrl);
  var topBar = nlTopBar_(view, opts.languages || [], lang, c);

  return [
    '<!DOCTYPE html>',
    '<html lang="' + nlEsc_(lang) + '"' + (rtl ? ' dir="rtl"' : '') + ' xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    '<title>' + nlEsc_(title) + '</title>',
    '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->',
    '<style>' + nlCss_(c) + '</style>',
    '</head>',
    '<body class="nl-body" style="margin:0;padding:0;width:100%;' + bgStyle + '">',
    '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">' +
      nlEsc_(preheader) + '&nbsp;' + new Array(60).join('&zwnj;&nbsp;') + '</div>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="' + bgStyle + '">',
    topBar,
    '<tr><td align="center" style="padding:24px 10px 24px 10px;">',
    '<!--[if mso]><table role="presentation" width="' + NL_EMAIL_WIDTH + '" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" class="nl-card" width="' + NL_EMAIL_WIDTH + '" cellspacing="0" cellpadding="0" border="0" align="center" ' +
      'style="width:100%;max-width:' + NL_EMAIL_WIDTH + 'px;background:#ffffff;border-radius:4px;border:5px solid rgba(0,0,0,0.1);border-collapse:separate;">',
    opts.originalUrl ? nlNoticeRow_(opts.originalUrl, ctx) : '',
    rows.join('\n'),
    '</table>',
    '<!--[if mso]></td></tr></table><![endif]-->',
    '</td></tr>',
    c.footerNote ? '<tr><td align="center" style="padding:0 16px 24px 16px;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#888888;">' +
      nlEsc_(c.footerNote) + '</td></tr>' : '',
    '</table>',
    '</body>',
    '</html>'
  ].join('\n');
}

/** "Not displaying correctly? View in browser" plus the language row (current language unlinked). */
function nlTopBar_(view, languages, lang, c) {
  if (!view && !languages.length) return '';
  var cell = 'font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#777777;';
  var links = languages.map(function (l) {
    var name = nlEsc_(nlLanguageName(l.code));
    var dir = nlIsRtl(l.code) ? ' dir="rtl"' : '';
    return l.code === lang || !l.url
      ? '<strong lang="' + nlEsc_(l.code) + '"' + dir + ' style="color:#222222;">' + name + '</strong>'
      : '<a href="' + nlEsc_(nlSafeUrl_(l.url)) + '" target="_blank" lang="' + nlEsc_(l.code) + '"' + dir +
        ' style="color:#444444;text-decoration:underline;">' + name + '</a>';
  }).join(' &middot; ');
  return '<tr><td align="center" style="background:#f4f4f4;border-top:1px solid #dddddd;border-bottom:1px solid #dddddd;padding:8px 10px;">' +
    '<table role="presentation" class="nl-w" width="' + NL_EMAIL_WIDTH + '" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:' + NL_EMAIL_WIDTH + 'px;">' +
    (view ? '<tr><td dir="ltr" style="' + cell + '">Not displaying correctly? ' +
      '<a href="' + nlEsc_(view) + '" target="_blank" style="color:#444444;text-decoration:underline;">View in browser</a></td></tr>' : '') +
    (links ? '<tr><td dir="ltr" style="' + cell + '"><span aria-hidden="true">&#127760;</span> ' + links + '</td></tr>' : '') +
    '</table></td></tr>';
}

/** Tells readers the page is machine-translated and links back to the original. */
function nlNoticeRow_(originalUrl, ctx) {
  var c = ctx.c;
  var text = ctx.tx(nlEsc_('Machine-translated by Google Translate. Names, dates and amounts may be wrong; check the original.'));
  var link = ctx.tx(nlEsc_('Read the original (English)'));
  return '<tr><td class="nl-box" style="padding:14px 20px 0 20px;">' +
    '<div style="background:#fff8e1;border:1px solid #f0d58a;border-radius:4px;padding:10px 12px;font-family:' + c.bodyFont +
    ';font-size:13px;line-height:1.5;color:#5c4a12;text-align:' + ctx.start + ';">' + text + ' ' +
    '<a href="' + nlEsc_(nlSafeUrl_(originalUrl)) + '" style="color:' + c.linkColor + ';font-weight:bold;">' + link + '</a></div></td></tr>';
}

/** Tag-stripped, entity-decoded text (for attributes and word checks). */
function nlPlain_(html) {
  return String(html || '').replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function nlCss_(c) {
  return [
    ':root{color-scheme:light;supported-color-schemes:light}',
    'html,body{margin:0 auto!important;padding:0!important;width:100%!important}',
    '*{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%}',
    'table,td{mso-table-lspace:0pt!important;mso-table-rspace:0pt!important}',
    'table{border-spacing:0!important;border-collapse:collapse;margin:0 auto}',
    '.nl-card{table-layout:fixed}',
    '.nl-rich a{word-break:break-all}',
    'img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}',
    'a[x-apple-data-detectors],.unstyle-auto-detected-links a{border-bottom:0!important;cursor:default!important;color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}',
    '.a6S{display:none!important;opacity:.01!important}',
    'u + #body a{color:inherit;text-decoration:none;font-size:inherit;font-family:inherit;font-weight:inherit;line-height:inherit}',
    '@media screen and (max-width:630px){',
    '.nl-box{padding-left:14px!important;padding-right:14px!important}',
    '.nl-rich p,.nl-rich li,.nl-rich span,.nl-rich td{font-size:17px!important}',
    '.nl-h1{font-size:24px!important}',
    '.nl-banner-title{font-size:38px!important}',
    '.nl-img-sized{width:100%!important;height:auto!important}',
    '.nl-card{border-width:0!important;border-radius:0!important}',
    '}'
  ].join('');
}

function nlHeaderRow_(model, ctx) {
  var c = ctx.c;
  if (model.banner) {
    var src = ctx.resolve(model.banner);
    return '<tr><td style="background:' + c.accentColor + ';border-radius:4px 4px 0 0;" bgcolor="' + c.accentColor + '">' +
      '<img src="' + nlEsc_(src) + '" width="' + NL_EMAIL_WIDTH + '" alt="' + nlEsc_(ctx.txText(model.banner.alt || model.title)) + '" ' +
      'style="display:block;width:100%;max-width:' + NL_EMAIL_WIDTH + 'px;height:auto;border-radius:4px 4px 0 0;"></td></tr>';
  }
  if (!model.title && !model.subtitle) return '';
  return '<tr><td align="center" bgcolor="' + c.accentColor + '" style="background:' + c.accentColor +
    ';border-radius:4px 4px 0 0;padding:56px 24px 44px 24px;text-align:center;">' +
    (model.title ? '<h1 class="nl-banner-title" style="margin:0;font-family:' + c.headingFont +
      ';font-size:52px;line-height:1.05;font-weight:bold;color:' + c.accentTextColor + ';">' + ctx.tx(nlEsc_(model.title)) + '</h1>' : '') +
    (model.subtitle ? '<p style="margin:18px 0 0 0;font-family:' + c.bodyFont + ';font-size:17px;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;">' +
      ctx.tx(nlEsc_(model.subtitle)) + '</p>' : '') +
    '</td></tr>';
}

function nlFooterRow_(ctx) {
  var c = ctx.c;
  if (!c.footerName && !c.footerTagline) return '';
  var logo = c.footerLogoUrl
    ? '<td valign="middle" width="64" style="padding-right:12px;"><img src="' + nlEsc_(c.footerLogoUrl) + '" width="52" alt="' + nlEsc_(c.footerName) + '" style="display:block;"></td>'
    : '';
  return '<tr><td bgcolor="' + c.accentColor + '" style="background:' + c.accentColor + ';border-radius:0 0 4px 4px;padding:16px 20px;">' +
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0!important;"><tr>' + logo +
    '<td valign="middle" style="text-align:' + ctx.start + ';">' +
    (c.footerName ? '<div style="font-family:' + c.bodyFont + ';font-size:18px;font-weight:bold;line-height:1.2;color:' + c.accentTextColor + ';">' + nlEsc_(c.footerName) + '</div>' : '') +
    (c.footerTagline ? '<div style="font-family:' + c.bodyFont + ';font-size:13px;line-height:1.4;color:' + c.accentTextColor + ';">' + nlEsc_(c.footerTagline) + '</div>' : '') +
    '</td></tr></table></td></tr>';
}

/**
 * Groups consecutive paragraph/list/spacer blocks into one "rich" cell and
 * inserts automatic dividers before Heading 1 sections.
 */
function nlGroupBlocks_(blocks, c) {
  var groups = [];
  var rich = null;
  var seenContent = false;
  blocks.forEach(function (b, i) {
    if (b.type === 'paragraph' || b.type === 'list' || b.type === 'spacer') {
      if (!rich) { rich = { type: 'rich', blocks: [] }; groups.push(rich); }
      rich.blocks.push(b);
      seenContent = true;
      return;
    }
    rich = null;
    if (b.type === 'heading' && b.level === 1 && c.autoDividers && seenContent) {
      var prev = blocks[i - 1];
      var lastGroup = groups[groups.length - 1];
      if (prev && prev.type !== 'divider' && !(lastGroup && lastGroup.type === 'divider')) {
        groups.push({ type: 'divider' });
      }
    }
    groups.push(b);
    seenContent = true;
  });
  // A trailing spacer inside a rich group adds nothing.
  groups.forEach(function (g) {
    if (g.type !== 'rich') return;
    while (g.blocks.length && g.blocks[g.blocks.length - 1].type === 'spacer') g.blocks.pop();
  });
  return groups.filter(function (g) { return g.type !== 'rich' || g.blocks.length; });
}

function nlRenderGroup_(g, ctx) {
  var c = ctx.c;
  switch (g.type) {
    case 'heading': return nlHeadingRow_(g, ctx);
    case 'rich':
      return '<tr><td class="nl-box" align="' + ctx.start + '" valign="top" style="padding:5px 20px 20px 20px;">' +
        '<div class="nl-rich" style="' + ctx.pStyle + 'text-align:' + ctx.start + ';">' + ctx.tx(nlRenderRich_(g.blocks, ctx)) + '</div></td></tr>';
    case 'divider':
      return '<tr><td class="nl-box" style="padding:20px 20px 20px 20px;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>' +
        '<td style="border-top:2px solid ' + c.accentColor + ';font-size:1px;line-height:1px;height:1px;">&nbsp;</td></tr></table></td></tr>';
    case 'image': return nlImageRow_(g, ctx);
    case 'attachment': return nlAttachmentRow_(g, ctx);
    case 'table':
      return '<tr><td class="nl-box" style="padding:10px 20px 20px 20px;">' + nlRenderTable_(g, ctx) + '</td></tr>';
    default: return '';
  }
}

function nlHeadingRow_(h, ctx) {
  var c = ctx.c;
  var align = h.align && h.align !== 'justify' ? h.align : c.headingAlign;
  var size = h.level === 1 ? 26 : h.level === 2 ? 20 : 17;
  var tag = h.level === 1 ? 'h2' : h.level === 2 ? 'h3' : 'h4';
  var pad = h.level === 1 ? '20px 20px 6px 20px' : '14px 20px 4px 20px';
  return '<tr><td class="nl-box" align="' + align + '" valign="top" style="padding:' + pad + ';">' +
    '<' + tag + (h.level === 1 ? ' class="nl-h1"' : '') + ' style="margin:0;font-family:' + c.headingFont + ';font-size:' + size +
    'px;line-height:1.25;font-weight:bold;color:' + c.textColor + ';text-align:' + align + ';">' +
    ctx.tx(nlRenderRuns_(h.runs, ctx)) + '</' + tag + '></td></tr>';
}

function nlRenderRich_(blocks, ctx) {
  return blocks.map(function (b) {
    if (b.type === 'spacer') return '<p style="' + ctx.pStyle + '">&nbsp;</p>';
    if (b.type === 'paragraph') {
      var align = b.align ? 'text-align:' + b.align + ';' : '';
      return '<p style="' + ctx.pStyle + align + '">' + nlRenderRuns_(b.runs, ctx) + '</p>';
    }
    if (b.type === 'list') return nlRenderList_(b.items, ctx);
    return '';
  }).join('');
}

function nlRenderList_(items, ctx) {
  // Build a nested tree from flat (level, runs) items.
  var root = { children: [], level: -1 };
  var stack = [root];
  items.forEach(function (it) {
    while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
    var node = { item: it, level: it.level, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  function render(nodes) {
    if (!nodes.length) return '';
    var first = nodes[0].item;
    var tag = first.ordered ? 'ol' : 'ul';
    var start = first.ordered && first.number > 1 ? ' start="' + first.number + '"' : '';
    return '<' + tag + start + ' style="margin:0;padding:' + (ctx.rtl ? '0 1.6em 0 0' : '0 0 0 1.6em') + ';list-style-type:' + first.listStyle + ';font-family:' +
      ctx.c.bodyFont + ';font-size:15px;line-height:1.5;color:' + ctx.c.textColor + ';">' +
      nodes.map(function (n) {
        return '<li style="margin:0;">' + nlRenderRuns_(n.item.runs, ctx) + render(n.children) + '</li>';
      }).join('') + '</' + tag + '>';
  }
  return render(root.children);
}

function nlRenderRuns_(runs, ctx) {
  return runs.map(function (r) {
    var html = nlEsc_(r.text).replace(/\u000b|\n/g, '<br>');
    if (r.script) html = '<' + r.script + '>' + html + '</' + r.script + '>';
    if (r.strike) html = '<s>' + html + '</s>';
    if (r.underline) html = '<u>' + html + '</u>';
    if (r.italic) html = '<em>' + html + '</em>';
    if (r.bold) html = '<strong>' + html + '</strong>';
    if (r.color) html = '<span style="color:' + r.color + ';">' + html + '</span>';
    var href = nlSafeUrl_(r.link);
    if (href) {
      html = '<a href="' + nlEsc_(href) + '" target="_blank" style="color:' + ctx.c.linkColor +
        ';text-decoration:underline;">' + html + '</a>';
    }
    return html;
  }).join('');
}

function nlImageRow_(img, ctx) {
  var src = ctx.resolve(img);
  if (!src) return '';
  var full = !img.widthPt || img.widthPt >= NL_DOC_CONTENT_WIDTH_PT * 0.85;
  var tag;
  var alt = nlEsc_(ctx.txText(img.alt));
  var href = nlSafeUrl_(img.link);
  if (full) {
    tag = '<img src="' + nlEsc_(src) + '" width="' + NL_EMAIL_WIDTH + '" alt="' + alt + '" ' +
      'style="display:block;width:100%;max-width:' + NL_EMAIL_WIDTH + 'px;height:auto;">';
    if (href) tag = '<a href="' + nlEsc_(href) + '" target="_blank">' + tag + '</a>';
    return '<tr><td align="center" valign="top">' + tag + '</td></tr>';
  }
  var w = Math.min(NL_EMAIL_WIDTH - 40, Math.round(img.widthPt * NL_EMAIL_WIDTH / NL_DOC_CONTENT_WIDTH_PT));
  var h = img.heightPt ? Math.round(img.heightPt * w / img.widthPt) : 0;
  tag = '<img class="nl-img-sized" src="' + nlEsc_(src) + '" width="' + w + '"' + (h ? ' height="' + h + '"' : '') +
    ' alt="' + alt + '" style="display:inline-block;width:' + w + 'px;max-width:100%;height:auto;">';
  if (href) tag = '<a href="' + nlEsc_(href) + '" target="_blank">' + tag + '</a>';
  var align = img.align === 'right' ? 'right' : img.align === '' ? ctx.start : img.align === 'justify' ? 'center' : img.align;
  return '<tr><td class="nl-box" align="' + align + '" valign="top" style="padding:10px 20px 10px 20px;text-align:' + align + ';">' + tag + '</td></tr>';
}

function nlFileKind_(att) {
  var mt = att.mimeType || '';
  var m = /\.([a-z0-9]{2,4})$/i.exec(att.title || '');
  if (m) return m[1].toUpperCase();
  if (/google-apps\.document|\/document\//.test(mt + att.url)) return 'DOC';
  if (/google-apps\.spreadsheet|\/spreadsheets\//.test(mt + att.url)) return 'SHEET';
  if (/google-apps\.presentation|\/presentation\//.test(mt + att.url)) return 'SLIDES';
  if (/google-apps\.form|\/forms\//.test(mt + att.url)) return 'FORM';
  if (/pdf/.test(mt)) return 'PDF';
  if (/^image\//.test(mt)) return 'IMG';
  return 'FILE';
}

function nlFormatSize_(bytes) {
  if (!bytes) return '';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
}

function nlAttachmentRow_(att, ctx) {
  var c = ctx.c;
  var href = nlEsc_(nlSafeUrl_(att.url));
  var kind = nlFileKind_(att);
  var native = /^(DOC|SHEET|SLIDES|FORM)$/.test(kind);
  var size = nlFormatSize_(att.size);
  return '<tr><td class="nl-box" style="padding:10px 20px 10px 20px;">' +
    '<a href="' + href + '" target="_blank" style="text-decoration:none;color:' + c.textColor + ';display:block;">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #cccccc;border-radius:6px;border-collapse:separate;background:#ffffff;">' +
    '<tr><td width="52" valign="middle" style="padding:12px 0 12px 12px;">' +
    '<div style="width:40px;height:44px;line-height:44px;border-radius:4px;background:' + c.accentColor + ';color:#ffffff;' +
    'font-family:Arial,sans-serif;font-size:' + (kind.length > 4 ? 9 : 11) + 'px;font-weight:bold;text-align:center;">' + nlEsc_(kind) + '</div></td>' +
    '<td valign="middle" style="padding:12px;font-family:' + c.bodyFont + ';font-size:15px;line-height:1.4;font-weight:bold;color:' + c.textColor + ';word-break:break-word;">' +
    ctx.tx(nlEsc_(att.title)) + '</td>' +
    '<td width="90" align="center" valign="middle" style="padding:12px 12px 12px 0;font-family:' + c.bodyFont + ';">' +
    '<div style="font-size:14px;font-weight:bold;color:' + c.linkColor + ';text-decoration:underline;">' + ctx.tx(native ? 'Open' : 'Download') + '</div>' +
    (size ? '<div style="font-size:12px;color:#aaaaaa;">' + nlEsc_(size) + '</div>' : '') +
    '</td></tr></table></a></td></tr>';
}

function nlRenderTable_(t, ctx) {
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' +
    t.rows.map(function (row) {
      return '<tr>' + row.map(function (cell) {
        var bg = cell.background ? 'background:' + cell.background + ';' : '';
        var inner = cell.blocks.map(function (b) {
          if (b.type === 'heading') return '<p style="' + ctx.pStyle + 'font-weight:bold;">' + nlRenderRuns_(b.runs, ctx) + '</p>';
          if (b.type === 'image') {
            var src = ctx.resolve(b);
            return src ? '<img src="' + nlEsc_(src) + '" alt="' + nlEsc_(b.alt) + '" style="display:block;max-width:100%;height:auto;">' : '';
          }
          if (b.type === 'attachment') {
            return '<p style="' + ctx.pStyle + '"><a href="' + nlEsc_(nlSafeUrl_(b.url)) + '" style="color:' + ctx.c.linkColor + ';">' + nlEsc_(b.title) + '</a></p>';
          }
          return nlRenderRich_([b], ctx);
        }).join('');
        return '<td class="nl-rich" valign="top" style="border:1px solid #dddddd;padding:8px;text-align:' + ctx.start + ';' + bg + '">' +
          (inner ? ctx.tx(inner) : '&nbsp;') + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</table>';
}

/* ------------------------------------------------------------------ */
/* Plain-text rendering                                                */
/* ------------------------------------------------------------------ */

function nlRenderText(model, opts) {
  opts = opts || {};
  var c = opts.config || {};
  var lines = [];
  if (model.title) lines.push(model.title.toUpperCase());
  if (model.subtitle) lines.push(model.subtitle);
  if (opts.viewInBrowserUrl) lines.push('', 'View in browser: ' + opts.viewInBrowserUrl);
  lines.push('');

  function runsText(runs) {
    return runs.map(function (r) {
      var t = r.text.replace(/\u000b/g, '\n');
      var href = nlSafeUrl_(r.link);
      if (href && href.replace(/^mailto:/, '') !== t.trim() && href !== t.trim()) t += ' (' + href.replace(/^mailto:/, '') + ')';
      return t;
    }).join('');
  }

  function walk(blocks) {
    blocks.forEach(function (b) {
      switch (b.type) {
        case 'heading':
          var h = runsText(b.runs);
          lines.push('', b.level === 1 ? h.toUpperCase() : h, b.level === 1 ? new Array(Math.min(h.length, 60) + 1).join('=') : '');
          break;
        case 'paragraph': lines.push(runsText(b.runs)); break;
        case 'spacer': lines.push(''); break;
        case 'divider': lines.push('', '------------------------------------------------------------', ''); break;
        case 'list':
          b.items.forEach(function (it) {
            var pad = new Array(it.level * 3 + 1).join(' ');
            lines.push(pad + (it.ordered ? it.number + '. ' : '* ') + runsText(it.runs));
          });
          break;
        case 'image':
          if (b.alt) lines.push('[Image: ' + b.alt + ']');
          break;
        case 'attachment': lines.push(b.title + ': ' + b.url); break;
        case 'table':
          b.rows.forEach(function (row) {
            lines.push(row.map(function (cell) {
              return cell.blocks.map(function (cb) { return cb.runs ? runsText(cb.runs) : ''; }).join(' ').trim();
            }).join(' | '));
          });
          break;
      }
    });
  }
  walk(model.blocks);
  lines.push('', '------------------------------------------------------------');
  if (c.footerName) lines.push(c.footerName);
  if (c.footerTagline) lines.push(c.footerTagline);
  if (c.footerNote) lines.push(c.footerNote);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

if (typeof module !== 'undefined') {
  module.exports = {
    nlParseDocument: nlParseDocument,
    nlParseLanguages: nlParseLanguages,
    nlLanguageName: nlLanguageName,
    nlIsRtl: nlIsRtl,
    nlRenderHtml: nlRenderHtml,
    nlRenderText: nlRenderText,
    nlCollectImages: nlCollectImages,
    nlCollectAttachments: nlCollectAttachments,
    nlGroupBlocks_: nlGroupBlocks_,
    nlColor_: nlColor_,
    nlSafeUrl_: nlSafeUrl_
  };
}
