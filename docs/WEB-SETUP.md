# Setting up and maintaining with a browser only

Everything the command-line scripts do can also be done in Google's web interfaces: Drive, Docs and the Apps Script editor. You don't need `gws`, Node, Docker or a terminal. This guide gives the browser equivalent of each task.

| Task | Command line | In the browser |
|---|---|---|
| Create the template | `scripts/create-template.zsh` | [1. Create the template Doc](#1-create-the-template-doc) and [2. Add the script](#2-add-the-script) |
| Turn on the email-look web version | `scripts/deploy-script.zsh` (first run) | [3. Deploy the web app](#3-deploy-the-web-app) |
| Push code or theme changes | `scripts/deploy-script.zsh` | [4. Update the code](#4-update-the-code) |
| Live theme preview | `npm run preview` | [5. Theme in the browser](#5-theme-in-the-browser) |
| Validate the theme | `npm run check-theme` | Run `checkTheme` in the Apps Script editor ([5](#5-theme-in-the-browser)) |
| Render or send a test | `node cli/newsletter.mjs render/send` | **Newsletter › Preview** (with **Copy HTML**) and **Send preview to me** |
| Run the test suite | `npm test` / `scripts/test.zsh` | GitHub Actions runs it on every commit, including edits made in GitHub's web editor ([6](#6-optional-let-github-check-your-changes)) |
| Remove everything | `scripts/teardown.zsh` | [7. Remove it](#7-remove-it) |

Get the code from the repository on GitHub. Open a file (for example `apps-script/Code.js`) and use **Copy raw file** (the copy icon above the code). Or download everything with **Code › Download ZIP**.

## 1. Create the template Doc

1. In [Google Drive](https://drive.google.com), choose **New › New folder** and name it `Weekly Update Newsletter`.
2. Pick one of these:
   - **Start blank (simplest):** in the folder, **New › Google Docs**. Type the newsletter name and set it to **Title** (the style menu that says "Normal text"). Type the date on the next line and set it to **Subtitle**. Start each section with **Heading 1**.
   - **Start from the sample issue:** download `template/weekly-update.html` from GitHub, then **New › File upload** it into the folder. Right-click the uploaded file and choose **Open with › Google Docs**, which creates a converted Doc (you can delete the `.html` file). Then tidy up what the command-line seeding would have done:
     - Set the first line to **Title** and the second to **Subtitle**.
     - Replace each `[[image:URL|…]]` line: delete the text, then **Insert › Image › By URL** and paste the URL. Drag the image to full width, and add a description with right-click › **Alt text**.
     - Replace each `[[file:NAME]]` line: upload the real PDF to the folder and share it **Anyone with the link**. Then type the file name on that line and link it (⌘K / Ctrl+K) to the file's link.
     - Where a numbered list shows as bullets, select it and choose **Format › Bullets & numbering › Numbered list**.
3. Name the Doc like `Weekly Update - Week of 9/21`. The file name becomes the email subject.

If someone shares a ready-made template with you, open it and choose **File › Make a copy** instead. The script comes with the copy, so you can skip to step 2's last part (authorizing).

## 2. Add the script

1. In the Doc, open **Extensions › Apps Script**. This creates a script attached to the Doc. Rename it (top left, "Untitled project") to `Weekly Update Newsletter`.
2. **Show the manifest:** click the gear (**Project Settings**) in the left bar and tick **Show "appsscript.json" manifest file in editor**.
3. **Add the files.** Use the **+** next to **Files**. **Script** files get `.gs` added automatically, and the editor starts with an empty `Code.gs` you can reuse. Paste each file's contents from `apps-script/` on GitHub:

   | Add as | Type | Paste from |
   |---|---|---|
   | `appsscript.json` | (already there) | `apps-script/appsscript.json`. Replace everything in it |
   | `Config` | Script | `apps-script/Config.js` |
   | `Layout` | Script | `apps-script/Layout.js` |
   | `Theme` | Script | `apps-script/Theme.js` |
   | `Newsletter` | Script | `apps-script/Newsletter.js` |
   | `WebApp` | Script | `apps-script/WebApp.js` |
   | `Code` | Script | `apps-script/Code.js` |
   | `Preview` | HTML | `apps-script/Preview.html` |
   | `Settings` | HTML | `apps-script/Settings.html` |
   | `Help` | HTML | `apps-script/Help.html` |
   | `LinkDialog` | HTML | `apps-script/LinkDialog.html` |

   The HTML files must have exactly these names, because the code opens them by name. Script file names and their order in the list don't matter.
4. Click **Save** (the disk icon, or ⌘S / Ctrl+S). The manifest turns on the Google Docs API and Drive API services. You should see them under **Services** in the left bar. If you don't, add them with **+** next to **Services**: **Google Docs API**, and **Drive API** version **v3**.
5. **Authorize.** Go back to the Doc and reload it. A **Newsletter** menu appears. Choose **Newsletter › Preview**, and Google asks for permission. Because this is your own unpublished script, you'll see "Google hasn't verified this app". Choose **Advanced › Go to Weekly Update Newsletter (unsafe)**, then **Allow**. This happens once per Doc.

You can already preview and send yourself test emails. Without step 3, **Publish web version** publishes the Doc itself (Google's Doc view) for the "View in browser" link.

## 3. Deploy the web app

The web app serves the email-look web version and its translated pages.

1. In Drive, open the `Weekly Update Newsletter` folder and create a folder inside it called `Newsletter web`. Open it and copy its ID from the address bar: the part after `/folders/`.
2. In the Apps Script editor, click **Deploy › New deployment**, then the gear next to **Select type** › **Web app**, and set:
   - **Description:** `Newsletter web version`
   - **Execute as:** **Me** (your address)
   - **Who has access:** **Anyone**

   Click **Deploy**, authorize if asked, and copy the **Web app URL**. It ends in `/exec`.
3. Add a Script file named `Deployment` containing, with your two values:

   ```js
   var NEWSLETTER_DEPLOYMENT = {
     webAppUrl: 'https://script.google.com/macros/s/…/exec',
     snapshotFolderId: 'your Newsletter web folder ID'
   };
   ```

   Save.
4. Make the web app run the code that includes this file: **Deploy › Manage deployments**, select the deployment, click the pencil (**Edit**), set **Version** to **New version**, and click **Deploy**. The URL stays the same.
5. In the Doc, choose **Newsletter › Publish web version**. The dialog's **Open web version** button should show the newsletter on its own page. On a personal gmail.com account, Google adds a small "created by a Google Apps Script user" banner on top.

Issues you start later with **Newsletter › Start next issue** copy the script, including `Deployment`, so they all use the same web app.

## 4. Update the code

When the project changes on GitHub (see the commit history), or you change settings in code:

1. Open the **template** Doc's **Extensions › Apps Script**.
2. For each file that changed, select all in the editor, paste the new contents, and **Save**. Keep your own `Config`, `Theme` and `Deployment` unless you mean to change them.
3. The **Newsletter** menu uses the saved code right away. Reload the Doc if the menu itself changed.
4. If `WebApp`, `Newsletter` or `Layout` changed, also give the web app the new code: **Deploy › Manage deployments › Edit (pencil) › Version: New version › Deploy**. Theme and content changes don't need this. Web pages are rendered when you publish or send a preview, so just publish or send again.

Issues copied before the update keep their old copy of the script. New issues from **Start next issue** get the update. To update an issue already in progress, paste the changed files into that issue's own **Extensions › Apps Script** too.

## 5. Theme in the browser

See [THEMING.md](THEMING.md) for what you can change. The browser loop:

1. In the Apps Script editor, open **Theme** and edit it. For example, uncomment `h1Size: 28,`. To start from an example, paste one from `examples/themes/` on GitHub over the contents of **Theme**. Save.
2. In the Doc, choose **Newsletter › Preview** and switch between **Desktop** and **Phone**. Each preview uses the theme you just saved; no reload needed.
3. Check for mistakes: in the editor, pick **checkTheme** in the function dropdown in the toolbar and click **Run**. The **Execution log** shows `Theme OK` or a list like `Unknown token "h1Szie". Did you mean "h1Size"?`. It also test-renders the Doc left-to-right and right-to-left. Theme problems also appear as yellow warnings in the Preview dialog and the send and publish messages.
4. When you're happy, publish or send a preview, so the web version and translations are re-rendered with the new theme.

The template syntax, tokens and email-safety rules are the same whichever way you edit. The command-line preview's placeholder images and `--lang ar` option have no browser equivalent. Preview a real issue instead, and check a right-to-left page by opening the Arabic link after publishing.

## 6. Optional: let GitHub check your changes

If you keep your theme in the GitHub repository, you can edit `apps-script/Theme.js` in GitHub's web editor: open the file and click the pencil. Committing runs the full test suite, including the theme check, under **Actions**. A green check means the theme is valid. Then paste it into the Apps Script editor as in step 4.

## 7. Remove it

1. **Stop the web version:** in the Apps Script editor, choose **Deploy › Manage deployments**, select the deployment, and click **Archive**. Links in old emails will stop working.
2. **Remove the files:** in Drive, right-click the `Weekly Update Newsletter` folder and choose **Move to trash**. Its Docs take their attached scripts with them. Issues saved elsewhere are unaffected.
3. The `Newsletter images` folder in My Drive holds the public copies of email images. Trash it too if no sent email needs its images any more.
