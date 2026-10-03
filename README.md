# Metadata Fixer

[中文](README.zh-CN.md)

Update preprints, fill missing metadata and fix errors in the original Zotero item. Requires Zotero 10; see `package.json` for the version.

## Install and use

Install `dist/zotero-metadata-fixer.xpi` through **Tools → Plugins → Install Plugin From File**. Select papers and choose **Metadata Fixer** from the context menu. It discovers published versions, retrieves metadata and applies conference rules without candidate or field confirmation dialogs. Cancel or close the progress window to stop pending updates.

Retrieval uses DOI, arXiv ID, PMID, URL and Extra identifiers. Conflicting matches are skipped. DBLP bot checks or rate limits disable further DBLP requests for the batch; other sources continue. Original item identity, attachments, annotations, notes, collections, tags, relations and Extra remain; empty retrieved values do not erase existing data. Concurrent edits and failed transactions are guarded. Published items only receive missing values and verified repairs; every field retains its existing value when the source only differs in casing, spacing or typography, including during preprint upgrades. Clear repairs include incorrect item types, conference attribution, editors and malformed or misplaced preprint DOIs. Old preprint identifiers remain in Extra.

Cancellation, closing the owning main window and Zotero quit stop the task and abort plugin HTTP requests immediately. Cleanup never waits for initialization or translators; late results cannot write metadata.

In **Settings → Metadata Fixer**, choose **Original**, **Standard** (maintained full name), or **Short** (acronym) conference names. Original is the default; formatting removes editions and years without changing the paper date. Formatting targets Proceedings Title and preserves an existing Conference Name. Standard names follow CCF and official conference or publication sources; CVPR becomes **Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition**. The bundled CCF 2026 catalog contains 386 conferences in 10 categories. Rules support aliases, exclusions, item types, editor handling, journal preservation and custom names. Genuine journal articles and secondary tracks are protected by default. Configuration supports JSON backup; upgrades preserve user edits and deleted rules. Keep rule IDs stable, add historical aliases and check naming conflicts when maintaining the catalog. PDF URLs, checksums, page references and counts are stored in `data/conference-catalog.json` and `data/conferences.json`.

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
