# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

**English** | [简体中文](README.zh-CN.md)

Find published versions and repair metadata in the original Zotero item.

## Install and use

Requires Zotero 10. Download the XPI from [Releases](https://github.com/lzcn/zotero-metadata-fixer/releases/latest) and install it through **Tools → Plugins → Install Plugin From File**.

Select items, right-click and choose **Metadata Fixer**. The results window shows progress and problems; click a row to select its item. Cancel or close the window to stop pending work.

The plugin finds published versions, fills missing DOIs and fields, repairs record types, standardizes proceedings titles and optionally updates PDFs. Updates preserve attachments, annotations, notes, collections, tags and relations. Editing an item during retrieval stops its update; empty results preserve existing fields.

## Settings

- Choose original, standard or short proceedings titles.
- Show publication abbreviations in Zotero's native column. Disable Zotero Style's Publication Column to avoid conflicts.
- Enable PDF updates to replace unannotated main PDFs while keeping annotated ones. Publisher access is required.
- Optionally add a [Semantic Scholar API key](https://www.semanticscholar.org/product/api#api-key-form), stored locally and sent only to `api.semanticscholar.org`.

Lookup uses Zotero translators and scholarly metadata services. Conflicting or unverified matches are skipped. Run updates manually; install plugin updates from XPI.

## Development

Use Node.js 22.13+ (22.x) or 24+.

```sh
npm ci
npm run check
npm run build
```

Output: `dist/zotero-metadata-fixer.xpi`. `npm run test:host` uses disposable Zotero directories. `npm run release` prepares local files under `release/v<version>/` without uploading.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Code developed with ChatGPT and DeepSeek.
