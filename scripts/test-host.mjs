// Exercise the packaged plugin in the real Zotero host using disposable data.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

let abortedRequests = 0;
let metadataRequests = 0;
const server = createServer((request, response) => {
  if (request.url === "/citation-article") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><html><head>
      <meta name="citation_title" content="Host Conference Paper">
      <meta name="citation_author" content="Lu, Zhi">
      <meta name="citation_journal_title" content="International Conference on Learning Representations">
      <meta name="citation_publication_date" content="2025-05-01">
    </head><body><a href="/citation-bibliography">Bibtex</a></body></html>`);
    return;
  }
  if (request.url === "/citation-bibliography") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(
      "@inproceedings{host,title={Host Conference Paper},author={Lu, Zhi},booktitle={International Conference on Learning Representations},year={2025},pages={1--8}}",
    );
    return;
  }
  if (request.url === "/metadata") {
    metadataRequests++;
    response.end("shared metadata");
    return;
  }
  if (request.url.startsWith("/publication")) {
    response.writeHead(200, { "Content-Type": "text/html" });
    const withDOI = request.url.includes("with-doi");
    response.end(`<!doctype html><html><head>
      <meta name="citation_title" content="Official Host Test Paper">
    </head><body><h1>Official Host Test Paper</h1>
      ${withDOI ? '<h2>DOI</h2><p><a href="https://doi.org/10.52202/host-publication">10.52202/host-publication</a></p>' : ""}
      <p>References: <a href="https://doi.org/10.1000/unrelated">Another paper</a></p>
    </body></html>`);
    return;
  }
  if (request.url === "/scholar") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><html><div id="gs_res_ccl">
      <div class="gs_r" data-cid="arxiv"><h3 class="gs_rt"><a href="https://arxiv.org/abs/2501.01234">[PDF] Scholar Host Test Paper</a></h3><div class="gs_a">Z Lu - arXiv preprint, 2025 - arxiv.org</div></div>
      <div class="gs_r" data-cid="published"><h3 class="gs_rt"><a href="https://doi.org/10.1000/host-scholar">Scholar Host Test Paper</a></h3><div class="gs_a">Z Lu - CVPR, 2026 - IEEE</div></div>
      <div class="gs_r" data-cid="other"><h3 class="gs_rt"><a href="https://dl.acm.org/doi/10.1145/9999">A Different Paper</a></h3><div class="gs_a">A Smith - ACM, 2026 - ACM</div></div>
    </div></html>`);
    return;
  }
  if (request.url === "/blocked") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      "<!doctype html><html><title>Making sure you are not a bot!</title></html>",
    );
    return;
  }
  request.on("aborted", () => abortedRequests++);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
server.unref();
const slowURL = `http://127.0.0.1:${server.address().port}/pending`;
const root = await mkdtemp(join(tmpdir(), "metadata-linter-host-"));
const profile = join(root, "profile"),
  data = join(root, "data");
const marker = join(root, "result.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(data);
const prefs = {
  "extensions.zotero.dataDir": data,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "app.update.auto": false,
  "extensions.update.enabled": false,
  "extensions.zotero.automaticScraperUpdates": false,
  "extensions.zoteroMacWordIntegration.skipInstallation": true,
  "extensions.zoteroOpenOfficeIntegration.skipInstallation": true,
};
await writeFile(
  join(profile, "user.js"),
  Object.entries(prefs)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
const files = unzipSync(
  await readFile(new URL("../dist/zotero-metadata-fixer.xpi", import.meta.url)),
);
files["bootstrap.js"] = strToU8(
  strFromU8(files["bootstrap.js"]).replace(
    "MLRuntime = scope.MetadataLinter.start();",
    "MLHostNativeRenderer = Zotero.getMainWindow()?.ZoteroPane?.itemsView?._renderCell; MLRuntime = scope.MetadataLinter.start();",
  ) +
    `
var MLHostNativeRenderer;
var MLOriginalStartup = startup;
startup = async function(data) {
  await MLOriginalStartup(data);
  setTimeout(async () => {
    const result = {};
    const wait = async (check) => {
      for (let i = 0; i < 100; i++) {
        const value = check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Host UI did not become ready');
    };
    try {
      if (!MLRuntime) throw new Error('Runtime failed to start');
      const win = await wait(() => Zotero.getMainWindow()?.ZoteroPane?.itemsView && Zotero.getMainWindow());
      const doc = win.document;
      const view = win.ZoteroPane.itemsView;
      MLRuntime.configurePublicationDisplay();
      if (Zotero.ItemTreeManager.getCustomColumns().some(col => col.pluginID === 'metadata-linter@lzcn')) throw new Error('Unexpected duplicate column');
      if (view._renderCell === MLHostNativeRenderer) throw new Error('Startup did not decorate native renderer');
      result.nativePublicationOnly = true;
      const legacyKey = win.CSS.escape('metadata-linter@lzcn-publication-short');
      const migratedPrefs = { ...view._getColumnPrefs(), publicationTitle: { ...view._getColumnPrefs().publicationTitle, hidden: true }, [legacyKey]: { hidden:false, width:180, ordinal:4 } };
      view._storeColumnPrefs(migratedPrefs);
      Zotero.Prefs.set('extensions.zotero.metadata-linter.publication-column-visibility', JSON.stringify({ [view.id]:true }), true);
      MLRuntime.configurePublicationDisplay();
      await wait(() => !JSON.parse(Zotero.Prefs.get('extensions.zotero.metadata-linter.publication-column-visibility', true) || '{}')[view.id]);
      const migrated = view._getColumnPrefs();
      if (migrated[legacyKey] || migrated.publicationTitle.hidden || migrated.publicationTitle.width !== 180 || migrated.publicationTitle.ordinal !== 4) throw new Error('Legacy replacement preferences did not migrate');
      result.legacyColumnMigrated = true;
      const renderPublication = async entry => {
        await win.ZoteroPane.selectItem(entry.id);
        const index = view.getRowIndexByID(entry.id);
        const column = view._getColumns().find(col => col.dataKey === 'publicationTitle');
        return view._renderCell(index, view.getCellText(index, 'publicationTitle'), column, false).textContent;
      };
      result.publicationColumn = [];
      for (const [type, field, title, expected] of [
        ['conferencePaper', 'proceedingsTitle', '2025 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)', 'CVPR'],
        ['conferencePaper', 'proceedingsTitle', 'European Conference on Computer Vision', 'ECCV'],
        ['journalArticle', 'publicationTitle', 'IEEE Transactions on Multimedia', 'TMM'],
        ['journalArticle', 'publicationTitle', 'IEEE Transactions on Pattern Analysis and Machine Intelligence', 'TPAMI'],
        ['journalArticle', 'publicationTitle', 'Uncommon Host Journal', 'Uncommon Host Journal'],
        ['journalArticle', 'publicationTitle', 'IEEE Transactions on Mobile Computing', 'TMC'],
        ['journalArticle', 'publicationTitle', 'IEEE Transactions on Geoscience and Remote Sensing', 'TGRS'],
        ['journalArticle', 'publicationTitle', 'IEEE Geoscience and Remote Sensing Letters', 'GRSL'],
        ['journalArticle', 'publicationTitle', 'IEEE Trans. Mobile Comput.', 'TMC'],
        ['preprint', 'repository', 'arXiv', 'arXiv'],
        ['preprint', 'repository', 'Uncommon Repository Name', 'Uncommon Repository Name'],
        ['report', 'institution', 'Massachusetts Institute of Technology', 'Massachusetts Institute of Technology'],
        ['book', 'publisher', 'Cambridge University Press', 'Cambridge University Press'],
        ['thesis', 'university', 'Stanford University', 'Stanford University'],
        ['dataset', 'repository', 'Zenodo', 'Zenodo'],
        ['computerProgram', 'company', 'Software Publisher', 'Software Publisher'],
        ['webpage', 'websiteTitle', 'Example Website', 'Example Website'],
        ['blogPost', 'blogTitle', 'Example Blog', 'Example Blog'],
        ['journalArticle', 'publicationTitle', 'Nature Communications', 'Nat Commun'],
        ['preprint', 'url', 'https://arxiv.org/abs/2601.01234', 'arXiv'],
        ['journalArticle', 'url', 'https://arxiv.org/abs/2601.01234', 'arXiv'],
        ['bookSection', 'bookTitle', 'European Conference on Computer Vision', 'ECCV'],
      ]) {
        const entry = new Zotero.Item(type);
        entry.setField('title', 'Column Host Fixture');
        entry.setField(field, title);
        await entry.saveTx();
        const before = JSON.stringify(entry.toJSON());
        const value = await renderPublication(entry);
        if (value !== expected || JSON.stringify(entry.toJSON()) !== before) throw new Error('Publication column failed: ' + title + ' => ' + value);
        result.publicationColumn.push(value);
        if (expected === 'CVPR') {
          await win.ZoteroPane.selectItem(entry.id);
          const columns = view._getColumns();
          const index = columns.findIndex(col => col.dataKey === 'publicationTitle');
          if (columns[index].hidden) view.tree._columns.toggleHidden(index);
          await wait(() => [...doc.querySelectorAll('.cell')].some(cell => cell.textContent === 'CVPR'));
          if (view._getColumns().filter(col => col.dataKey === 'publicationTitle').length !== 1) throw new Error('Duplicate native publication column');
          result.publicationColumnRendered = true;
        }
        if (type === 'journalArticle' && field === 'publicationTitle') {
          entry.setField(field, 'IEEE Transactions on Image Processing');
          await entry.saveTx();
          if (await renderPublication(entry) !== 'TIP') throw new Error('Column did not reflect edited publication');
        }
      }
      const toggleEntry = new Zotero.Item('journalArticle');
      toggleEntry.setField('title', 'Native Column Toggle Fixture');
      toggleEntry.setField('publicationTitle', 'IEEE Transactions on Mobile Computing');
      await toggleEntry.saveTx();

      const menu = doc.getElementById('metadata-linter-menu');
      if (!menu || menu.localName !== 'menuitem' || menu.children.length) throw new Error('Expected one direct context-menu action');
      result.menu = {label: menu.getAttribute('label'), image: menu.getAttribute('image')};
      if (!result.menu.image.endsWith('icons/icon-16.png')) throw new Error('Missing context-menu icon');
      const item = new Zotero.Item('conferencePaper');
      item.setField('title', 'Disposable host test paper');
      item.setField('proceedingsTitle', 'ICLR 2026');
      await item.saveTx();
      await win.ZoteroPane.selectItem(item.id);
      await win.ZoteroPane.buildItemContextMenu();
      doc.getElementById('zotero-itemmenu').dispatchEvent(new win.Event('popupshowing'));
      if (menu.disabled || menu.hidden) throw new Error('Update action is unavailable for a paper');
      const originalOpen = MLRuntime.open.bind(MLRuntime);
      let progressState;
      MLRuntime.open = (owner, state) => {
        const opened = originalOpen(owner, state);
        if (state.kind === 'progress') progressState = state;
        if (state.kind !== 'progress') throw new Error('Unexpected confirmation dialog');
        return opened;
      };
      MLRuntime.finder = {find: async () => {
        await new Promise(resolve => setTimeout(resolve, 800));
        return {candidates: [], warnings: []};
      }};
      MLRuntime.retriever = {retrieveCurrent: async () => ({metadata: {...item.toJSON(), title: item.getField('title').toUpperCase(), proceedingsTitle: 'International Conference on Learning Representations 2026', abstractNote:'Updated without confirmation'}, source: 'host fixture', warnings: []})};
      const running = MLRuntime.run(win, 'lint');
      await new Promise(resolve => setTimeout(resolve, 400));
      if (progressState?.cancelled || !MLRuntime.busy) throw new Error('Operation cancelled during initial dialog loading');
      const generation = MLRuntime.generation;
      await MLRuntime.run(win, 'lint');
      if (generation !== MLRuntime.generation) throw new Error('Duplicate invocation cancelled an operation');
      await running;
      result.operation = {finished: progressState.finished, cancelled: progressState.cancelled, status: progressState.rows[0].status};
      if (result.operation.cancelled || item.getField('abstractNote') !== 'Updated without confirmation') throw new Error('Automatic update did not succeed');
      if (item.getField('title') !== 'Disposable host test paper' || item.getField('proceedingsTitle') !== 'ICLR 2026') throw new Error('Published repair overwrote populated fields');
      for (const dialog of [...MLRuntime.dialogs]) dialog.close();

      const cancelling = MLRuntime.run(win, 'lint');
      const progressDialog = await wait(() => [...MLRuntime.dialogs].find(window => !window.closed && window.arguments?.[0]?.kind === 'progress' && window.document?.getElementById('actions')?.children.length));
      progressDialog.close();
      await cancelling;
      result.cancellation = {cancelled: progressState.cancelled, status: progressState.rows[0].status};
      if (!result.cancellation.cancelled || result.cancellation.status !== 'Cancelled') throw new Error('Closing a running dialog did not cancel');
      const buttonCancelling = MLRuntime.run(win, 'lint');
      const cancelDialog = await wait(() => [...MLRuntime.dialogs].find(window => !window.closed && window.arguments?.[0] === progressState && window.document?.getElementById('actions')?.children.length));
      cancelDialog.document.getElementById('actions').firstElementChild.dispatchEvent(new cancelDialog.Event('command'));
      await buttonCancelling;
      result.nativeCancellation = progressState.cancelled && !cancelDialog.closed;
      if (!result.nativeCancellation) throw new Error('Native Cancel command did not retain cancelled results');
      cancelDialog.document.getElementById('actions').firstElementChild.dispatchEvent(new cancelDialog.Event('command'));
      await wait(() => cancelDialog.closed);
      const preprint = new Zotero.Item('preprint');
      preprint.setField('title', 'Host Test Preprint');
      preprint.setField('DOI', '10.48550/arXiv.2501.01234');
      preprint.setField('url', 'https://arxiv.org/abs/2501.01234');
      preprint.setCreators([{firstName:'ZHI',lastName:'LU',creatorType:'author'}]);
      await preprint.saveTx();
      const originalID = preprint.id, originalKey = preprint.key;
      await win.ZoteroPane.selectItem(preprint.id);
      MLRuntime.finder = {find:async () => ({candidates:[{source:'OpenReview',title:'Host Test Preprint',authors:['Zhi Lu'],venue:'ICLR 2026',url:'https://openreview.net/forum?id=fixture'}],warnings:[],answered:1})};
      MLRuntime.retriever = {candidate:async () => ({itemType:'conferencePaper',title:'HOST TEST PREPRINT',proceedingsTitle:'ICLR 2026',url:'https://openreview.net/forum?id=fixture',creators:[{firstName:'Zhi',lastName:'Lu',creatorType:'author'}]})};
      await MLRuntime.run(win, 'lint');
      result.upgrade = {id:preprint.id, key:preprint.key, type:preprint.itemType, title:preprint.getField('title'), DOI:preprint.getField('DOI')};
      if (preprint.id !== originalID || preprint.key !== originalKey || preprint.itemType !== 'conferencePaper' || preprint.getField('title') !== 'Host Test Preprint' || preprint.getField('DOI') || !preprint.getField('extra').includes('Preprint DOI: 10.48550/arXiv.2501.01234') || preprint.getCreators()[0].lastName !== 'LU') throw new Error('In-place DOI-free upgrade did not preserve user values');
      for (const window of [...MLRuntime.dialogs]) window.close();
      MLRuntime.open = originalOpen;
      const settings = Zotero.Utilities.Internal.openPreferences('metadata-linter-preferences');
      const select = await wait(() => {
        const element = settings.document.getElementById('ml-publication-style');
        return element?.querySelector('menuitem')?.label && element;
      });
      result.settings = [...select.querySelectorAll('menuitem')].map(option => option.label);
      const replace = settings.document.getElementById('ml-replace-publication');
      if (settings.document.getElementById('ml-replace-publication-help')?.textContent !== MLRuntime.preferenceData().strings.replacePublicationHelp) throw new Error('Missing localized Zotero Style compatibility reminder');
      if (!replace.checked || replace.getAttribute('native') !== 'true') throw new Error('Missing native replacement setting');
      const originalTitlePrefs = JSON.stringify(win.ZoteroPane.itemsView._getColumnPrefs().title);
      replace.checked = false;
      replace.dispatchEvent(new settings.Event('command'));
      if (view._renderCell !== MLHostNativeRenderer || await renderPublication(toggleEntry) !== 'IEEE Transactions on Mobile Computing') throw new Error('Disabling did not restore native rendering');
      const nativeVisibility = view._getColumns().find(col => col.dataKey === 'publicationTitle').hidden;
      replace.checked = true;
      replace.dispatchEvent(new settings.Event('command'));
      if (await renderPublication(toggleEntry) !== 'TMC') throw new Error('Reenabling did not abbreviate native Publication');
      if (view._getColumns().find(col => col.dataKey === 'publicationTitle').hidden !== nativeVisibility) throw new Error('Toggle changed native visibility');
      if (JSON.stringify(view._getColumnPrefs().title) !== originalTitlePrefs) throw new Error('Replacement changed another column');
      result.replacementSetting = {disabledRestored:true,enabledReplaced:true};
      select.value = 'standard';
      select.dispatchEvent(new settings.Event('command'));
      if (!MLRuntime.preferenceData().settings.formatPublication) throw new Error('Concise setting was not saved');
      const cvpr = new Zotero.Item('conferencePaper');
      cvpr.setField('title', 'My Hand Edited CVPR TITLE');
      cvpr.setField('DOI', '10.1000/host-cvpr');
      cvpr.setField('proceedingsTitle', 'Conference on computer vision and pattern recognition 2026 .');
      cvpr.setField('date', '2026');
      cvpr.setField('conferenceName', 'My existing CVPR event');
      await cvpr.saveTx();
      await win.ZoteroPane.selectItem(cvpr.id);
      MLRuntime.open = (owner, state) => {
        const opened = originalOpen(owner, state);
        if (state.kind === 'progress') progressState = state;
        return opened;
      };
      MLRuntime.retriever = {retrieveCurrent:async () => {
        await MLRuntime.network(MLRuntime.operation).json(${JSON.stringify(slowURL.replace("/pending", "/blocked"))});
        throw new Error('Expected a blocked JSON response');
      }};
      await MLRuntime.run(win, 'lint');
      result.cvpr = {publication:cvpr.getField('proceedingsTitle'),conference:cvpr.getField('conferenceName'),date:cvpr.getField('date')};
      if (result.cvpr.publication !== 'Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition' || result.cvpr.conference !== 'My existing CVPR event' || result.cvpr.date !== '2026' || cvpr.getField('title') !== 'My Hand Edited CVPR TITLE') throw new Error('CVPR full-name normalization failed');
      if (!progressState.rows[0].detail.includes('Access blocked')) throw new Error('Native HTML API response was not classified as blocked');
      result.blockedResponse = true;
      const identity = {id:cvpr.id,key:cvpr.key};
      for (const venue of ["2026 IEEE 37 Conference for Computer Vision & Pattern Recognition", "Proc. of the XXXVII Annual Conference on Computer Vision and Pattern Recognition (CVPR'26)"]) {
        cvpr.setField('proceedingsTitle', venue);
        await cvpr.saveTx();
        MLRuntime.retriever = {retrieveCurrent:async () => ({metadata:cvpr.toJSON(),source:'DOI',warnings:[]})};
        await MLRuntime.run(win, 'lint');
        if (cvpr.getField('proceedingsTitle') !== result.cvpr.publication || cvpr.getField('conferenceName') !== result.cvpr.conference || cvpr.getField('date') !== '2026' || cvpr.id !== identity.id || cvpr.key !== identity.key) throw new Error('Generic venue normalization changed the event, date or identity');
      }
      result.venueVariants = true;
      const exporting = new Zotero.Translate.Export();
      exporting.setItems([cvpr]);
      const exporter = (await exporting.getTranslators()).find(translator => translator.label === 'BibTeX');
      if (!exporter) throw new Error('Native BibTeX translator is missing');
      exporting.setTranslator(exporter);
      await exporting.translate();
      const bibtex = exporting.string.replace(/[{}]/g, '');
      result.bibtex = bibtex.includes('booktitle') && bibtex.includes(result.cvpr.publication) && !bibtex.includes('My existing CVPR event');
      if (!result.bibtex) throw new Error('Native BibTeX export did not use Proceedings Title: ' + exporting.string);

      select.value = 'original';
      select.dispatchEvent(new settings.Event('command'));
      cvpr.setField('conferenceName', 'Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition');
      cvpr.setField('proceedingsTitle', 'Conference on computer vision and pattern recognition 2026');
      await cvpr.saveTx();
      MLRuntime.retriever = {retrieveCurrent:async () => ({metadata:{itemType:'conferencePaper',title:cvpr.getField('title').toLowerCase(),DOI:cvpr.getField('DOI'),proceedingsTitle:'Conference on computer vision and pattern recognition 2026',conferenceName:'CVPR'},source:'DOI',warnings:[]})};
      await MLRuntime.run(win, 'lint');
      result.proceedingsRepair = cvpr.getField('proceedingsTitle') === cvpr.getField('conferenceName');
      if (!result.proceedingsRepair) throw new Error('Misplaced proceedings value did not repair the publication field');
      for (const window of [...MLRuntime.dialogs]) window.close();
      const scholarItem = new Zotero.Item('preprint');
      scholarItem.setField('title', 'Scholar Host Test Paper');
      scholarItem.setCreators([{firstName:'Zhi',lastName:'Lu',creatorType:'author'}]);
      await scholarItem.saveTx();
      const scholarID = scholarItem.id;
      await win.ZoteroPane.selectItem(scholarID);
      const scholarRequest = MLRuntime.request.bind(MLRuntime);
      const scholarCalls = [];
      MLRuntime.request = (url, ...args) => {
        scholarCalls.push(url);
        if (url.startsWith('https://scholar.google.com/')) return scholarRequest(${JSON.stringify(slowURL.replace("/pending", "/scholar"))}, ...args);
        throw new Error('Unexpected fallback request: ' + url);
      };
      MLRuntime.finder = undefined;
      MLRuntime.retriever = {candidate:async candidate => {
        if (candidate.source !== 'Google Scholar' || candidate.doi !== '10.1000/host-scholar') throw new Error('Scholar did not resolve the published DOI');
        return {itemType:'conferencePaper',title:'SCHOLAR HOST TEST PAPER',DOI:candidate.doi,proceedingsTitle:'CVPR 2026',creators:scholarItem.getCreators()};
      }};
      await MLRuntime.run(win, 'lint');
      result.scholar = {requests:scholarCalls.length,type:scholarItem.itemType,DOI:scholarItem.getField('DOI'),id:scholarItem.id};
      if (result.scholar.requests !== 1 || result.scholar.type !== 'conferencePaper' || result.scholar.DOI !== '10.1000/host-scholar' || scholarItem.id !== scholarID || scholarItem.getField('title') !== 'Scholar Host Test Paper') throw new Error('Native Scholar discovery or in-place DOI upgrade failed');
      MLRuntime.request = scholarRequest;
      for (const window of [...MLRuntime.dialogs]) window.close();

      // Real web and BibTeX translators, isolated local responses, no source substitutions.
      const mislabeled = new Zotero.Item('journalArticle');
      mislabeled.setField('title', 'Host Conference Paper');
      mislabeled.setField('publicationTitle', 'International Conference on Learning Representations');
      mislabeled.setField('url', 'https://proceedings.iclr.cc/paper_files/paper/2025/hash/host-Abstract-Conference.html');
      mislabeled.setCreators([{firstName:'Zhi',lastName:'Lu',creatorType:'author'}]);
      await mislabeled.saveTx();
      const mislabeledIdentity = {id:mislabeled.id,key:mislabeled.key};
      await win.ZoteroPane.selectItem(mislabeled.id);
      const bibliographyCalls = [];
      MLRuntime.request = (url, ...args) => {
        bibliographyCalls.push(url);
        if (url === mislabeled.getField('url')) return scholarRequest(${JSON.stringify(slowURL.replace("/pending", "/citation-article"))}, ...args);
        if (url === 'https://proceedings.iclr.cc/citation-bibliography') return scholarRequest(${JSON.stringify(slowURL.replace("/pending", "/citation-bibliography"))}, ...args);
        throw new Error('Unexpected online request: ' + url);
      };
      MLRuntime.finder = undefined;
      MLRuntime.retriever = undefined;
      await MLRuntime.run(win, 'lint');
      result.bibliographyTypeRepair = {type:mislabeled.itemType,venue:mislabeled.getField('proceedingsTitle'),requests:bibliographyCalls.length,status:MLRuntime.progressState.rows.at(-1).status};
      if (mislabeled.itemType !== 'conferencePaper' || mislabeled.getField('proceedingsTitle') !== 'International Conference on Learning Representations' || mislabeled.id !== mislabeledIdentity.id || mislabeled.key !== mislabeledIdentity.key || result.bibliographyTypeRepair.status !== 'Updated' || bibliographyCalls.length !== 2) throw new Error('Native linked-bibliography type correction failed: ' + JSON.stringify(result.bibliographyTypeRepair));
      MLRuntime.request = scholarRequest;
      for (const window of [...MLRuntime.dialogs]) window.close();

      const originalSearch = Zotero.Translate.Search;
      const originalWeb = Zotero.Translate.Web;
      try {
        result.official = [];
        for (const withDOI of [true, false]) {
          const officialItem = new Zotero.Item('preprint');
          officialItem.setField('title', 'Official Host Test Paper');
          officialItem.setField('url', 'https://proceedings.neurips.cc/paper/2023/hash/abc-Abstract-Conference.html');
          officialItem.setCreators([{firstName:'Zhi',lastName:'Lu',creatorType:'author'}]);
          await officialItem.saveTx();
          const id = officialItem.id, key = officialItem.key;
          await win.ZoteroPane.selectItem(id);
          const officialCalls = [];
          MLRuntime.request = (url, ...args) => {
            officialCalls.push(url);
            if (url !== officialItem.getField('url')) throw new Error('Unexpected broad search: ' + url);
            return scholarRequest(${JSON.stringify(slowURL.replace("/pending", "/publication"))} + (withDOI ? '?with-doi' : ''), ...args);
          };
          const metadata = {itemType:'conferencePaper',title:'OFFICIAL HOST TEST PAPER',proceedingsTitle:'Advances in Neural Information Processing Systems',date:'2023',creators:officialItem.getCreators(),abstractNote:'From official publication'};
          class FixtureTranslation {
            setIdentifier(ids) {
              if (!withDOI || ids.DOI !== '10.52202/host-publication') throw new Error('Incorrect article DOI');
              this.doi = ids.DOI;
            }
            setDocument(document) { this.document = document; }
            async getTranslators() { return ['host-fixture']; }
            setTranslator() {}
            setHandler() {}
            async translate(options) {
              if (options.libraryID !== false || options.saveAttachments !== false) throw new Error('Translator tried to create a new item');
              return [{...metadata,DOI:this.doi}];
            }
          }
          Zotero.Translate.Search = FixtureTranslation;
          Zotero.Translate.Web = FixtureTranslation;
          MLRuntime.finder = undefined;
          MLRuntime.retriever = undefined;
          await MLRuntime.run(win, 'lint');
          if (officialCalls.length !== 1 || officialItem.id !== id || officialItem.key !== key || officialItem.itemType !== 'conferencePaper' || officialItem.getField('title') !== 'Official Host Test Paper' || officialItem.getField('DOI') !== (withDOI ? '10.52202/host-publication' : '') || officialItem.getField('abstractNote') !== metadata.abstractNote) throw new Error('Official source shortcut or DOI-free update failed');
          result.official.push({withDOI,requests:officialCalls.length,type:officialItem.itemType,DOI:officialItem.getField('DOI')});
          for (const window of [...MLRuntime.dialogs]) window.close();
        }
        const revised = new Zotero.Item('preprint');
        revised.setField('title', 'Revision Host Paper');
        revised.setField('date', '2025-10-21');
        revised.setField('url', 'https://arxiv.org/abs/2409.04730');
        revised.setField('DOI', '10.48550/arXiv.2409.04730');
        revised.setCreators([{firstName:'Zhi',lastName:'Lu',creatorType:'author'}]);
        await revised.saveTx();
        const revisedIdentity = {id:revised.id,key:revised.key};
        await win.ZoteroPane.selectItem(revised.id);
        MLRuntime.request = async url => {
          if (url.startsWith('https://api.crossref.org/works?')) return JSON.stringify({message:{items:[{type:'proceedings-article',title:['Revision Host Paper'],DOI:'10.1000/revision-host',author:[{given:'Zhi',family:'Lu'}],issued:{'date-parts':[[2024]]},'container-title':['2024 IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS)']}]}});
          throw new Error('Offline source: ' + url);
        };
        class RevisionIdentifier extends Zotero.Translate.Import {
          setIdentifier(ids) {
            if (ids.DOI !== '10.1000/revision-host') throw new Error('Incorrect selected DOI');
            this.setString('@inproceedings{host,title={Revision Host Paper},author={Lu, Zhi},booktitle={2024 IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS)},year={2024},doi={10.1000/revision-host}}');
          }
        }
        Zotero.Translate.Search = RevisionIdentifier;
        Zotero.Translate.Web = originalWeb;
        MLRuntime.finder = undefined;
        MLRuntime.retriever = undefined;
        await MLRuntime.run(win, 'lint');
        result.revisionDateUpgrade = {type:revised.itemType,date:revised.getField('date'),DOI:revised.getField('DOI'),venue:revised.getField('proceedingsTitle'),status:MLRuntime.progressState.rows.at(-1).status};
        if (revised.itemType !== 'conferencePaper' || revised.getField('date') !== '2024' || revised.getField('DOI') !== '10.1000/revision-host' || revised.id !== revisedIdentity.id || revised.key !== revisedIdentity.key || result.revisionDateUpgrade.status !== 'Updated') throw new Error('Revision date blocked an earlier publication: ' + JSON.stringify(result.revisionDateUpgrade));
        for (const window of [...MLRuntime.dialogs]) window.close();
      } finally {
        Zotero.Translate.Search = originalSearch;
        Zotero.Translate.Web = originalWeb;
        MLRuntime.request = scholarRequest;
      }

      const batch = [];
      for (let i = 0; i < 3; i++) {
        const paper = new Zotero.Item('journalArticle');
        paper.setField('title', 'Batch Host Paper ' + i);
        paper.setField('DOI', '10.1000/batch-' + i);
        await paper.saveTx();
        batch.push(paper);
      }
      await win.ZoteroPane.selectItem(batch[0].id);
      MLRuntime.retriever = {retrieveCurrent:async paper => {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (paper.id === batch[1].id) throw new Error('Fixture failure');
        return {metadata:{...paper.toJSON(),abstractNote:'Filled in batch'},source:'DOI',warnings:[]};
      }};
      const batchRunning = MLRuntime.run(win, 'lint');
      const batchDialog = await wait(() => [...MLRuntime.dialogs].find(window => !window.closed && window.arguments?.[0] === progressState && window.document?.querySelector('tbody')));
      await win.ZoteroPane.itemsView.selectItems(batch.map(paper => paper.id));
      await MLRuntime.run(win, 'lint');
      await MLRuntime.run(win, 'lint');
      const batchDoc = batchDialog.document;
      const cancelButton = batchDoc.getElementById('actions').firstElementChild;
      result.queue = {total:progressState.total,windows:[...MLRuntime.dialogs].filter(window => !window.closed).length,waiting:progressState.rows.filter(row => row.status === 'Waiting').length,native:cancelButton.namespaceURI === 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul',appearance:batchDialog.getComputedStyle(cancelButton).MozAppearance};
      if (result.queue.total !== 3 || result.queue.windows !== 1 || !result.queue.waiting || !result.queue.native || cancelButton.getAttribute('label') !== 'Cancel' || cancelButton.getBoundingClientRect().width < 40) throw new Error('Shared queue or native Cancel button failed');
      await wait(() => progressState.rows[0].status === 'Updated' && !batchDialog.closed);
      if (batchDoc.querySelectorAll('tbody tr').length !== 3) throw new Error('Queue did not retain completed and waiting rows');
      await batchRunning;
      result.batch = {total:progressState.total,statuses:progressState.rows.map(row => row.status),closed:batchDialog.closed};
      if (result.batch.total !== 3 || result.batch.statuses.join(',') !== 'Updated,Failed,Updated' || result.batch.closed || batch[0].getField('abstractNote') !== 'Filled in batch' || batch[1].getField('abstractNote') || batch[2].getField('abstractNote') !== 'Filled in batch') throw new Error('Native queue completion or failure isolation failed');
      if (batchDoc.getElementById('actions').firstElementChild.getAttribute('label') !== 'Close') throw new Error('Finished queue did not offer Close');
      await win.ZoteroPane.selectItem(batch[0].id);
      await MLRuntime.run(win, 'lint');
      if (batchDialog.closed || [...MLRuntime.dialogs].filter(window => !window.closed).length !== 1 || progressState.rows.length !== 4 || batchDoc.querySelectorAll('tbody tr').length !== 4) throw new Error('Completed window was not reused with history retained');
      batchDoc.getElementById('actions').firstElementChild.dispatchEvent(new batchDialog.Event('command'));
      await wait(() => batchDialog.closed);
      const dmlnet = new Zotero.Item('journalArticle');
      const dmlTitle = 'DMLNet: Differential Saliency with Multi-Domain Learning Network for Moving Infrared Small Target Detection';
      dmlnet.setField('title', dmlTitle);
      dmlnet.setField('url', 'https://ieeexplore.ieee.org/abstract/document/11592444/');
      dmlnet.setField('publicationTitle', 'IEEE Geoscience and Remote Sensing Letters');
      dmlnet.setField('date', '2026');
      dmlnet.setCreators([{firstName:'Zhenming',lastName:'Peng',creatorType:'author'}]);
      await dmlnet.saveTx();
      await win.ZoteroPane.selectItem(dmlnet.id);
      MLRuntime.finder = {find:async (paper, preprint, resolve) => {
        const candidate = {source:'URL',title:dmlTitle,url:dmlnet.getField('url')};
        if (!await resolve(candidate)) throw new Error('DMLNet metadata rejected');
        return {candidates:[candidate],warnings:[],answered:1};
      }};
      MLRuntime.retriever = {candidate:async () => ({itemType:'journalArticle',title:'DMLNet: Differential Saliency With Multidomain Learning Network for Moving Infrared Small-Target Detection',DOI:'10.1109/LGRS.2026.3708839',publicationTitle:dmlnet.getField('publicationTitle'),creators:[{firstName:'Yi',lastName:'Rong',creatorType:'author'},...dmlnet.getCreators()]})};
      await MLRuntime.run(win, 'lint');
      result.dmlnet = {DOI:dmlnet.getField('DOI'),titlePreserved:dmlnet.getField('title') === dmlTitle,status:progressState.rows[0].status};
      if (result.dmlnet.DOI !== '10.1109/LGRS.2026.3708839' || !result.dmlnet.titlePreserved || result.dmlnet.status !== 'Updated') throw new Error('DMLNet compound-word DOI repair failed');
      select.value = 'standard';
      select.dispatchEvent(new settings.Event('command'));
      result.supplementaryConferences = [];
      for (const [venue, expected] of [
        ['2024 IEEE International Geoscience and Remote Sensing Symposium', 'IEEE International Geoscience and Remote Sensing Symposium'],
        ['2025 IEEE/CVF Winter Conference on Applications of Computer Vision (WACV)', 'IEEE/CVF Winter Conference on Applications of Computer Vision'],
        ['2024 46th Annual International Conference of the IEEE Engineering in Medicine and Biology Society (EMBC)', 'Annual International Conference of the IEEE Engineering in Medicine and Biology Society'],
        ['CVPRW', 'IEEE/CVF Conference on Computer Vision and Pattern Recognition Workshops'],
        ['ICCV 2023 Workshops', 'IEEE/CVF International Conference on Computer Vision Workshops'],
        ['EACL', 'Conference of the European Chapter of the Association for Computational Linguistics'],
      ]) {
        const paper = new Zotero.Item('bookSection');
        paper.setField('title', 'Supplementary Conference Host Paper');
        paper.setField('bookTitle', venue);
        paper.setField('DOI', '10.1000/supplementary');
        paper.setField('date', '2024');
        paper.setCreators([{firstName:'Zhi',lastName:'Lu',creatorType:'author'},{firstName:'Volume',lastName:'Editor',creatorType:'editor'}]);
        await paper.saveTx();
        const id = paper.id, key = paper.key;
        await win.ZoteroPane.selectItem(id);
        MLRuntime.retriever = {retrieveCurrent:async () => ({metadata:paper.toJSON(),source:'DOI',warnings:[]})};
        await MLRuntime.run(win, 'lint');
        if (paper.id !== id || paper.key !== key || paper.itemType !== 'conferencePaper' || paper.getField('proceedingsTitle') !== expected || paper.getCreators().some(creator => creator.creatorTypeID === Zotero.CreatorTypes.getID('editor')) || paper.getField('date') !== '2024') throw new Error('Supplementary conference repair failed: ' + venue);
        result.supplementaryConferences.push(paper.getField('proceedingsTitle'));
      }
      select.value = 'short';
      select.dispatchEvent(new settings.Event('command'));
      if (MLRuntime.preferenceData().settings.publicationStyle !== 'short') throw new Error('Short naming setting was not saved');
      select.value = 'original';
      select.dispatchEvent(new settings.Event('command'));
      if (MLRuntime.preferenceData().settings.formatPublication) throw new Error('Retrieved setting was not saved');
      const configured = MLRuntime.preferenceData().settings;
      result.conferenceRules = {count:configured.rules.length,visible:!!settings.document.getElementById('ml-conference-rules')};
      if (result.conferenceRules.count !== 513 || result.conferenceRules.visible) throw new Error('Internal conference rules are missing or advanced configuration is exposed');
      await win.ZoteroPane.selectItem(item.id);
      const originalRequest = MLRuntime.request.bind(MLRuntime);
      let requested = false;
      MLRuntime.request = (...args) => { requested = true; return originalRequest(...args); };
      MLRuntime.finder = {find:async () => ({candidates:[],warnings:[],answered:1})};
      MLRuntime.retriever = {retrieveCurrent:async () => { const metadataURL = ${JSON.stringify(slowURL.replace("/pending", "/metadata"))};
        const values = await Promise.all([MLRuntime.request(metadataURL), MLRuntime.request(metadataURL)]);
        values.push(await MLRuntime.request(metadataURL));
        if (values.some(value => value !== 'shared metadata')) throw new Error('Shared native response was corrupted');
        result.requestReuse = true;
        await Promise.all([MLRuntime.request(${JSON.stringify(slowURL)}), MLRuntime.request(${JSON.stringify(slowURL)})]); return {metadata:item.toJSON(),source:'URL',warnings:[]}; }};
      const exitingRuntime = MLRuntime;
      const pending = exitingRuntime.run(win, 'lint');
      await wait(() => requested);
      await new Promise(resolve => setTimeout(resolve, 300));
      const exitStart = Date.now();
      shutdown();
      shutdown();
      await pending;
      result.shutdown = {elapsedMs:Date.now()-exitStart,busy:exitingRuntime.busy,runtimeReleased:MLRuntime === null,chromeReleased:MLChrome === null};
      if (result.shutdown.elapsedMs > 2000 || result.shutdown.busy || !result.shutdown.runtimeReleased || !result.shutdown.chromeReleased) throw new Error('Shutdown waited for remote work or left resources alive');
      if (doc.getElementById('metadata-linter-menu') || Zotero.MetadataLinter || Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === 'metadata-linter-preferences')) throw new Error('Shutdown left plugin UI registered');
      if (Zotero.ItemTreeManager.getCustomColumns().some(col => col.pluginID === 'metadata-linter@lzcn')) throw new Error('Shutdown left publication column');
      if (view._renderCell !== MLHostNativeRenderer) throw new Error('Shutdown did not restore native renderer');
      await new Promise(resolve => setTimeout(resolve, 200));
      await MLOriginalStartup(data);
      await wait(() => doc.getElementById('metadata-linter-menu') && Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === 'metadata-linter-preferences'));
      if (Zotero.ItemTreeManager.getCustomColumns().some(col => col.pluginID === 'metadata-linter@lzcn') || await renderPublication(toggleEntry) !== 'TMC') throw new Error('Restart did not decorate the single native Publication');
      result.restart = {menus:doc.querySelectorAll('#metadata-linter-menu').length};
      if (result.restart.menus !== 1 || !MLRuntime) throw new Error('Restart did not restore exactly one plugin entry');
      shutdown();
      result.ok = true;
    } catch(error) { result.error = String(error) + '\\n' + error.stack; }
    await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify(result));
    Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
  }, 3000);
};
`,
);
await writeFile(
  join(profile, "extensions/metadata-linter@lzcn.xpi"),
  zipSync(files),
);
const log = await open(join(root, "zotero.log"), "w");
const child = spawn(
  process.env.ZOTERO_BINARY || "/Applications/Zotero.app/Contents/MacOS/zotero",
  ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
  { stdio: ["ignore", log.fd, log.fd] },
);
console.log(`Disposable host test: ${root}`);
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
}, 45000);
try {
  await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  if (timedOut) throw new Error("Zotero did not exit without being killed");
  const result = JSON.parse(await readFile(marker, "utf8"));
  if (!result.ok) throw new Error(JSON.stringify(result));
  if (metadataRequests !== 1 || abortedRequests !== 1)
    throw new Error("Native requests were not deduplicated");
  if (!abortedRequests)
    throw new Error("Shutdown did not abort the pending native HTTP request");
  console.log(JSON.stringify({ ...result, abortedRequests }));
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
  server.closeAllConnections();
  server.close();
  await log.close();
}
