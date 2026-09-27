// Extension point: a links row just above the footer band (cardBottom), plus extra CSS.
// Replace the URLs with your school's pages.
// Try it:  node cli/newsletter.mjs preview --theme examples/themes/social-footer.js --watch
var NEWSLETTER_THEME = {
  templates: {
    cardBottom:
      '<tr><td class="nl-box" align="center" style="padding:6px 20px 26px 20px;">\n' +
      '  <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>\n' +
      '    <td class="nl-pill"><a href="https://www.example.org" style="color:{{c.accentColor}};">Website</a></td>\n' +
      '    <td class="nl-pill"><a href="https://www.example.org/calendar" style="color:{{c.accentColor}};">Calendar</a></td>\n' +
      '    <td class="nl-pill"><a href="https://www.example.org/menus" style="color:{{c.accentColor}};">Lunch menus</a></td>\n' +
      '  </tr></table>\n' +
      '</td></tr>'
  },
  css: '.nl-pill{padding:0 6px}' +
    '.nl-pill a{display:inline-block;padding:8px 14px;border:1.5px solid currentColor;border-radius:999px;' +
    'font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none}'
};
if (typeof module !== 'undefined') module.exports = { NEWSLETTER_THEME: NEWSLETTER_THEME };
