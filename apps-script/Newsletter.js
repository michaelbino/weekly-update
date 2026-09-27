/**
 * Pure newsletter engine: Google Docs API JSON -> content model -> email HTML / plain text.
 *
 * No Apps Script services are used here so the same file runs in Apps Script
 * (bound to the template Doc) and in Node (CLI + tests).
 */

// Docs page content width in points (8.5in page, 1in margins). Images at or
// near this width render full-bleed in the email.
var NL_DOC_CONTENT_WIDTH_PT = 468;
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

/** The layout framework (Layout.js): a global in Apps Script, a module in Node. */
function nlLayoutApi_() {
  return typeof NL_LAYOUT_API !== 'undefined' ? NL_LAYOUT_API : require('./Layout.js').NL_LAYOUT_API;
}

/**
 * Renders the model to a responsive, email-client-safe HTML document.
 * opts: { config, viewInBrowserUrl, subject, resolveImage(img) -> src,
 *         lang, translateHtml(html) -> html, languages: [{code, url}], originalUrl,
 *         theme: { tokens, templates, css } (see Theme.js / docs/THEMING.md) }
 * translateHtml is called once per section (not per paragraph) to keep Translate calls low.
 */
function nlRenderHtml(model, opts) {
  opts = opts || {};
  var api = nlLayoutApi_();
  var layout = api.resolve(opts.theme);
  var t = layout.tokens;
  var c = Object.assign({}, opts.config || {});
  var resolve = opts.resolveImage || function (img) { return img.contentUri; };
  var pStyle = 'margin:0;font-family:' + c.bodyFont + ';font-size:' + t.bodySize + 'px;line-height:' + t.lineHeight +
    ';color:' + c.textColor + ';overflow-wrap:break-word;word-wrap:break-word;word-break:break-word;';
  var lang = opts.lang || c.sourceLanguage || 'en';
  var rtl = nlIsRtl(lang);
  var translate = opts.translateHtml;
  var base = { t: t, c: c, lang: lang, rtl: rtl, start: rtl ? 'right' : 'left', pStyle: pStyle };
  var ctx = {
    c: c, t: t, resolve: resolve, pStyle: pStyle, rtl: rtl, start: base.start,
    // Renders a named template with the shared values plus block data.
    render: function (name, data) { return api.tpl(layout.templates[name], Object.assign({}, base, data)); },
    // Translate an HTML fragment; skip calls for fragments with no words.
    tx: function (html) {
      return translate && /[^\s ]/.test(nlPlain_(html).replace(/&nbsp;/g, '')) ? translate(html) : html;
    },
    txText: function (text) { return translate && text ? nlPlain_(ctx.tx(nlEsc_(text))) : text; }
  };

  var rows = [nlHeaderRow_(model, ctx), ctx.render('cardTop', {})];
  nlGroupBlocks_(model.blocks, c).forEach(function (g) { rows.push(nlRenderGroup_(g, ctx)); });
  rows.push(ctx.render('cardBottom', {}), nlFooterRow_(ctx));

  var languages = (opts.languages || []).map(function (l, i) {
    return { code: l.code, name: nlLanguageName(l.code), url: nlSafeUrl_(l.url), rtl: nlIsRtl(l.code),
      current: l.code === lang || !l.url, first: i === 0 };
  });
  var view = nlSafeUrl_(opts.viewInBrowserUrl);

  return ctx.render('document', {
    title: model.title || opts.subject || '',
    preheader: c.preheader || [model.title, model.subtitle].filter(Boolean).join(' '),
    preheaderPad: new Array(60).join('&zwnj;&nbsp;'),
    css: api.tpl(layout.templates.css, base),
    bgStyle: c.backgroundImageUrl
      ? 'background:' + c.pageBackground + " url('" + c.backgroundImageUrl + "') top center / 100% auto no-repeat;"
      : 'background:' + c.pageBackground + ';',
    topBar: view || languages.length ? ctx.render('topBar', { view: view, hasLanguages: languages.length > 0, languages: languages }) : '',
    notice: opts.originalUrl ? ctx.render('notice', {
      text: ctx.tx(nlEsc_('Machine-translated by Google Translate. Names, dates and amounts may be wrong; check the original.')),
      linkText: ctx.tx(nlEsc_('Read the original (English)')),
      originalUrl: nlSafeUrl_(opts.originalUrl)
    }) : '',
    rows: rows.filter(Boolean).join('\n'),
    footerNote: c.footerNote
  });
}

/** Tag-stripped, entity-decoded text (for attributes and word checks). */
function nlPlain_(html) {
  return String(html || '').replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function nlHeaderRow_(model, ctx) {
  if (model.banner) {
    return ctx.render('bannerImage', { src: ctx.resolve(model.banner), alt: ctx.txText(model.banner.alt || model.title) });
  }
  if (!model.title && !model.subtitle) return '';
  return ctx.render('header', {
    title: model.title ? ctx.tx(nlEsc_(model.title)) : '',
    subtitle: model.subtitle ? ctx.tx(nlEsc_(model.subtitle)) : ''
  });
}

function nlFooterRow_(ctx) {
  var c = ctx.c;
  if (!c.footerName && !c.footerTagline) return '';
  return ctx.render('footer', { name: c.footerName, tagline: c.footerTagline, logoUrl: nlSafeUrl_(c.footerLogoUrl) });
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
  switch (g.type) {
    case 'heading': return nlHeadingRow_(g, ctx);
    case 'rich': return ctx.render('rich', { html: ctx.tx(nlRenderRich_(g.blocks, ctx)) });
    case 'divider': return ctx.render('divider', {});
    case 'image': return nlImageRow_(g, ctx);
    case 'attachment': return nlAttachmentRow_(g, ctx);
    case 'table': return ctx.render('table', { html: nlRenderTable_(g, ctx) });
    default: return '';
  }
}

function nlHeadingRow_(h, ctx) {
  var t = ctx.t;
  return ctx.render('heading', {
    level: h.level,
    tag: h.level === 1 ? 'h2' : h.level === 2 ? 'h3' : 'h4',
    isH1: h.level === 1,
    size: h.level === 1 ? t.h1Size : h.level === 2 ? t.h2Size : t.h3Size,
    padding: h.level === 1 ? t.h1Padding : t.headingPadding,
    align: h.align && h.align !== 'justify' ? h.align : ctx.c.headingAlign,
    html: ctx.tx(nlRenderRuns_(h.runs, ctx))
  });
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
  var t = ctx.t;
  var indent = ctx.rtl ? '0 ' + t.listIndent + ' 0 0' : '0 0 0 ' + t.listIndent;
  function render(nodes) {
    if (!nodes.length) return '';
    var first = nodes[0].item;
    var tag = first.ordered ? 'ol' : 'ul';
    var start = first.ordered && first.number > 1 ? ' start="' + first.number + '"' : '';
    return '<' + tag + start + ' style="margin:0;padding:' + indent + ';list-style-type:' + first.listStyle + ';font-family:' +
      ctx.c.bodyFont + ';font-size:' + t.bodySize + 'px;line-height:' + t.lineHeight + ';color:' + ctx.c.textColor + ';">' +
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
  var width = ctx.t.width;
  var data = { src: src, alt: ctx.txText(img.alt), href: nlSafeUrl_(img.link) };
  if (!img.widthPt || img.widthPt >= NL_DOC_CONTENT_WIDTH_PT * 0.85) return ctx.render('image', data);
  data.width = Math.min(width - 40, Math.round(img.widthPt * width / NL_DOC_CONTENT_WIDTH_PT));
  data.height = img.heightPt ? Math.round(img.heightPt * data.width / img.widthPt) : 0;
  data.align = img.align === 'right' ? 'right' : img.align === '' ? ctx.start : img.align === 'justify' ? 'center' : img.align;
  return ctx.render('imageSized', data);
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
  var kind = nlFileKind_(att);
  return ctx.render('attachment', {
    href: nlSafeUrl_(att.url),
    kind: kind,
    kindSize: kind.length > 4 ? 9 : 11,
    title: ctx.tx(nlEsc_(att.title)),
    action: ctx.tx(/^(DOC|SHEET|SLIDES|FORM)$/.test(kind) ? 'Open' : 'Download'),
    size: nlFormatSize_(att.size)
  });
}

function nlRenderTable_(table, ctx) {
  var t = ctx.t;
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' +
    table.rows.map(function (row) {
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
        return '<td class="nl-rich" valign="top" style="border:1px solid ' + t.tableBorder + ';padding:' + t.tableCellPadding +
          ';text-align:' + ctx.start + ';' + bg + '">' + (inner ? ctx.tx(inner) : '&nbsp;') + '</td>';
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
