// Turns the Drive-imported seed HTML into a proper template Doc:
// Title/Subtitle styles, real inline images and Drive file links.

function paraText(p) {
  return (p.elements || []).map((e) => (e.textRun ? e.textRun.content : '')).join('');
}

/**
 * Builds a Docs API batchUpdate request list.
 * @param {object} doc documents.get response of the imported seed Doc
 * @param {{attachmentUrl:string, imageWidthPt?:number}} opts
 */
export function buildSeedRequests(doc, { attachmentUrl, imageWidthPt = 468, listKinds = [] } = {}) {
  const content = (doc.body && doc.body.content) || [];
  const paras = content.filter((el) => el.paragraph);
  const styleReqs = [];
  const edits = [];

  const nonEmpty = paras.filter((el) => paraText(el.paragraph).trim());
  [['TITLE', nonEmpty[0]], ['SUBTITLE', nonEmpty[1]]].forEach(([style, el]) => {
    if (!el) return;
    styleReqs.push({
      updateParagraphStyle: {
        range: { startIndex: el.startIndex, endIndex: el.endIndex },
        paragraphStyle: { namedStyleType: style, alignment: 'CENTER' },
        fields: 'namedStyleType,alignment',
      },
    });
  });

  // Drive's HTML import drops list glyphs; re-apply bullet/number presets in document order.
  styleReqs.push(...buildListRequests(paras, listKinds));

  paras.forEach((el) => {
    const text = paraText(el.paragraph).trim();
    const img = /^\[\[image:([^|\]\s]+)(?:\|([^\]]*))?\]\]$/.exec(text);
    const file = /^\[\[file:([^\]]+)\]\]$/.exec(text);
    if (!img && !file) return;
    // Only replace the marker text: a horizontal rule may share the paragraph.
    const run = el.paragraph.elements.find((e) => e.textRun && e.textRun.content.includes('[['));
    const start = run.startIndex + run.textRun.content.indexOf('[[');
    const end = el.endIndex - 1; // keep the paragraph's newline
    const reqs = [{ deleteContentRange: { range: { startIndex: start, endIndex: end } } }];
    if (img) {
      reqs.push({
        insertInlineImage: {
          location: { index: start },
          uri: img[1],
          objectSize: { width: { magnitude: imageWidthPt, unit: 'PT' } },
        },
      });
      reqs.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: start + 1 },
          paragraphStyle: { alignment: 'CENTER' },
          fields: 'alignment',
        },
      });
    } else {
      const name = file[1].trim();
      reqs.push({ insertText: { location: { index: start }, text: name } });
      if (attachmentUrl) {
        reqs.push({
          updateTextStyle: {
            range: { startIndex: start, endIndex: start + name.length },
            textStyle: { link: { url: attachmentUrl } },
            fields: 'link',
          },
        });
      }
    }
    edits.push({ start, reqs });
  });

  // Apply edits bottom-up so earlier indexes stay valid; styles first (no index shifts).
  edits.sort((a, b) => b.start - a.start);
  return [...styleReqs, ...edits.flatMap((e) => e.reqs)];
}

/** listKinds: 'ul' | 'ol' per list, in document order (see listKindsFromHtml). */
export function buildListRequests(paras, listKinds) {
  const ranges = new Map();
  paras.forEach((el) => {
    const b = el.paragraph.bullet;
    if (!b) return;
    const r = ranges.get(b.listId) || { startIndex: el.startIndex, endIndex: el.endIndex };
    r.endIndex = el.endIndex;
    ranges.set(b.listId, r);
  });
  return [...ranges.values()].flatMap((range, i) => (listKinds[i] ? [
    { deleteParagraphBullets: { range } },
    { createParagraphBullets: { range, bulletPreset: listKinds[i] === 'ol' ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE' } },
  ] : []));
}

export function listKindsFromHtml(html) {
  return [...html.matchAll(/<(ul|ol)\b/gi)].map((m) => m[1].toLowerCase());
}
