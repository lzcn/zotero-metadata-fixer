# Metadata Fixer

[中文](README.zh-CN.md)

Update preprints, fill missing metadata and fix errors in the original Zotero item. Requires Zotero 10; see `package.json` for the version.

## Install and use

Install `dist/zotero-metadata-fixer.xpi` through **Tools → Plugins → Install Plugin From File**. Select one or multiple papers and choose **Metadata Fixer** from the context menu. It discovers published versions, retrieves metadata and applies conference rules without candidate or field confirmation dialogs. A batch uses one small window with only paper titles, short statuses and a Cancel or Close button. A failed item does not stop the remaining papers. Cancel or close the progress window to stop pending updates.

Retrieval uses DOI, arXiv ID, PMID, URL and Extra identifiers. An existing published DOI goes directly to Zotero’s identifier translator. Otherwise, preprint publication links and Google Scholar title search try to resolve a published DOI first, with Crossref, Semantic Scholar, DBLP and PubMed as fallbacks; DOI-free records use official article pages or OpenReview BibTeX. Google Scholar bot checks and rate limits disable its remaining batch queries without stopping other sources. Conflicting matches are skipped. DBLP bot checks or rate limits disable further DBLP requests for the batch; other sources continue. Original item identity, attachments, annotations, notes, collections, tags, relations and Extra remain; empty retrieved values do not erase existing data. Concurrent edits and failed transactions are guarded. Published items only receive missing values and verified repairs; every field retains its existing value when the source only differs in casing, spacing or typography, including during preprint upgrades. Clear repairs include incorrect item types, conference attribution, editors and malformed or misplaced preprint DOIs. Old preprint identifiers remain in Extra.

Cancellation, closing the owning main window and Zotero quit stop the task and abort plugin HTTP requests immediately. Cleanup never waits for initialization or translators; late results cannot write metadata.

In **Settings → Metadata Fixer**, choose **Original**, **Standard** (maintained full name), or **Short** (acronym) conference names. Original is the default; formatting removes editions and years without changing the paper date. Formatting targets Proceedings Title and preserves an existing Conference Name. A proceedings value misplaced in the old Conference Name repairs Proceedings Title even after successful retrieval and when name formatting is off. Standard names follow CCF and official conference or publication sources; CVPR becomes **Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition**. The internal CCF 2026 catalog contains 386 conferences in 10 categories. Rules match multiple historical names to one conference and handle item types and editors. The rule editor is not exposed; maintain `data/conferences.json` directly. Existing saved rule settings remain intact. Genuine journals and secondary tracks are protected by default. Source PDFs, checksums and page references are recorded in `data/conference-catalog.json`.

Automatic scanning, scheduled updates, PDF downloads, title capitalization and tag management are not implemented. The manifest's update endpoint is planned; remote publishing is not configured, so updates currently require XPI installation.

## Development

Use Node.js 22.13+ (22.x) or 24+. Run `npm ci`, then `npm run check`.

- `npm run build`: reuse valid output when inputs have not changed.
- `npm run build:force`: rebuild from scratch.
- `npm run check`: formatting, tests and type checking; reuse valid XPI output.
- `npm run release`: full checks, then prepare the XPI and `SHA256SUMS` under `release/v<version>/`; no `updates.json` is generated.

`npm run test:host` uses disposable profiles and fixture responses. The quit check aborts a real local HTTP request and requires Zotero to exit without being killed. Validate live preprint upgrades, identifier retrieval, IEEE and DOI-free papers, conflicting candidates and configuration preservation during upgrades in a test library. Release preparation does not create a tag or upload files. Shared working rules live in the plugin workspace's root `AGENTS.md`.

The display name is Metadata Fixer; the original add-on ID and preference keys remain unchanged so installation replaces the previous add-on and retains configuration.

## License

[AGPL-3.0-or-later](LICENSE). References and third-party licenses are listed in `THIRD-PARTY-NOTICES`.
