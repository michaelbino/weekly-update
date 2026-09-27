// Template override: a left-aligned masthead with the date in a slim strip, and
// left-aligned section headings with an accent rule under the name.
// Try it:  node cli/newsletter.mjs preview --theme examples/themes/masthead-left.js --watch
var NEWSLETTER_THEME = {
  tokens: {
    h1Size: 24
  },
  templates: {
    header:
      '<tr><td bgcolor="{{c.accentColor}}" style="background:{{c.accentColor}};border-radius:{{t.cardRadius}} {{t.cardRadius}} 0 0;padding:28px 28px 22px 28px;text-align:left;">\n' +
      '  {{#title}}<h1 class="nl-banner-title" style="margin:0;font-family:{{c.headingFont}};font-size:40px;line-height:1.1;font-weight:bold;color:{{c.accentTextColor}};">{{{title}}}</h1>{{/title}}\n' +
      '  <div style="width:64px;height:4px;background:{{c.accentTextColor}};margin-top:14px;font-size:1px;line-height:1px;">&nbsp;</div>\n' +
      '</td></tr>\n' +
      '{{#subtitle}}<tr><td style="background:#2b2b2b;padding:8px 28px;font-family:{{c.bodyFont}};font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;text-align:left;">{{{subtitle}}}</td></tr>{{/subtitle}}',
    heading:
      '<tr><td class="nl-box" align="left" valign="top" style="padding:{{padding}};">\n' +
      '  <{{tag}}{{#isH1}} class="nl-h1"{{/isH1}} style="margin:0;font-family:{{c.headingFont}};font-size:{{size}}px;line-height:{{t.headingLineHeight}};font-weight:bold;color:{{c.textColor}};text-align:left;">{{{html}}}</{{tag}}>\n' +
      '  {{#isH1}}<div style="width:40px;height:3px;background:{{c.accentColor}};margin-top:8px;font-size:1px;line-height:1px;">&nbsp;</div>{{/isH1}}\n' +
      '</td></tr>'
  }
};
if (typeof module !== 'undefined') module.exports = { NEWSLETTER_THEME: NEWSLETTER_THEME };
