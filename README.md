# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

Most code was generated with ChatGPT and DeepSeek.

**English** | [简体中文](README.zh-CN.md)

Find published versions, add missing DOIs and fix metadata without replacing your Zotero items.

## Install

Requires Zotero 10. Install the XPI via **Tools → Plugins → Install Plugin From File**. Select items and choose **Metadata Fixer** from the context menu.

Confirmed Zotero quit cancels pending retrieval and queued updates, clears timers and releases plugin UI without waiting for a remote response.

## What it does

- Finds the published version of preprints and repository records.
- Adds missing DOIs when a match is reliable.
- Fills missing fields and corrects clear errors.
- Repairs mislabeled arXiv and conference records.
- Standardizes proceedings titles: Original, Standard or Short.
- Checks for an updated published PDF.

Updates keep the original item, attachments, annotations, notes, collections, tags and relations. Empty results never erase existing fields. Editing an item during retrieval stops that item's update.

## Results window

- Items update in place; progress and results stay visible.
- Click a row to select the item in Zotero.
- Click a column header to sort; sorting does not change processing order.
- The Problem column shows a short reason; hover for details.
- Cancel or close the window to stop pending work.

## Settings

- **Proceedings titles**: Original, Standard or Short.
- **Abbreviate Publication column**: show abbreviations in Zotero's native column. Turn off Zotero Style's Publication Column to avoid conflicts.
- **Check for updated PDFs**: replace unannotated main PDFs; keep annotated ones.
- **Semantic Scholar API key**: optional. Apply at [semanticscholar.org](https://www.semanticscholar.org/product/api#api-key-form). The key is stored locally and sent only to `api.semanticscholar.org`.

## Lookup behavior

- Sources: Zotero translators, Crossref, OpenAlex, DBLP (official SPARQL fallback), OpenReview, PubMed, Semantic Scholar and Google Scholar.
- Identifiers and publication links come first; title search is a fallback.
- A failed source does not stop the others. Conflicting or unverified records are skipped.
- Requests are paced; rate-limited sources cool down.

## Limitations

- No automatic scanning, scheduled updates, title capitalization or tag management.
- PDF checks need a verified article page and publisher access.
- Install updates manually using the XPI.

## Development

Use Node.js 22.13+ (22.x) or 24+.

- `npm ci`, then `npm run check`
- `npm run build`; run `make` in the workspace root to build all three plugins
- `npm run build:force`, `npm run clean`, `npm run release`

`npm run test:host` uses temporary profiles. Live retrieval still needs a test library. Shared working rules live in the workspace root `AGENTS.md`.

## License

[AGPL-3.0-or-later](LICENSE). References and third-party licenses are in `THIRD-PARTY-NOTICES`.
