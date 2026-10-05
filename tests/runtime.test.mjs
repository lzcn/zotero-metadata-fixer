import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { FakeItem, hostFor, published } from "./helpers.mjs";

globalThis.Zotero = { locale: "en-US", logError() {} };
globalThis.MLRootURI = "file:///test/";
const { Runtime } = await import("../.tests-build/runtime.js");
const { CONFERENCE_SETTINGS_PREF, DEFAULT_CONFERENCE_RULES } = await import(
  "../.tests-build/conferences.js"
);

function runFixture(item) {
  const runtime = new Runtime();
  runtime.host = () => ({
    ...hostFor(item),
    active: () => runtime.alive && runtime.generation === 1,
  });
  runtime.retriever = { retrieve: async () => published };
  const state = { previews: 0, progress: null };
  runtime.open = (_, data) => {
    if (data.kind === "progress") {
      state.progress = data;
      return {
        window: {
          closed: false,
          renderProgress() {},
          close() {
            this.closed = true;
          },
        },
        result: new Promise(() => {}),
      };
    }
    state.previews++;
    throw new Error("Unexpected confirmation dialog: " + data.kind);
  };
  const win = { ZoteroPane: { getSelectedItems: () => [item] } };
  return { runtime, state, win };
}

function lintFixture(item = new FakeItem()) {
  const fixture = runFixture(item);
  const { runtime, state } = fixture;
  const calls = [];
  item.data.title = published.title;
  runtime.finder = {
    find: async () => {
      calls.push("find");
      return {
        candidates: [
          {
            source: "Crossref",
            title: published.title,
            doi: published.DOI,
            venue: published.publicationTitle,
            authors: ["Zhi Lu"],
            year: 2026,
          },
        ],
        warnings: [],
        answered: 1,
      };
    },
  };
  runtime.retriever = {
    candidate: async () => {
      calls.push("published metadata");
      return published;
    },
    retrieveCurrent: async () => {
      calls.push("current metadata");
      return {
        metadata: {
          ...item.toJSON(),
          abstractNote: "Current version abstract",
        },
        source: "arXiv",
        warnings: [],
      };
    },
  };
  return { ...fixture, calls, item };
}

test("Lint checks preprint status and uses published metadata and updates in place without prompting", async () => {
  const { runtime, win, state, calls, item } = lintFixture();
  await runtime.run(win, "lint");
  assert.deepEqual(calls, ["find", "published metadata"]);
  assert.equal(item.id, 42);
  assert.equal(item.itemType, "journalArticle");
  assert.deepEqual(item.data.attachments, [7]);
  assert.match(item.data.extra, /Preprint URL:/);
});

test("Lint falls back to current preprint metadata when no publication is found", async () => {
  const { runtime, win, state, calls, item } = lintFixture();
  runtime.finder.find = async () => {
    calls.push("find");
    return { candidates: [], warnings: [], answered: 5 };
  };
  await runtime.run(win, "lint");
  assert.deepEqual(calls, ["find", "current metadata"]);
  assert.equal(item.itemType, "preprint");
  assert.equal(item.getField("abstractNote"), "Current version abstract");
  assert.match(state.progress.rows[0].detail, /No published version found/);
});

test("Lint directly retrieves metadata for a published item without publication discovery", async () => {
  const item = new FakeItem();
  Object.assign(item.data, published);
  item.itemTypeID = 2;
  const { runtime, win, calls, state } = lintFixture(item);
  await runtime.run(win, "lint");
  assert.deepEqual(calls, ["current metadata"]);
  assert.equal(item.itemType, "journalArticle");
  assert.doesNotMatch(item.data.extra, /Preprint URL:/);
});

test("the single Lint action enriches a missing published DOI without changing item identity", async () => {
  const item = new FakeItem();
  Object.assign(item.data, published);
  delete item.data.DOI;
  item.data.url = "https://publisher.example/paper";
  item.itemTypeID = 2;
  const { runtime, win, state } = lintFixture(item);
  const find = runtime.finder.find;
  runtime.finder.find = (selected, usePreprintLinks) => {
    assert.equal(usePreprintLinks, false);
    return find(selected);
  };
  await runtime.run(win, "lint");
  assert.equal(item.getField("DOI"), published.DOI);
  assert.equal(item.id, 42);
  assert.deepEqual(item.data.attachments, [7]);
  assert.doesNotMatch(item.data.extra, /Preprint URL:/);
});

test("DOI-free conference metadata is accepted and an absent DOI does not erase user data", async () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    itemType: "conferencePaper",
    proceedingsTitle: "ICLR 2026",
    url: "https://openreview.net/forum?id=accepted",
  });
  item.itemTypeID = 3;
  const { runtime, win, state } = lintFixture(item);
  runtime.finder.find = async () => ({
    candidates: [
      {
        source: "OpenReview",
        title: item.getField("title"),
        authors: ["Zhi Lu"],
        venue: "ICLR 2026",
        url: item.getField("url"),
      },
    ],
    warnings: [],
    answered: 1,
  });
  runtime.retriever.candidate = async () => ({
    ...item.toJSON(),
    abstractNote: "Accepted conference paper",
  });
  await runtime.run(win, "lint");
  assert.equal(item.getField("DOI"), "");
  assert.equal(item.getField("abstractNote"), "Accepted conference paper");
  assert.equal(state.progress.rows[0].status, "Updated");
  assert.deepEqual(item.data.notes, [8]);
});

test("no matching DOI remains a normal no-change result when a publication has no retrieval identifier", async () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    itemType: "conferencePaper",
    proceedingsTitle: "NeurIPS",
    conferenceName: "Conference on Neural Information Processing Systems",
    url: "",
    archiveID: "",
  });
  item.itemTypeID = 3;
  const { runtime, win, state } = lintFixture(item);
  runtime.finder.find = async () => ({
    candidates: [],
    warnings: [],
    answered: 5,
  });
  runtime.retriever.retrieveCurrent = async () => {
    throw new Error("Item has no valid metadata identifier");
  };
  await runtime.run(win, "lint");
  assert.equal(item.saved, 0);
  assert.equal(state.progress.rows[0].status, "No changes");
  assert.match(state.progress.rows[0].detail, /optional/);
});

test("Lint preserves discovery warnings when current metadata succeeds", async () => {
  const { runtime, win, state, item } = lintFixture();
  runtime.finder.find = async () => ({
    candidates: [],
    warnings: ["Crossref: 429"],
    answered: 4,
  });
  await runtime.run(win, "lint");
  assert.equal(item.saved, 1);
  assert.match(state.progress.rows[0].detail, /429/);
  assert.match(state.progress.rows[0].detail, /some sources failed/);
});

test("ambiguous published matches are skipped automatically without fallback or writing", async () => {
  const { runtime, win, state, calls, item } = lintFixture();
  runtime.finder.find = async () => {
    calls.push("find");
    return {
      candidates: [
        {
          source: "Crossref",
          title: item.getField("title"),
          authors: ["Zhi Lu"],
          doi: "10.1000/one",
          venue: "Conference One",
        },
        {
          source: "DBLP",
          title: item.getField("title"),
          authors: ["Zhi Lu"],
          doi: "10.1000/two",
          venue: "Conference Two",
        },
      ],
      warnings: [],
      answered: 2,
    };
  };
  await runtime.run(win, "lint");
  assert.deepEqual(calls, ["find"]);
  assert.equal(item.saved, 0);
  assert.equal(state.progress.rows[0].status, "Skipped");
  assert.match(state.progress.rows[0].detail, /No reliable match/);
});

test("cancelling publication discovery prevents current-metadata fallback and all writes", async () => {
  const { runtime, win, calls, item } = lintFixture();
  runtime.finder.find = async () => {
    calls.push("find");
    runtime.cancel();
    return { candidates: [], warnings: [], answered: 1 };
  };
  await runtime.run(win, "lint");
  assert.deepEqual(calls, ["find"]);
  assert.equal(item.saved, 0);
});

test("invalid published metadata cannot silently trigger a different update", async () => {
  const { runtime, win, calls, item, state } = lintFixture();
  runtime.retriever.candidate = async () => {
    calls.push("published metadata");
    return { ...published, itemType: "preprint" };
  };
  await runtime.run(win, "lint");
  assert.deepEqual(calls, ["find", "published metadata"]);
  assert.equal(item.saved, 0);
  assert.equal(state.progress.rows[0].status, "Failed");
});

test("Lint corrects an existing ECCV book section locally when metadata retrieval fails", async () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    itemType: "bookSection",
    bookTitle: "Computer Vision – ECCV 2024",
    url: "",
    archiveID: "",
    creators: [
      ...item.getCreators(),
      { firstName: "Volume", lastName: "Editor", creatorType: "editor" },
    ],
  });
  item.itemTypeID = 4;
  const { runtime, win, state } = runFixture(item);
  runtime.retriever = {
    retrieveCurrent: async () => {
      throw new Error("No metadata identifier");
    },
  };
  await runtime.run(win, "lint");
  assert.equal(item.itemType, "conferencePaper");
  assert.equal(
    item.getField("proceedingsTitle"),
    "Computer Vision – ECCV 2024",
  );
  assert.ok(
    item.getCreators().every((creator) => creator.creatorType !== "editor"),
  );
  assert.match(state.progress.rows[0].detail, /No metadata identifier/);
  assert.equal(item.id, 42);
  assert.deepEqual(item.data.attachments, [7]);
});

test("Lint applies the Publication switch to a matched ECCV publication and preserves the preprint item", async () => {
  const { runtime, win, state, item } = lintFixture();
  runtime.retriever.candidate = async () => ({
    ...published,
    itemType: "bookSection",
    publicationTitle: undefined,
    bookTitle: "18th European Conference on Computer Vision, ECCV 2024",
    creators: [
      ...published.creators,
      { firstName: "Volume", lastName: "Editor", creatorType: "editor" },
    ],
  });
  globalThis.Zotero.Prefs = {
    get: () =>
      JSON.stringify({
        rules: DEFAULT_CONFERENCE_RULES,
        formatPublication: true,
      }),
  };
  try {
    await runtime.run(win, "lint");
    assert.equal(item.itemType, "conferencePaper");
    assert.equal(
      item.getField("proceedingsTitle"),
      "European Conference on Computer Vision",
    );
    assert.ok(
      item.getCreators().every((creator) => creator.creatorType !== "editor"),
    );
    assert.match(item.data.extra, /Preprint URL:/);
    assert.equal(item.key, "OLDKEY42");
  } finally {
    delete globalThis.Zotero.Prefs;
  }
});

test("preferences only expose naming style while internal conference rules remain intact", async () => {
  const runtime = new Runtime();
  const saved = [];
  const ids = [
    "ml-publication-style",
    "ml-replace-publication",
    "ml-settings-help",
    "ml-publication-label",
    "ml-retrieved-names",
    "ml-standard-names",
    "ml-short-names",
    "ml-publication-help",
  ];
  const elements = Object.fromEntries(
    ids.map((id) => [id, { textContent: "", addEventListener: () => {} }]),
  );
  const settings = {
    rules: DEFAULT_CONFERENCE_RULES,
    formatPublication: false,
    publicationStyle: "original",
  };
  settings.rules = settings.rules.map((rule) =>
    rule.id === "eccv" ? { ...rule, name: "Maintained ECCV name" } : rule,
  );
  globalThis.Zotero.Prefs = {
    get: () => JSON.stringify(settings),
    set: (...args) => saved.push(args),
  };
  try {
    runtime.initializePreferences({
      getElementById: (id) => {
        assert.ok(
          elements[id],
          "Unexpected advanced configuration control: " + id,
        );
        return elements[id];
      },
    });
    runtime.setPublicationStyle("short");
    const stored = JSON.parse(saved[0][1]);
    assert.equal(saved[0][0], CONFERENCE_SETTINGS_PREF);
    assert.equal(stored.publicationStyle, "short");
    assert.equal(stored.rules.length, DEFAULT_CONFERENCE_RULES.length);
    assert.equal(
      stored.rules.find((rule) => rule.id === "eccv").name,
      "Maintained ECCV name",
    );
    const markup = await readFile(
      new URL("../content/preferences.xhtml", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(markup, /ml-conference-rules|button/);
  } finally {
    delete globalThis.Zotero.Prefs;
  }
});

test("conference settings are cached and refresh when the stored preference changes", () => {
  const runtime = new Runtime();
  let stored;
  globalThis.Zotero.Prefs = {
    get: () => stored,
    set: (_key, value) => {
      stored = value;
    },
  };
  try {
    const first = runtime.conferenceSettings();
    assert.equal(first.publicationStyle, "original");
    assert.equal(runtime.conferenceSettings(), first);
    runtime.setPublicationStyle("short");
    assert.equal(runtime.conferenceSettings().publicationStyle, "short");
  } finally {
    delete globalThis.Zotero.Prefs;
  }
});

test("runtime directly applies retrieval without confirmation and reports completion", async () => {
  const item = new FakeItem();
  const { runtime, win, state } = runFixture(item);
  await runtime.run(win, "DOI");
  assert.equal(state.previews, 0);
  assert.equal(item.saved, 1);
  assert.equal(state.progress.finished, true);
  assert.equal(state.progress.rows[0].status, "Updated");
  assert.equal(runtime.busy, false);
});

test("cancelling during retrieval prevents preview and writing after the result arrives", async () => {
  const item = new FakeItem();
  const { runtime, win, state } = runFixture(item);
  runtime.retriever.retrieve = async () => {
    runtime.cancel();
    return published;
  };
  await runtime.run(win, "DOI");
  assert.equal(item.saved, 0);
  assert.equal(state.previews, 0);
  assert.equal(state.progress.cancelled, true);
});

test("a linked DOI cannot bypass verification of translated title and authors", async () => {
  const { runtime, win, item, state } = lintFixture();
  runtime.finder.find = async () => ({
    candidates: [
      { source: "arXiv", title: "", linked: true, doi: "10.1000/wrong" },
    ],
    warnings: [],
    answered: 1,
  });
  runtime.retriever.candidate = async () => ({
    ...published,
    title: "Completely unrelated publication",
  });
  await runtime.run(win, "lint");
  assert.equal(item.saved, 0);
  assert.equal(state.progress.rows[0].status, "Failed");
});

test("cancelled discovery does not dispatch new fallback requests", async () => {
  const runtime = new Runtime();
  runtime.busy = true;
  runtime.operationGeneration = 1;
  runtime.generation = 1;
  runtime.cancel();
  await assert.rejects(
    runtime.request("https://dblp.org/search/publ/api"),
    /Cancelled/,
  );
});

test("menu injection and removal are idempotent and stop removes all windows", () => {
  const runtime = new Runtime();
  const popup = {
    children: [],
    listeners: new Set(),
    appendChild(node) {
      this.children.push(node);
      node.parent = this;
    },
    addEventListener(_, fn) {
      this.listeners.add(fn);
    },
    removeEventListener(_, fn) {
      this.listeners.delete(fn);
    },
  };
  const doc = {
    getElementById: () => popup,
    createXULElement: (tagName) => ({
      tagName,
      attributes: {},
      children: [],
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener() {},
      appendChild(node) {
        this.children.push(node);
      },
      remove() {
        this.parent.children = this.parent.children.filter(
          (node) => node !== this,
        );
      },
    }),
  };
  const win = { document: doc };
  runtime.inject(win);
  runtime.inject(win);
  assert.equal(popup.children.length, 1);
  assert.equal(popup.children[0].tagName, "menuitem");
  assert.equal(popup.children[0].children.length, 0);
  assert.equal(
    popup.children[0].attributes.image,
    "file:///test/icons/icon-16.png",
  );
  assert.equal(popup.listeners.size, 1);
  runtime.stop();
  runtime.stop();
  assert.equal(popup.children.length, 0);
  assert.equal(popup.listeners.size, 0);
  runtime.inject(win);
  assert.equal(popup.children.length, 0);
});

test("bootstrap does not initialize after shutdown while Zotero startup is pending", async () => {
  const code = await readFile(
    new URL("../bootstrap.js", import.meta.url),
    "utf8",
  );
  let resolve;
  let registrations = 0;
  const init = new Promise((done) => {
    resolve = done;
  });
  const context = {
    Zotero: { initializationPromise: init },
    Services: {},
    setTimeout,
    clearTimeout,
    Components: {
      classes: {
        "@mozilla.org/addons/addon-manager-startup;1": {
          getService: () => {
            registrations++;
          },
        },
      },
      interfaces: {},
    },
  };
  runInNewContext(code, context);
  const running = context.startup({ rootURI: "file:///test/" });
  context.shutdown();
  resolve();
  await running;
  assert.equal(registrations, 0);
});

test("bootstrap repeats startup safely and releases chrome registration on shutdown", async () => {
  const code = await readFile(
    new URL("../bootstrap.js", import.meta.url),
    "utf8",
  );
  let starts = 0,
    stopped = 0,
    removed = 0;
  const context = {
    setTimeout,
    clearTimeout,
    Zotero: {
      initializationPromise: Promise.resolve(),
      logError: (error) => {
        throw error;
      },
    },
    Components: {
      classes: {
        "@mozilla.org/addons/addon-manager-startup;1": {
          getService: () => ({
            registerChrome: () => ({ destruct: () => removed++ }),
          }),
        },
      },
      interfaces: {},
    },
    Services: {
      io: { newURI: (uri) => uri },
      scriptloader: {
        loadSubScript: (_, scope) => {
          scope.MetadataLinter = {
            start: () => {
              starts++;
              return { stop: () => stopped++ };
            },
          };
        },
      },
    },
  };
  runInNewContext(code, context);
  await context.startup({ rootURI: "file:///test/" });
  await context.startup({ rootURI: "file:///test/" });
  context.shutdown();
  context.shutdown();
  assert.equal(starts, 1);
  assert.equal(stopped, 1);
  assert.equal(removed, 1);
});

test("dialog loading does not cancel an operation; only unloading the real dialog resolves it", async () => {
  const runtime = new Runtime();
  let unload;
  const document = {
    documentURI: "chrome://metadata-linter/content/dialog.xhtml",
  };
  const dialog = {
    document,
    addEventListener: (name, run) => {
      if (name === "unload") unload = run;
    },
  };
  const opened = runtime.open(
    { openDialog: () => dialog },
    { kind: "progress" },
  );
  let resolved = false;
  opened.result.then(() => {
    resolved = true;
  });
  unload({ target: { documentURI: "about:blank" } });
  await Promise.resolve();
  assert.equal(resolved, false);
  unload({ target: document });
  await Promise.resolve();
  assert.equal(resolved, true);
});

test("repeating the action while busy does not cancel; explicit cancellation clears running row statuses", async () => {
  const item = new FakeItem();
  const { runtime, win, state } = lintFixture(item);
  let finish;
  runtime.finder.find = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const running = runtime.run(win, "lint");
  await runtime.run(win, "lint");
  assert.equal(runtime.generation, 1);
  assert.equal(state.progress.rows[0].status, "Updating…");
  runtime.cancel();
  assert.equal(state.progress.rows[0].status, "Cancelled");
  finish({ candidates: [], warnings: [] });
  await running;
  assert.equal(state.progress.cancelled, true);
  assert.equal(item.saved, 0);
});

test("exact source records with missing authors are checked against the translated authors before writing", async () => {
  const { runtime, win, item, state } = lintFixture();
  runtime.finder.find = async () => ({
    candidates: [
      {
        source: "Crossref",
        title: item.getField("title"),
        doi: published.DOI,
        venue: published.publicationTitle,
      },
    ],
    warnings: [],
    answered: 1,
  });
  runtime.retriever.candidate = async () => ({
    ...published,
    creators: [{ lastName: "Other", creatorType: "author" }],
  });
  await runtime.run(win, "lint");
  assert.equal(item.saved, 0);
  assert.equal(state.progress.rows[0].status, "Failed");
});
test("published repair preserves populated fields and fixes a known incorrect conference while naming is off", async () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    itemType: "conferencePaper",
    title: published.title,
    DOI: "10.1000/actual",
    proceedingsTitle: "ECCV 2024",
    conferenceName: "ECCV",
    publisher: "My Custom Publisher",
    abstractNote: "My Custom Abstract",
  });
  item.itemTypeID = 3;
  const { runtime, win } = runFixture(item);
  runtime.retriever.retrieveCurrent = async () => ({
    metadata: {
      ...item.toJSON(),
      proceedingsTitle: "CVPR 2024",
      conferenceName: "CVPR",
      publisher: "IEEE",
      abstractNote: "Source abstract",
    },
    source: "DOI",
    warnings: [],
  });
  await runtime.run(win, "lint");
  assert.equal(item.getField("proceedingsTitle"), "CVPR 2024");
  assert.equal(item.getField("publisher"), "My Custom Publisher");
  assert.equal(item.getField("abstractNote"), "My Custom Abstract");
});

test("cancel releases the busy operation while its translator is still pending", async () => {
  const item = new FakeItem();
  const { runtime, win } = runFixture(item);
  let finish;
  runtime.retriever.retrieve = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const running = runtime.run(win, "DOI");
  runtime.cancel();
  await running;
  assert.equal(runtime.busy, false);
  runtime.retriever.retrieve = async () => published;
  runtime.host = (token) => ({
    ...hostFor(item),
    active: () => runtime.alive && runtime.generation === token,
  });
  await runtime.run(win, "DOI");
  assert.equal(item.saved, 1);
  const savedTitle = item.getField("title");
  finish({ ...published, title: "Late stale result" });
  await Promise.resolve();
  assert.equal(item.getField("title"), savedTitle);
  assert.equal(item.saved, 1);
});

test("closing the owning main window cancels its task, but another window does not", async () => {
  const item = new FakeItem();
  const { runtime, win } = runFixture(item);
  runtime.retriever.retrieve = () => new Promise(() => {});
  const running = runtime.run(win, "DOI");
  runtime.remove({});
  assert.equal(runtime.operation.active(), true);
  runtime.remove(win);
  await running;
  assert.equal(runtime.busy, false);
  assert.equal(item.saved, 0);
});

test("network cancellation invokes Zotero's request canceller and refuses late fallback requests", async () => {
  const { runtime } = runFixture(new FakeItem());
  const { Operation } = await import("../.tests-build/operation.js");
  const operation = new Operation();
  runtime.busy = true;
  runtime.operationGeneration = runtime.generation;
  let cancelled = 0;
  globalThis.Zotero.HTTP = {
    request: (_, __, options) => {
      options.cancellerReceiver(() => cancelled++);
      return new Promise(() => {});
    },
  };
  try {
    const request = runtime.request("https://example.test", operation);
    const shared = runtime.request("https://example.test", operation);
    const rejected = Promise.all([
      assert.rejects(request, /cancelled/),
      assert.rejects(shared, /cancelled/),
    ]);
    operation.cancel();
    await rejected;
    assert.equal(cancelled, 1);
    await assert.rejects(
      runtime.request("https://example.test/fallback", operation),
      /Cancelled/,
    );
    assert.equal(cancelled, 1);
  } finally {
    delete globalThis.Zotero.HTTP;
  }
});

test("failed progress-window creation does not leave the operation busy", async () => {
  const { runtime, win } = runFixture(new FakeItem());
  runtime.open = () => {
    throw new Error("Window closed");
  };
  await runtime.run(win, "DOI");
  assert.equal(runtime.busy, false);
  assert.equal(runtime.operation, undefined);
});

test("stop finishes cleanup even if one window fails to remove its menu", () => {
  const runtime = new Runtime();
  let removed = 0;
  runtime.windows.set({}, () => {
    throw new Error("Window disappeared");
  });
  runtime.windows.set({}, () => removed++);
  runtime.stop();
  assert.equal(removed, 1);
  assert.equal(runtime.windows.size, 0);
});

test("bootstrap deduplicates pending startup and quit cancels readiness immediately", async () => {
  const code = await readFile(
    new URL("../bootstrap.js", import.meta.url),
    "utf8",
  );
  let observer,
    removed = 0;
  const context = {
    setTimeout,
    clearTimeout,
    Zotero: { initializationPromise: new Promise(() => {}), logError() {} },
    Services: {
      obs: {
        addObserver: (value) => {
          observer = value;
        },
        removeObserver: () => removed++,
      },
    },
  };
  runInNewContext(code, context);
  const first = context.startup({ rootURI: "file:///test/" });
  assert.equal(context.startup({ rootURI: "file:///test/" }), first);
  observer.observe();
  await first;
  assert.equal(removed, 1);
  assert.equal(context.MLRuntime, null);
  assert.equal(context.MLStartup, null);
});

test("pending preference registration is deduplicated and unregistered after stop", async () => {
  const runtime = new Runtime();
  let resolve,
    registrations = 0;
  const removed = [];
  globalThis.Zotero.PreferencePanes = {
    register: () => {
      registrations++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    unregister: (id) => removed.push(id),
  };
  try {
    runtime.registerPreferences();
    runtime.registerPreferences();
    runtime.stop();
    resolve("late-pane");
    await Promise.resolve();
    assert.equal(registrations, 1);
    assert.deepEqual(removed, ["late-pane"]);
    assert.equal(globalThis.Zotero.MetadataLinter, undefined);
  } finally {
    delete globalThis.Zotero.PreferencePanes;
  }
});

test("one batch updates selected editable papers and continues after an item fails", async () => {
  const items = Array.from({ length: 4 }, (_, index) => {
    const item = new FakeItem();
    item.id = index + 1;
    item.key = `BATCH${index}`;
    Object.assign(item.data, published);
    item.itemTypeID = 2;
    delete item.data.abstractNote;
    return item;
  });
  items[3].editable = false;
  const { runtime, win, state } = runFixture(items[0]);
  win.ZoteroPane.getSelectedItems = () => items;
  const calls = [];
  runtime.retriever = {
    retrieveCurrent: async (item) => {
      calls.push(item.id);
      if (item.id === 2) throw new Error("Offline");
      return {
        metadata: { ...item.toJSON(), abstractNote: "Filled" },
        source: "DOI",
        warnings: [],
      };
    },
  };
  await runtime.run(win, "lint");
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(
    items.map((item) => item.saved),
    [1, 0, 1, 0],
  );
  assert.equal(state.progress.total, 3);
  assert.deepEqual(
    state.progress.rows.map((row) => row.status),
    ["Updated", "Failed", "Updated"],
  );
  assert.equal(state.previews, 0);
  assert.equal(state.progress.finished, true);
});

test("cancelling a batch stops unstarted papers and ignores the pending result", async () => {
  const items = [new FakeItem(), new FakeItem(), new FakeItem()];
  items.forEach((item, index) => {
    item.id = index + 1;
  });
  const { runtime, win, state } = runFixture(items[0]);
  win.ZoteroPane.getSelectedItems = () => items;
  let finish,
    calls = 0;
  runtime.retriever.retrieve = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const running = runtime.run(win, "DOI");
  runtime.cancel();
  await running;
  finish(published);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(
    state.progress.rows.map((row) => row.status),
    ["Cancelled", "Cancelled", "Cancelled"],
  );
  assert.equal(state.progress.total, 3);
  assert.deepEqual(
    items.map((item) => item.saved),
    [0, 0, 0],
  );
  assert.equal(runtime.busy, false);
});

test("a preprint already carrying a published DOI skips title discovery and upgrades in place", async () => {
  const { runtime, win, calls, item } = lintFixture();
  item.data.DOI = published.DOI;
  runtime.retriever.candidate = async (candidate) => {
    assert.equal(candidate.doi, published.DOI);
    calls.push("DOI");
    return published;
  };
  await runtime.run(win, "lint");
  assert.deepEqual(calls, ["DOI"]);
  assert.equal(item.itemType, "journalArticle");
  assert.equal(item.id, 42);
});

test("successful retrieval still repairs a proceedings value misplaced in the old conference field", async () => {
  for (const publicationStyle of ["original", "standard", "short"]) {
    const item = new FakeItem();
    Object.assign(item.data, {
      itemType: "conferencePaper",
      DOI: published.DOI,
      proceedingsTitle:
        "Conference on computer vision and pattern recognition 2026",
      conferenceName:
        "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
      date: "2026",
    });
    item.itemTypeID = 3;
    const { runtime, win, state } = runFixture(item);
    runtime.retriever = {
      retrieveCurrent: async () => ({
        metadata: {
          itemType: "conferencePaper",
          title: item.getField("title").toUpperCase(),
          DOI: published.DOI,
          proceedingsTitle:
            "Conference on computer vision and pattern recognition 2026",
          conferenceName: "CVPR",
          creators: item.getCreators(),
        },
        warnings: [],
        source: "DOI",
      }),
    };
    globalThis.Zotero.Prefs = {
      get: () =>
        JSON.stringify({
          rules: DEFAULT_CONFERENCE_RULES,
          formatPublication: publicationStyle !== "original",
          publicationStyle,
        }),
    };
    try {
      await runtime.run(win, "lint");
      assert.equal(
        item.getField("proceedingsTitle"),
        publicationStyle === "short"
          ? "CVPR"
          : "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
      );
      assert.equal(
        item.getField("conferenceName"),
        "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
      );
      assert.equal(item.getField("title"), "Learning useful representations");
      assert.equal(state.progress.rows[0].status, "Updated");
    } finally {
      delete globalThis.Zotero.Prefs;
    }
  }
});

test("official DOI-free publication metadata updates in place without broad search", async () => {
  const item = new FakeItem();
  item.data.url = "https://openreview.net/forum?id=accepted";
  const { runtime, win, state } = lintFixture(item);
  const { PublicationFinder } = await import("../.tests-build/providers.js");
  runtime.finder = new PublicationFinder({});
  runtime.finder.openreview = async () => [
    {
      source: "OpenReview",
      title: item.getField("title"),
      authors: ["Zhi Lu"],
      venue: "ICLR 2026",
      url: item.getField("url"),
      bibtex: "@inproceedings{accepted}",
    },
  ];
  runtime.finder.googleScholar = async () => {
    throw new Error("Must not search");
  };
  let translated = 0;
  runtime.retriever.candidate = async () => {
    translated++;
    return {
      ...published,
      itemType: "conferencePaper",
      DOI: undefined,
      proceedingsTitle: "ICLR 2026",
    };
  };
  await runtime.run(win, "lint");
  assert.equal(translated, 1);
  assert.equal(item.itemType, "conferencePaper");
  assert.equal(item.getField("DOI"), "");
  assert.equal(item.id, 42);
  assert.equal(state.progress.rows[0].status, "Updated");
});

test("an exact PMID is retrieved before title search when DOI is missing", async () => {
  const { runtime, win, item, calls } = lintFixture();
  item.data.extra += "\nPMID: 123456";
  runtime.retriever.retrieve = async (_, source) => {
    calls.push(source);
    return published;
  };
  await runtime.run(win, "lint");
  assert.deepEqual(calls, ["PMID"]);
  assert.equal(item.getField("DOI"), published.DOI);
  assert.equal(item.itemType, "journalArticle");
});

test("unaccepted or mismatched official records cannot bypass publication validation", async () => {
  for (const change of [
    { proceedingsTitle: "Submitted to ICLR 2026", publicationTitle: "" },
    { creators: [{ lastName: "Smith", creatorType: "author" }] },
    { title: "Unrelated official paper" },
  ]) {
    const item = new FakeItem();
    item.data.url = "https://ieeexplore.ieee.org/document/12345678";
    const { runtime, win } = lintFixture(item);
    const { PublicationFinder } = await import("../.tests-build/providers.js");
    const finder = new PublicationFinder({});
    finder.related = async () => [];
    finder.googleScholar = async () => [];
    finder.semanticScholar =
      finder.crossref =
      finder.dblp =
      finder.pubmed =
      finder.openreview =
        async () => [];
    runtime.finder = finder;
    runtime.retriever.candidate = async () => ({
      ...published,
      DOI: undefined,
      itemType: "conferencePaper",
      proceedingsTitle: "ICLR 2026",
      ...change,
    });
    await runtime.run(win, "lint");
    assert.equal(item.itemType, "preprint");
    assert.equal(item.getField("DOI"), "");
  }
});

test("new selections share one queue and completed results remain until the window closes", async () => {
  const items = [new FakeItem(), new FakeItem(), new FakeItem()];
  items.forEach((item, index) => {
    item.id = index + 1;
    Object.assign(item.data, published);
    item.itemTypeID = 2;
    delete item.data.abstractNote;
  });
  const { runtime, win, state } = runFixture(items[0]);
  runtime.host = (token) => ({
    ...hostFor(items[0]),
    active: () => runtime.alive && runtime.generation === token,
  });
  let opened = 0,
    dialog,
    release;
  const originalOpen = runtime.open;
  runtime.open = (...args) => {
    opened++;
    const result = originalOpen(...args);
    dialog = result.window;
    let resolveClose;
    result.result = new Promise((resolve) => {
      resolveClose = resolve;
    });
    result.window.close = () => {
      result.window.closed = true;
      resolveClose();
    };
    return result;
  };
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  runtime.retriever = {
    retrieveCurrent: async (item) => {
      calls.push(item.id);
      if (item.id === 1) await gate;
      if (item.id === 3) {
        assert.deepEqual(
          state.progress.rows.map((row) => row.status),
          ["Updated", "Updated", "Updating…"],
        );
        assert.equal(dialog.closed, false);
      }
      return {
        metadata: { ...item.toJSON(), abstractNote: "Filled" },
        source: "DOI",
        warnings: [],
      };
    },
  };
  const running = runtime.run(win, "lint");
  const otherWindow = { ZoteroPane: { getSelectedItems: () => items } };
  await runtime.run(otherWindow, "lint");
  await runtime.run(otherWindow, "lint");
  assert.equal(opened, 1);
  assert.equal(state.progress.total, 3);
  assert.deepEqual(
    state.progress.rows.map((row) => row.status),
    ["Updating…", "Waiting", "Waiting"],
  );
  release();
  await running;
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(dialog.closed, false);
  assert.equal(runtime.progressWindow, dialog);
  await runtime.run(win, "lint");
  assert.equal(opened, 1);
  assert.equal(dialog.closed, false);
  assert.equal(state.progress.rows.length, 4);
  assert.equal(state.progress.rows[3].status, "No changes");
  assert.deepEqual(
    state.progress.rows.slice(0, 3).map((row) => row.status),
    ["Updated", "Updated", "Updated"],
  );
  dialog.close();
  await runtime.run(win, "lint");
  assert.equal(opened, 2);
  assert.equal(state.progress.rows.length, 1);
  runtime.retriever.retrieveCurrent = () => new Promise(() => {});
  const cancelling = runtime.run(win, "lint");
  assert.equal(opened, 2);
  dialog.close();
  await cancelling;
  assert.equal(state.progress.rows[1].status, "Cancelled");
  assert.equal(runtime.busy, false);
  assert.equal(runtime.progressWindow, undefined);
});

test("DMLNet official IEEE metadata fills DOI despite compound-word title differences", async () => {
  const paper = new FakeItem();
  Object.assign(paper.data, {
    itemType: "journalArticle",
    title:
      "DMLNet: Differential Saliency with Multi-Domain Learning Network for Moving Infrared Small Target Detection",
    date: "2026-00-00 2026",
    url: "https://ieeexplore.ieee.org/abstract/document/11592444/",
    archiveID: "",
    extra: "",
    publicationTitle: "IEEE Geoscience and Remote Sensing Letters",
    creators: [
      { firstName: "Zhenming", lastName: "Peng", creatorType: "author" },
    ],
  });
  paper.itemTypeID = 2;
  const originalTitle = paper.data.title;
  const { runtime, win, state } = runFixture(paper);
  runtime.finder = {
    find: async (item, preprint, resolve) => {
      const candidate = {
        source: "URL",
        title: item.getField("title"),
        url: item.getField("url"),
      };
      assert.equal(await resolve(candidate), true);
      return { candidates: [candidate], warnings: [], answered: 1 };
    },
  };
  runtime.retriever = {
    candidate: async () => ({
      itemType: "journalArticle",
      title:
        "DMLNet: Differential Saliency With Multidomain Learning Network for Moving Infrared Small-Target Detection",
      DOI: "10.1109/LGRS.2026.3708839",
      publicationTitle: paper.data.publicationTitle,
      creators: [
        { firstName: "Yi", lastName: "Rong", creatorType: "author" },
        ...paper.getCreators(),
      ],
    }),
  };
  await runtime.run(win, "lint");
  assert.equal(paper.getField("DOI"), "10.1109/LGRS.2026.3708839");
  assert.equal(paper.getField("title"), originalTitle);
  assert.equal(state.progress.rows[0].status, "Updated");
});

test("a batch shares pending and completed text responses but isolates documents and later batches", async () => {
  const { runtime } = runFixture(new FakeItem());
  const { Operation } = await import("../.tests-build/operation.js");
  const operation = new Operation();
  runtime.busy = true;
  runtime.operationGeneration = runtime.generation;
  let calls = 0;
  let resolve;
  globalThis.Zotero.HTTP = {
    request: () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    wrapDocument: (doc) => doc,
  };
  try {
    const first = runtime.request("https://example.test", operation);
    const second = runtime.request("https://example.test", operation);
    assert.equal(calls, 1);
    resolve({ responseText: "metadata" });
    assert.deepEqual(await Promise.all([first, second]), [
      "metadata",
      "metadata",
    ]);
    assert.equal(
      await runtime.request("https://example.test", operation),
      "metadata",
    );
    assert.equal(calls, 1);
    globalThis.Zotero.HTTP.request = async () => {
      calls++;
      return { responseText: "fresh", response: {} };
    };
    await runtime.request("https://example.test", new Operation());
    assert.equal(calls, 2);
    await runtime.request("https://example.test", operation, "document");
    await runtime.request("https://example.test", operation, "document");
    assert.equal(calls, 4);
    operation.cancel();
    await assert.rejects(
      runtime.request("https://example.test", operation),
      /Cancelled/,
    );
  } finally {
    delete globalThis.Zotero.HTTP;
  }
});

test("failed text responses are retried within a batch", async () => {
  const { runtime } = runFixture(new FakeItem());
  const { Operation } = await import("../.tests-build/operation.js");
  const operation = new Operation();
  runtime.busy = true;
  runtime.operationGeneration = runtime.generation;
  let calls = 0;
  globalThis.Zotero.HTTP = {
    request: async () => {
      if (++calls === 1) throw new Error("Temporary failure");
      return { responseText: "recovered" };
    },
  };
  try {
    await assert.rejects(
      runtime.request("https://example.test", operation),
      /Temporary/,
    );
    assert.equal(
      await runtime.request("https://example.test", operation),
      "recovered",
    );
    assert.equal(calls, 2);
  } finally {
    delete globalThis.Zotero.HTTP;
  }
});

test("publication column registration is idempotent and removed on stop", () => {
  const previous = Zotero.ItemTreeManager;
  const registered = [],
    removed = [];
  Zotero.ItemTreeManager = {
    registerColumn(options) {
      registered.push(options);
      return "host-publication-short";
    },
    unregisterColumn(key) {
      removed.push(key);
    },
  };
  try {
    const runtime = new Runtime();
    runtime.registerPublicationColumn();
    runtime.registerPublicationColumn();
    assert.equal(registered.length, 1);
    const item = new FakeItem();
    item.data.itemType = "journalArticle";
    item.data.publicationTitle = "IEEE Transactions on Multimedia";
    assert.equal(registered[0].dataProvider(item), "TMM");
    item.data.publicationTitle = "Uncommon Journal";
    assert.equal(registered[0].dataProvider(item), "Uncommon Journal");
    assert.equal(
      registered[0].dataProvider({ isRegularItem: () => false }),
      "",
    );
    runtime.stop();
    runtime.stop();
    runtime.registerPublicationColumn();
    assert.deepEqual(removed, ["host-publication-short"]);
    assert.equal(registered.length, 1);
  } finally {
    Zotero.ItemTreeManager = previous;
  }
});
