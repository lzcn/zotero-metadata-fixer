import test from "node:test";
import assert from "node:assert/strict";
import {
  PublicationColumnView,
  REPLACE_PUBLICATION_PREF,
} from "../.tests-build/publication-column.js";

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
  const item = {
    itemType: "journalArticle",
    isRegularItem: () => true,
    getField: (field) =>
      field === "publicationTitle"
        ? "IEEE Transactions on Mobile Computing"
        : "",
  };
  let redraws = 0;
  let prefs = {
    publicationTitle: { hidden: false, width: 240, ordinal: 2 },
    title: { width: 400 },
  };
  const view = {
    id: "main",
    tree: {
      invalidate() {
        redraws++;
      },
    },
    getRow: () => ({ ref: item }),
    _renderCell(index, data, column, first) {
      return { index, data, column, first, view: this };
    },
    _getColumnPrefs: () => prefs,
    _storeColumnPrefs(value) {
      prefs = value;
    },
    _writeColumnPrefsToFile: async () => {},
    _resetColumns: async () => {},
  };
  const win = { ZoteroPane: { itemsView: view } };
  const render = (key = "publicationTitle") =>
    view._renderCell(0, "Original", { dataKey: key }, false);
  return { preferences, item, view, win, render, redraws: () => redraws };
}

test("native cell decoration affects only Publication, preserves preferences and restores its renderer", () => {
  const { view, win, render, redraws } = fixture();
  const controller = new PublicationColumnView();
  const original = view._renderCell;
  const prefs = structuredClone(view._getColumnPrefs());
  controller.sync(win);
  const wrapper = view._renderCell;
  controller.sync(win);
  assert.equal(view._renderCell, wrapper);
  assert.equal(render().data, "TMC");
  assert.equal(render().view, view);
  assert.equal(render("title").data, "Original");
  assert.deepEqual(view._getColumnPrefs(), prefs);
  controller.restore([win]);
  assert.equal(view._renderCell, original);
  assert.equal(render().data, "Original");
  assert.equal(redraws(), 2);
});

test("disabling preserves a later plugin wrapper but makes our decoration inert", () => {
  const { view, win, render } = fixture();
  const controller = new PublicationColumnView();
  controller.sync(win);
  const inner = view._renderCell;
  const later = function (...args) {
    return inner.apply(this, args);
  };
  view._renderCell = later;
  controller.restore([win]);
  assert.equal(view._renderCell, later);
  assert.equal(render().data, "Original");
  controller.sync(win);
  assert.equal(render().data, "TMC");
  controller.restore([win]);
  assert.equal(render().data, "Original");
});

test("switch, field edits, window replacement and non-item rows retain native behavior", () => {
  const { view, win, render, preferences, item } = fixture();
  const controller = new PublicationColumnView();
  const original = view._renderCell;
  preferences.set(REPLACE_PUBLICATION_PREF, false);
  controller.sync(win);
  assert.equal(view._renderCell, original);
  preferences.set(REPLACE_PUBLICATION_PREF, true);
  controller.sync(win);
  item.getField = (field) =>
    field === "publicationTitle" ? "IEEE Transactions on Image Processing" : "";
  assert.equal(render().data, "TIP");
  view.getRow = () => ({ ref: {} });
  assert.equal(render().data, "Original");
  const next = { ...view, _renderCell: original };
  win.ZoteroPane.itemsView = next;
  controller.sync(win);
  assert.equal(view._renderCell, original);
  win.closed = true;
  controller.restore([win]);
  assert.equal(next._renderCell, original);
});

test("legacy custom column preferences migrate to the single native column", async () => {
  const { view, win, preferences } = fixture();
  const pref =
    "extensions.zotero.metadata-linter.publication-column-visibility";
  const legacy = "metadata-linter\\@lzcn-publication-short";
  preferences.set(pref, JSON.stringify({ main: true }));
  view._getColumnPrefs().publicationTitle.hidden = true;
  view._getColumnPrefs()[legacy] = { hidden: false, width: 180, ordinal: 4 };
  const controller = new PublicationColumnView();
  controller.sync(win);
  assert.deepEqual(view._getColumnPrefs().publicationTitle, {
    hidden: false,
    width: 180,
    ordinal: 4,
  });
  assert.equal(view._getColumnPrefs()[legacy], undefined);
  await Promise.resolve();
  assert.deepEqual(JSON.parse(preferences.get(pref)), {});
  controller.restore([win]);
});

test("shutdown removes an instance decoration and restores an inherited renderer", () => {
  const { view, win, render } = fixture();
  const original = view._renderCell;
  delete view._renderCell;
  Object.setPrototypeOf(view, { _renderCell: original });
  const controller = new PublicationColumnView();
  controller.sync(win);
  assert.equal(render().data, "TMC");
  controller.restore([win]);
  assert.equal(Object.hasOwn(view, "_renderCell"), false);
  assert.equal(view._renderCell, original);
});
