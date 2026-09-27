/**
 * Your layout overrides. Anything set here is merged over the defaults in
 * Layout.js; everything else keeps its default. Guide: docs/THEMING.md
 *
 *   tokens     sizes, spacing, radii, borders (full list in Layout.js)
 *   templates  replace a block's HTML (header, heading, rich, divider, image,
 *              imageSized, attachment, table, footer, topBar, notice,
 *              bannerImage, document, css, cardTop, cardBottom)
 *   css        extra CSS appended to the <style> block
 *
 * Colours, fonts, footer text and translation languages live in Config.js and
 * Newsletter > Settings; use {{c.accentColor}} etc. in templates to reuse them.
 *
 * Workflow: edit -> `npm run preview` (live reload of out/newsletter.html) ->
 * `npm run check-theme` -> `scripts/deploy-script.zsh`. New issues copied from
 * the template pick the theme up; existing copies keep theirs.
 */
var NEWSLETTER_THEME = {
  tokens: {
    // Examples - uncomment to try:
    // h1Size: 28,
    // cardRadius: '12px',
    // dividerStyle: 'dotted',
    // dividerWidth: '3px',
    // bannerPadding: '40px 24px 32px 24px',
  },

  templates: {
    // Example: a social-links row above the footer.
    // cardBottom:
    //   '<tr><td align="center" style="padding:8px 20px 24px 20px;font-family:{{c.bodyFont}};font-size:14px;">\n' +
    //   '  <a href="https://www.ltps.org" style="color:{{c.linkColor}};">Website</a> &middot;\n' +
    //   '  <a href="https://www.facebook.com/" style="color:{{c.linkColor}};">Facebook</a>\n' +
    //   '</td></tr>',
  },

  css: ''
};

if (typeof module !== 'undefined') module.exports = { NEWSLETTER_THEME: NEWSLETTER_THEME };
