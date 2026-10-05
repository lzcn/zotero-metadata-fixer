import test from "node:test";
import assert from "node:assert/strict";
import { PublicationColumnView } from "../.tests-build/publication-column.js";

function fixture() {
  const preferences = new Map();
  globalThis.Zotero = {
    Prefs: {
      get: (key) => preferences.get(key),
      set: (key, value) => preferences.set(key, value),
    },
    logError(error) {
      throw error;
    },
  };
  let prefs = {
    title: { width: 400, ordinal: 0 },
    publicationTitle: { width: 240, ordinal: 2, hidden: false },
  };
  const view = {
    id: "main",
    tree: {},
    _getColumns: () => [
      { dataKey: "title", ...prefs.title },
      { dataKey: "publicationTitle", ...prefs.publicationTitle },
      { dataKey: "plugin", width: 120, ...prefs.plugin },
    ],
    _getColumnPrefs: () => prefs,
    _storeColumnPrefs(value) {
      prefs = value;
    },
    _resetColumns: async () => {},
    _writeColumnPrefsToFile: async () => {},
  };
  return { preferences, view, win: { ZoteroPane: { itemsView: view } } };
}

test("replacement preserves other columns and restores original visibility", async () => {
  const { view, win } = fixture();
  const controller = new PublicationColumnView();
  const title = structuredClone(view._getColumnPrefs().title);
  controller.sync(win, "plugin", true);
  assert.equal(view._getColumnPrefs().publicationTitle.hidden, true);
  assert.equal(view._getColumnPrefs().plugin.hidden, false);
  assert.equal(view._getColumnPrefs().plugin.ordinal, 2);
  assert.deepEqual(view._getColumnPrefs().title, title);
  view._getColumnPrefs().title.width = 500;
  controller.restore([win]);
  assert.equal(view._getColumnPrefs().publicationTitle.hidden, false);
  assert.equal(view._getColumnPrefs().title.width, 500);
  await Promise.resolve();
});

test("reenabling while a restoration saves retains the original recovery state", async () => {
  const { view, win, preferences } = fixture();
  const controller = new PublicationColumnView();
  let complete;
  view._writeColumnPrefsToFile = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  controller.sync(win, "plugin", true);
  controller.restore([win]);
  controller.sync(win, "plugin", true);
  complete();
  await Promise.resolve();
  const saved = preferences.get(
    "extensions.zotero.metadata-linter.publication-column-visibility",
  );
  assert.deepEqual(JSON.parse(saved), { main: false });
  controller.restore([win]);
  assert.equal(view._getColumnPrefs().publicationTitle.hidden, false);
  complete();
  await Promise.resolve();
});

test("closing the last window restores native preferences without a live table", async () => {
  const { view, win } = fixture();
  const controller = new PublicationColumnView();
  controller.sync(win, "plugin", true);
  win.closed = true;
  view.tree = undefined;
  controller.restore([win]);
  assert.equal(view._getColumnPrefs().publicationTitle.hidden, false);
  await Promise.resolve();
});
