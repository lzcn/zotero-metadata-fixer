// Exercise the packaged plugin in the real Zotero host using disposable data.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

let abortedRequests = 0;
const server = createServer((request) => {
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
  strFromU8(files["bootstrap.js"]) +
    `
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
        return element?.options[0]?.textContent && element;
      });
      result.settings = [...select.options].map(option => option.textContent);
      select.value = 'standard';
      select.dispatchEvent(new settings.Event('change'));
      if (!MLRuntime.preferenceData().settings.formatPublication) throw new Error('Concise setting was not saved');
      select.value = 'short';
      select.dispatchEvent(new settings.Event('change'));
      if (MLRuntime.preferenceData().settings.publicationStyle !== 'short') throw new Error('Short naming setting was not saved');
      select.value = 'original';
      select.dispatchEvent(new settings.Event('change'));
      if (MLRuntime.preferenceData().settings.formatPublication) throw new Error('Retrieved setting was not saved');
      await MLRuntime.configureConferences(settings);
      const dialog = await wait(() => [...Services.wm.getEnumerator(null)].find(window => window.document?.location.href === 'chrome://metadata-linter/content/dialog.xhtml' && window.document?.getElementById('actions')?.children.length));
      result.conferenceDialog = !!dialog.document.querySelector('.rule-card');
      if (!result.conferenceDialog) throw new Error('Conference rules dialog did not initialize');
      const search = dialog.document.querySelector('input[type="search"]');
      search.value = 'ICLR';
      search.dispatchEvent(new dialog.Event('input', {bubbles:true}));
      const cards = [...dialog.document.querySelectorAll('.rule-card')];
      if (cards.length !== 1 || cards[0].querySelector('h2')?.textContent !== 'ICLR') throw new Error('Conference search did not work');
      if (cards[0].querySelector('details').open) throw new Error('Conference details should be collapsed');
      cards[0].querySelector('input[type="checkbox"]').checked = false;
      const save = [...dialog.document.querySelectorAll('#actions button')].find(button => button.textContent === 'Save configuration');
      save.click();
      const configured = MLRuntime.preferenceData().settings;
      result.conferenceRules = {count:configured.rules.length, iclrEnabled:configured.rules.find(rule => rule.id === 'iclr')?.enabled};
      if (result.conferenceRules.count !== 386 || result.conferenceRules.iclrEnabled !== false) throw new Error('Conference configuration did not persist');
      for (const window of [...MLRuntime.dialogs]) window.close();
      await win.ZoteroPane.selectItem(item.id);
      const originalRequest = MLRuntime.request.bind(MLRuntime);
      let requested = false;
      MLRuntime.request = (...args) => { requested = true; return originalRequest(...args); };
      MLRuntime.finder = {find:async () => ({candidates:[],warnings:[],answered:1})};
      MLRuntime.retriever = {retrieveCurrent:async () => { await MLRuntime.request(${JSON.stringify(slowURL)}); return {metadata:item.toJSON(),source:'URL',warnings:[]}; }};
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
      await MLOriginalStartup(data);
      await wait(() => doc.getElementById('metadata-linter-menu') && Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === 'metadata-linter-preferences'));
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
