# Weekly Update newsletter

**Project page with screenshots:** https://michaelbino.github.io/weekly-update/

Write the weekly newsletter in a Google Doc. Send yourself a responsive HTML email that matches `example.eml`: coloured header band, centred section headings, red dividers, full-width flyers, download cards and a footer band. The email's **View in browser** link opens a public web page that looks exactly like the email.

```
Google Doc (issue copy) ──Newsletter menu──▶ Apps Script (bound to the Doc)
                                               ├─ Docs API → content model → email HTML + plain text
                                               ├─ Doc images → public "Newsletter images" Drive folder
                                               ├─ HTML snapshot → private "Newsletter web" Drive folder
                                               └─ MailApp → your inbox for final review

"View in browser" ──▶ web app (template script, deployed once) ──▶ serves ?issue=<snapshot> from that folder only
```

## Editor workflow

1. Open the template Doc. Choose **Newsletter › Start next issue**. This copies the Doc, names it `Weekly Update - Week of M/D` and updates the date line.
2. Edit the copy. The file name is the email subject.
3. Choose **Newsletter › Publish web version** (once per issue). This saves the rendered email as the issue's public web page, which is where "View in browser" goes. After that, every **Send preview** refreshes the page. The link stays the same, and older issues keep their own pages.
4. Choose **Newsletter › Preview** to see desktop and phone widths, or **Send preview to me**. Read it on your phone, fix things in the Doc, and send again.
5. When you're happy, send it to families. Forward it, or use **Preview › Copy HTML** to paste it into your mass-mail tool (Finalsite, etc.).

Each copy carries its own copy of the script, so Google asks for authorization the first time you use the menu in a new issue.

### How the Doc maps to the email

| In the Doc | In the email |
|---|---|
| **Title** style | Newsletter name in the header band |
| **Subtitle** style | Date line under it |
| Image placed *above* the Title | Replaces the text header with your own banner (1400×560) |
| **Heading 1** | Section heading; a divider is drawn above it automatically |
| Heading 2 / 3 | Smaller headings inside a section |
| Shift+Enter inside a heading | Line break within the same heading |
| Normal text | Bold, italic, underline, colour, links, alignment, bulleted and numbered lists |
| Blank line | Spacing |
| Image | Full-width if it spans the page; otherwise it keeps its size. Alt text carries over |
| Insert › Horizontal line | Extra divider |
| A line that is *only* a Drive file link or file chip | Download card showing the file type and size |
| Table | Simple bordered table |

### Translations

Once an issue's web version is published, each language in **Settings › Translation** (default: `es, zh-CN, ko, ht, ar`) gets a machine-translated copy of the web page. The email and each web page start with a 🌐 row (English · Español · 中文 · 한국어 · Kreyòl ayisyen · العربية) linking to them at `…/exec?issue=<id>&lang=es`. The email itself stays in the original language.

- It uses Apps Script's built-in `LanguageApp` (Google Translate): no API key, no Cloud project, no billing. HTML mode translates text and leaves tags, links and styles alone.
- It sends one call per section, not per paragraph. Results are cached by content for 6 hours, so resending a preview only re-translates what changed.
- Arabic, Farsi, Urdu, Hebrew and other right-to-left languages get right-to-left layout.
- Each translated page opens with a machine-translation notice and a "Read the original (English)" link. A missing or failed language falls back to the original page.
- Text inside images (flyers) is not translated, only alt text. Put key dates, times and costs in the Doc text too.
- Translation runs on Publish and each Send preview, so the first publish takes longer.

### Customizing the layout

Beyond the Settings sidebar, maintainers can restyle and restructure the email in `apps-script/Theme.js`:
- **Design tokens** set sizes, spacing, radii, borders, divider style and the phone breakpoint.
- **Block templates** replace the HTML of the header band, headings, dividers, images, download cards, footer or top bar.
- **Extension points** add rows (`cardTop` / `cardBottom`), and extra CSS can go in the theme too.

`npm run preview` live-reloads the result, and `npm run check-theme` catches typos. In the browser, **Newsletter › Preview** shows your theme after each save, and running `checkTheme` in the Apps Script editor validates it ([details](docs/WEB-SETUP.md#5-theme-in-the-browser)). There are three ready-made examples in `examples/themes/`. The full guide, with every token and template, is **[docs/THEMING.md](docs/THEMING.md)**.

**Newsletter › Settings…** changes the sender name, reply-to, subject override, preview text, colours, background photo, footer and small print. Settings are saved to `Newsletter settings.json` next to the Doc, so every issue in that folder shares them. Brand defaults live in `apps-script/Config.js`.

## Setup (maintainer)

**Prefer Google's web interfaces?** Everything below can be done in Drive, Docs and the Apps Script editor, with no command-line tools. See **[docs/WEB-SETUP.md](docs/WEB-SETUP.md)** for the browser equivalent of each script.

Requirements: [mise](https://mise.jdx.dev) or Node 20, Docker, and [`gws`](https://github.com/googleworkspace/cli) authenticated with the Drive, Docs, Apps Script and Gmail scopes:

```zsh
gws auth login --scopes https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/script.projects,https://www.googleapis.com/auth/script.deployments,https://www.googleapis.com/auth/gmail.send
```

Turn on the Apps Script API at <https://script.google.com/home/usersettings>.

```zsh
scripts/create-template.zsh   # folder, seeded template Doc, placeholder PDF, bound script (resumable; IDs in .deploy.env)
scripts/deploy-script.zsh     # push apps-script/ to the template's script and (re)deploy the web app
scripts/teardown.zsh          # trash the template folder
scripts/test.zsh              # tests in Docker (falls back to docker-compose, then local Node)
```

Code pushed to the template doesn't reach issues that were already copied. New issues pick it up.

### Web version

`deploy-script.zsh` creates a private **Newsletter web** folder and deploys the template's script as a web app (`executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`). It also writes the web app URL and folder ID to `apps-script/Deployment.js`, which is generated and gitignored. Issues copied from the template inherit that file, so they all link to the same web app. `doGet` serves a file only if it's an HTML snapshot directly inside that folder. Any other ID, including the Doc's own, gets "not found".

- The web app runs as the person who deployed it, so that account must have authorized the template's script once (open the template and use any Newsletter menu item).
- On a personal gmail.com account, Google shows a small "created by a Google Apps Script user" banner above the page. Workspace accounts don't show it.
- If `Deployment.js` is missing (web app not deployed), **Publish web version** falls back to publishing the Doc itself to the web.
- Translated pages are saved next to each snapshot as `<snapshotId>.<lang>.html`. `doGet` accepts `lang` only as a language code and looks the file up inside the snapshot folder.

### CLI

`cli/newsletter.mjs` renders or sends any newsletter Doc from the terminal with `gws`. It uses the same engine as the Apps Script.

```zsh
node cli/newsletter.mjs render --doc <doc-url-or-id> --out out   # out/newsletter.html + .txt + model.json
node cli/newsletter.mjs send   --doc <doc-url-or-id> [--to you@example.com]   # images embedded inline
```

## Layout

```
apps-script/   Config.js (brand defaults), Theme.js (your layout overrides), Layout.js (layout framework: tokens,
               templates, engine), Newsletter.js (pure engine), Code.js (Docs/Drive/Mail glue),
               WebApp.js (web version: snapshots + doGet), Deployment.js (generated, gitignored),
               Preview/Settings/Help.html, appsscript.json
cli/           newsletter.mjs (render/send/seed), mime.mjs, seed.mjs, gws.mjs
template/      weekly-update.html (seed content from example.eml), placeholder-attachment.pdf
test/          node:test suites; fixtures are real Docs API responses of the template
docs/          GitHub Pages site (index.html + screenshots) and THEMING.md
examples/      example themes (rounded, masthead-left, social-footer)
```

`Newsletter.js` uses no Google services, so the tests load it directly in Node. They run `Code.js` in a VM with mocked `DocumentApp`, `DriveApp`, `MailApp` and the other services it calls.

## Notes

- Images are copied into a Drive folder named "Newsletter images", shared "anyone with the link", and named by content hash. This keeps them loading in forwards and the web version. If your domain blocks public sharing, the script embeds them in the message instead and tells you.
- The HTML uses tables and inline styles, an Outlook (MSO) wrapper, a hidden preheader, a 630px mobile breakpoint and a forced light colour scheme. It stays under Gmail's 102 KB clipping limit.
- The seed template's "here" links point to `https://www.ltps.org` because the originals were Smore tracking redirects. The two PDF cards point to a placeholder; replace them with the real files.
