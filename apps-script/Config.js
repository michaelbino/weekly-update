/**
 * Brand defaults for the newsletter. These travel with every copy of the
 * template Doc (the bound script is copied along with it).
 *
 * Per-folder overrides can be saved from Newsletter > Settings… in the Doc;
 * those are stored in "Newsletter settings.json" next to the Doc so every
 * issue in the same folder shares them.
 */
var NEWSLETTER_CONFIG = {
  // Sender display name. Mail is always sent from the account running the script.
  senderName: 'LMS Nation',
  // Optional Reply-To address (e.g. a shared office mailbox).
  replyTo: '',
  // Subject line. Blank = use the Doc's file name, e.g. "Weekly Update - Week of 9/21".
  subject: '',
  // Hidden inbox preview text. Blank = "<Title> <Subtitle>".
  preheader: '',
  // Where "View in browser" points. Blank = the Doc's Publish-to-web link
  // (Newsletter > Publish web version), falling back to the Doc's share link.
  viewInBrowserUrl: '',
  // Comma-separated extra preview recipients. The person clicking "Send preview
  // to me" always receives it; these are only used by "Send preview to team".
  previewRecipients: '',

  // Translated web versions: comma-separated Google Translate codes (blank = off).
  // Each gets its own "View in browser" page and a link in the email's language row.
  translateLanguages: 'es, zh-CN, ko, ht, ar',
  sourceLanguage: 'en',

  // Colours
  accentColor: '#c73a3a',      // header band, dividers, footer band
  accentTextColor: '#fff4c2',  // text on the accent colour
  linkColor: '#1c6e98',
  textColor: '#111111',
  pageBackground: '#f8f8f8',
  // Optional seasonal photo behind the newsletter card (public https URL).
  backgroundImageUrl: '',

  // Typography (email-safe stacks only)
  headingFont: "Georgia, 'Times New Roman', Times, serif",
  bodyFont: 'Helvetica, Arial, sans-serif',
  headingAlign: 'center',

  // Automatically draw a divider before every Heading 1 (except the first).
  autoDividers: true,

  // Footer band
  footerName: 'LMS Nation',
  footerTagline: 'Lawrence Middle School',
  footerLogoUrl: '',
  // Small print under the card.
  footerNote: 'Lawrence Township Public Schools | 2565 Princeton Pike, Lawrenceville, NJ 08648 | 609-671-5500',

  // "drive" = copy Doc images to a public Drive folder so the email (and
  // forwards of it) can load them; "inline" = embed images in the message.
  imageHosting: 'drive',
  imageFolderName: 'Newsletter images'
};

if (typeof module !== 'undefined') module.exports = { NEWSLETTER_CONFIG: NEWSLETTER_CONFIG };
