# Security Policy

## Supported versions

Only the latest release of BioBook receives security fixes. Please update first (*Settings › Check for updates*) and check whether the problem still occurs.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Use GitHub's private reporting instead:

1. Go to the [Security tab](https://github.com/Fese1000/BioBook/security) of this repository.
2. Choose *Report a vulnerability* and describe the problem.

Please include the BioBook version, your macOS version, the steps to reproduce and the impact you see. Never include real lab data, notebooks or keys; a minimal example notebook is enough.

You can expect an acknowledgement within a week. BioBook is maintained by one person in their free time, so fixes may take a while. We will keep you informed and credit you in the release notes if you wish.

## What matters most

BioBook stores notebooks locally and handles signing keys, so we are especially interested in reports about:

- ways to alter or forge a signed entry, a revision or the hash chain without detection;
- exposure or misuse of the signing key or the Anthropic API key in the macOS Keychain;
- code execution or data access from imported content (`.eln` archives, HTML, Markdown, Word, PDFs) or from extensions, which are meant to run sandboxed without network or file access;
- the update mechanism (downloading, verification and replacing the app);
- URL scheme and AppleScript actions that change data without confirmation;
- any unexpected network traffic.

## Out of scope

- Signatures and timestamps are evidence, not a certification under GLP or 21 CFR Part 11.
- The app is ad-hoc signed and not notarised, so macOS shows a warning on first launch. That is known.
- Attacks that need full access to the user's unlocked Mac account or to the notebook files are out of scope, because the notebook is not encrypted at rest. Use macOS disk encryption (FileVault) for that.
