# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

**English** | [简体中文](README.zh-CN.md)

Find published versions and repair metadata in the original Zotero item.

## Install and use

Requires Zotero 10. Download the XPI from [Releases](https://github.com/lzcn/zotero-metadata-fixer/releases/latest) and install it through **Tools → Plugins → Install Plugin From File**.

Select items, right-click and choose **Metadata Fixer**. The results window shows metadata and PDF outcomes separately. Hover for details, or click a row to select its item. Cancel or close the window to stop pending work.

The plugin finds published versions, fills missing DOIs and fields, repairs record types, standardizes proceedings titles and optionally updates PDFs. Updates preserve annotations, notes, collections, tags and relations. Superseded unannotated main PDFs are moved to Trash after a successful replacement. Editing an item during retrieval stops its update. Empty results preserve existing fields.

## Settings

- Choose original, standard or short proceedings titles.
- Show publication abbreviations in Zotero's native column. Disable Zotero Style's Publication Column to avoid conflicts.
- PDF updates are on by default: skip items with annotated PDFs. Otherwise keep the latest version, preferring the published version over arXiv. Publisher access is required.

Lookup uses Zotero translators and scholarly metadata services. Conflicting or unverified matches are skipped. Run updates manually. Install plugin updates from XPI.

## Update flow

Identifiers and official publication links come first. Existing DOIs use Zotero translators, with DOI content negotiation and single-record Crossref/OpenAlex/DataCite enrichment as fallbacks. Title search runs only without a formal DOI. Title searches expand from Crossref/OpenAlex to DBLP/OpenReview and then secondary sources only when needed. Reliable matches stop further searches. Conflicting candidates stop automatic updates. Requests share caching, pacing and cooldowns across batches. Blocked sources are paused.

DOI-free lookup uses the item's URL first, then title/author matches from scholarly indexes. Candidate HTTP(S) pages and single-record BibTeX are retrieved with Zotero translators and checked against the item's title, authors, publication type, venue and publication status. This applies to conferences and journals without requiring their names or publisher domains in a catalog. OpenAlex publisher links and PubMed records are retained without a DOI. Conflicting or unverifiable matches leave the item unchanged. Missing DOIs and other unavailable fields stay blank.

Automatic publication upgrades require a completed identifier lookup, an accepted venue record, an official proceedings page or explicit publication evidence from an index. Citation tags or an author-provided BibTeX alone do not prove publication. Author checks compare given names or initials and corroborate multiple authors when both lists provide them. A shared surname alone cannot override conflicting given names. Evidence markers are temporary and are never saved to the library.

Conference-site integrations provide additional discovery routes. NeurIPS (NIPS), ICML and ICLR hints can locate official paper lists. OpenReview submissions and main-conference/workshop identities are checked separately. Requests stop after a verified match, with equivalent public records tried when another source is inaccessible.

```mermaid
flowchart LR
  A[Selected item] --> B[Identify publication]
  B --> C[Validate and repair original item]
  C --> D{PDF updates enabled and no annotations?}
  D -->|arXiv| E[Compare actual PDF version with arXiv]
  D -->|Published| F[Check publisher PDF validators and hash]
  E --> G[Replace old main PDF after validation]
  F --> G
```

arXiv versions come from the attached PDF's first page or a hash-verified download cache, not the item's metadata. Unknown local versions are checked by downloading and comparing file hashes. Published PDF checks retain conditional requests and file deduplication. Annotated PDFs stop PDF updates without stopping metadata repairs. Validated newer PDFs replace old main files, including arXiv manuscripts when a formal publication is found. The original item ID and supplementary files are preserved.

The results window uses a fixed Bear-inspired palette with a compact table and system fonts. Colors follow the system’s light or dark appearance. Settings use Zotero’s native controls.

## Development

Use Node.js 22.13+ (22.x) or 24+.

```sh
npm ci
npm run check
npm run build
```

Output: `dist/zotero-metadata-fixer.xpi`. `npm run test:host` uses disposable Zotero directories. `npm run release` prepares local files under `release/v<version>/` without uploading.

## Acknowledgments

Thanks to [Federico Torrielli and contributors](https://github.com/federicotorrielli/zotero-metadata-hunter) (Metadata Hunter), [AllanChain and contributors](https://github.com/AllanChain/zotero-arxiv-workflow) (arXiv Workflow), [northword and contributors](https://github.com/northword/zotero-format-metadata) (Linter for Zotero), and the [Zotero translators contributors](https://github.com/zotero/translators).

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Code developed with ChatGPT and DeepSeek.
