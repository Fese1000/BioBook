# Contributing to BioBook

Thank you for your interest in BioBook, a local electronic lab notebook for macOS. Bug reports, ideas, documentation fixes, translations and pull requests are all welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** using the [bug report form](https://github.com/Fese1000/BioBook/issues/new?template=bug_report.md). Please include the BioBook version (*BioBook › Settings*), your macOS version and the steps to reproduce.
- **Suggest a feature** using the [feature request form](https://github.com/Fese1000/BioBook/issues/new?template=feature_request.md). Describe the problem you want to solve at the bench, not only the solution.
- **Improve the English texts or add a language.** German is the source language, English comes from `web/lang/en.json`. See [Translations](#translations) below.
- **Improve documentation**, add test cases or fixtures with a clear origin.
- **Security problems** must not be filed as public issues, see [SECURITY.md](SECURITY.md).

Please **never attach real lab data, notebooks, signing keys or API keys** to an issue. If you need to share a log, remove anything that identifies people, samples or projects. The app writes a log to `~/Library/Logs/BioBook/app.log`; it does not contain entry contents, but check it before posting.

## Development setup

Requirements: macOS 13 or later on Apple Silicon, Xcode Command Line Tools, and Node.js (only for the JavaScript tests and for re-bundling the editor).

```bash
git clone https://github.com/Fese1000/BioBook.git
cd BioBook
./make-app.sh arm64 --no-dmg        # builds build/AppleSilicon/BioBook.app
node --test tests/*.test.js         # JavaScript tests
```

The Swift storage tests and the end-to-end self-test are described in the [README](README.md#tests). The self-test runs the real WebView with temporary data and a key file.

### Rules that protect users' data

- **Tests must never touch the real Keychain, preferences or notebooks.** Use the `BIOBOOK_BOOK`, `BIOBOOK_KEYFILE`, `BIOBOOK_BACKUPDIR` and `BIOBOOK_TESTOUT` environment variables as the existing tests do.
- **Do not rename or change the persisted format identifiers** `laborbuch-signatur-v1` (signed payload) and `laborbuch-export-1` (export format). Changing them would invalidate existing signatures and exports.
- Database changes need a migration with a version bump in `Store.swift`; older notebooks are upgraded automatically and a backup copy is made first. Notebooks from a newer app version must never be modified.
- Finished (signed) entries and immutable bookings (inventory, cell culture, equipment log) must stay immutable.
- The app must not contact the network unless the user asks for it. The only exception is the update check, which users can switch off.

### Code style

- Follow the style of the surrounding code: comment density, naming and idioms. Existing comments are mostly German; new comments may be German or English.
- JavaScript uses plain global scripts without a build step (except the bundled editor). Before adding a global name, search `web/*.js` for collisions.
- Keep pure calculation code free of UI and cover it with `node --test` tests against a trusted reference (a textbook value, Primer3, SciPy, Biopython, a database record).
- User-facing texts in the code are German (the source language). Every new text needs an English entry in `web/lang/en.json`, see [Translations](#translations).

## Translations

The interface is German in the code and translated at runtime from a dictionary, so no source text has to change.

- `web/lang/en.json` maps German text to English text. Parts that change at runtime are written as `{0}`, `{1}` … (for example `"{0} Einträge": "{0} entries"`); the placeholders must appear on both sides. The same file serves the web interface (`web/i18n.js`) and the native menus and dialogs (`app/Localization.swift`).
- `python3 tools/i18n-extract.py --missing out.json` lists German texts in `web/*.js` and `web/index.html` that have no entry yet. `python3 tools/i18n-merge.py part.json` merges new entries and checks the placeholders.
- **Coverage check:** run the self-test with `BIOBOOK_I18N_SHADOW=1 BIOBOOK_LANG=de` (plus the other `BIOBOOK_*` variables from the README). The interface stays German, but the output ends with a list of every rendered text that has no English entry. Many entries in that list are test data or words that are identical in both languages.
- Texts that never appear on screen (export files, file names) must be passed through `T(...)` in the code; the dictionary applies to them as well.
- `node --test tests/*.test.js` checks the dictionary (valid JSON, matching placeholders) and the translation layer.
- Another language would need its own dictionary file and a switch in `Lang.code` and `web/i18n.js`; please open an issue first.

## Pull requests

1. Open an issue first for larger changes, so we can agree on the approach.
2. Create a branch from `main` and keep the change focused.
3. Add or update tests. All of the following should pass: the Swift tests, `node --test tests/*.test.js` and the self-test.
4. Update the [README](README.md) if behaviour changes.
5. Describe what you changed and why in the pull request, and how you tested it.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
