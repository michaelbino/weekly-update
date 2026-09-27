// Tokens only: softer card, tighter header, dotted dividers, slightly larger body text.
// Try it:  node cli/newsletter.mjs preview --theme examples/themes/rounded.js --watch
// Use it:  copy the `tokens` block into apps-script/Theme.js
var NEWSLETTER_THEME = {
  tokens: {
    cardRadius: '16px',
    cardBorder: '1px solid #e2ddd5',
    pagePadding: '32px 12px 32px 12px',
    bannerPadding: '36px 24px 30px 24px',
    bannerTitleSize: 44,
    subtitleSpacing: '0.14em',
    h1Size: 24,
    bodySize: 16,
    lineHeight: 1.6,
    dividerStyle: 'dotted',
    dividerWidth: '3px',
    attachmentRadius: '12px'
  }
};
if (typeof module !== 'undefined') module.exports = { NEWSLETTER_THEME: NEWSLETTER_THEME };
