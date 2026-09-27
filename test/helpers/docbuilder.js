// Builds minimal Google Docs API documents.get JSON for unit tests.
function run(text, style) {
  return { textRun: { content: text, textStyle: style || {} } };
}

function para(elements, opts) {
  opts = opts || {};
  const p = {
    elements: (Array.isArray(elements) ? elements : [elements]).map((e) => (typeof e === 'string' ? run(e) : e)),
    paragraphStyle: { namedStyleType: opts.style || 'NORMAL_TEXT' },
  };
  if (opts.align) p.paragraphStyle.alignment = opts.align;
  if (opts.list) p.bullet = { listId: opts.list, nestingLevel: opts.level || 0 };
  // Every Docs paragraph ends with a newline.
  const last = p.elements[p.elements.length - 1];
  if (last.textRun && !last.textRun.content.endsWith('\n')) last.textRun.content += '\n';
  else if (!last.textRun) p.elements.push(run('\n'));
  return { paragraph: p };
}

function image(id) {
  return { inlineObjectElement: { inlineObjectId: id, textStyle: {} } };
}

function doc(content, extras) {
  extras = extras || {};
  return {
    documentId: 'doc123',
    title: 'Test',
    body: { content: [{ sectionBreak: {} }, ...content] },
    lists: extras.lists || {},
    inlineObjects: extras.inlineObjects || {},
  };
}

function inlineImage(uri, widthPt, alt) {
  return {
    inlineObjectProperties: {
      embeddedObject: {
        description: alt || '',
        imageProperties: { contentUri: uri },
        size: { width: { magnitude: widthPt, unit: 'PT' }, height: { magnitude: widthPt / 2, unit: 'PT' } },
      },
    },
  };
}

const bulletList = { listProperties: { nestingLevels: [{ glyphSymbol: '●' }, { glyphSymbol: '○' }] } };
const numberList = { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }, { glyphType: 'ALPHA' }] } };

module.exports = { run, para, image, doc, inlineImage, bulletList, numberList };
