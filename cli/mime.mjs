// Minimal RFC 5322/2045 message builder: text + HTML alternative, optional CID images.
import crypto from 'node:crypto';

const CRLF = '\r\n';

export function encodeHeader(value) {
  const s = String(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function b64(data) {
  const s = Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(String(data), 'utf8').toString('base64');
  return s.replace(/.{1,76}/g, (m) => m + CRLF).trimEnd();
}

function boundary(tag) {
  return `=_${tag}_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * @param {{from?:string,to:string,replyTo?:string,subject:string,text:string,html:string,
 *          inline?:{cid:string,contentType:string,data:Buffer,filename?:string}[]}} m
 * @returns {string} full message with CRLF line endings
 */
export function buildMime(m) {
  const inline = m.inline || [];
  const alt = boundary('alt');
  const headers = [];
  if (m.from) headers.push(`From: ${encodeHeader(m.from)}`);
  headers.push(`To: ${m.to}`);
  if (m.replyTo) headers.push(`Reply-To: ${m.replyTo}`);
  headers.push(`Subject: ${encodeHeader(m.subject)}`);
  headers.push(`Date: ${new Date().toUTCString().replace('GMT', '+0000')}`);
  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: multipart/alternative; boundary="${alt}"`);

  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(m.text),
  ].join(CRLF);

  const htmlOnly = [
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(m.html),
  ].join(CRLF);

  let htmlPart = htmlOnly;
  if (inline.length) {
    const rel = boundary('rel');
    const parts = [htmlOnly, ...inline.map((img) => [
      `Content-Type: ${img.contentType}; name="${img.filename || img.cid}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.filename || img.cid}"`,
      '',
      b64(img.data),
    ].join(CRLF))];
    htmlPart = [
      `Content-Type: multipart/related; boundary="${rel}"`,
      '',
      ...parts.map((p) => `--${rel}${CRLF}${p}`),
      `--${rel}--`,
    ].join(CRLF);
  }

  return [
    headers.join(CRLF),
    '',
    `--${alt}`,
    textPart,
    `--${alt}`,
    htmlPart,
    `--${alt}--`,
    '',
  ].join(CRLF);
}
