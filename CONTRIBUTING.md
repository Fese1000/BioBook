# Contributing to BioBook

Thank you for your interest in BioBook, a local electronic lab notebook for macOS. Bug reports, ideas, documentation fixes, translations and pull requests are all welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** using the [bug report form](https://github.com/Fese1000/BioBook/issues/new?template=bug_report.md). Please include the BioBook version (*BioBook › Settings*), your macOS version and the steps to reproduce.
- **Suggest a feature** using the [feature request form](https://github.com/Fese1000/BioBook/issues/new?template=feature_request.md). Describe the problem you want to solve at the bench, not only the solution.
- **Translate the interface.** The user interface is currently German only. An English interface is the most wanted contribution. Please open an issue first so we can agree on how strings are extracted.
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
- User-facing texts are German for now.

## Pull requests

1. Open an issue first for larger changes, so we can agree on the approach.
2. Create a branch from `main` and keep the change focused.
3. Add or update tests. All of the following should pass: the Swift tests, `node --test tests/*.test.js` and the self-test.
4. Update the [README](README.md) if behaviour changes.
5. Describe what you changed and why in the pull request, and how you tested it.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
