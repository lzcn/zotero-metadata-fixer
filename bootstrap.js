var MLRuntime;
var MLChrome;
var MLGeneration = 0;
var MLStartup;
var MLCancelReadiness;
var MLQuitObserver;

function cleanup(run) {
  try {
    run();
  } catch (error) {
    Zotero.logError(error);
  }
}

function startup({ rootURI }) {
  if (MLRuntime) return Promise.resolve();
  if (MLStartup) return MLStartup;
  const token = ++MLGeneration;
  MLQuitObserver = { observe: () => shutdown() };
  Services.obs?.addObserver(MLQuitObserver, "quit-application-granted");
  MLStartup = start(rootURI, token).finally(() => {
    if (token === MLGeneration) MLStartup = null;
  });
  return MLStartup;
}

async function start(rootURI, token) {
  try {
    await Promise.race([
      Promise.all([
        Zotero.initializationPromise,
        Zotero.unlockPromise,
        Zotero.uiReadyPromise,
      ]),
      new Promise((resolve) => {
        MLCancelReadiness = resolve;
      }),
    ]);
    if (token !== MLGeneration) return;
    MLCancelReadiness = null;
    const service = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    MLChrome = service.registerChrome(
      Services.io.newURI(rootURI + "manifest.json"),
      [["content", "metadata-linter", rootURI + "content/"]],
    );
    const scope = { Zotero, MLRootURI: rootURI, setTimeout, clearTimeout };
    Services.scriptloader.loadSubScript(rootURI + "content/runtime.js", scope);
    MLRuntime = scope.MetadataLinter.start();
  } catch (error) {
    if (token === MLGeneration) shutdown();
    Zotero.logError(error);
  }
}

function shutdown() {
  ++MLGeneration;
  MLCancelReadiness?.();
  MLCancelReadiness = null;
  MLStartup = null;
  const runtime = MLRuntime;
  const chrome = MLChrome;
  const observer = MLQuitObserver;
  MLRuntime = null;
  MLChrome = null;
  MLQuitObserver = null;
  // Stop work immediately, even while Zotero readiness or a translator is pending.
  if (observer)
    cleanup(() =>
      Services.obs?.removeObserver(observer, "quit-application-granted"),
    );
  if (runtime) cleanup(() => runtime.stop());
  if (chrome) cleanup(() => chrome.destruct());
}
function onMainWindowLoad({ window }) {
  cleanup(() => MLRuntime?.inject(window));
}
function onMainWindowUnload({ window }) {
  cleanup(() => MLRuntime?.remove(window));
}
function install() {}
function uninstall() {}
