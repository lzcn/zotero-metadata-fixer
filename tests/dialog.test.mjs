import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { en, zh } from "../.tests-build/strings.js";

class Element {
  children = [];
  events = new Map();
  classList = { add() {}, toggle() {} };
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  replaceChildren(...children) {
    this.children = children;
  }
  addEventListener(name, run) {
    this.events.set(name, run);
  }
  setAttribute(name, value) {
    this[name] = value;
  }
  getBoundingClientRect() {
    return { height: 40 };
  }
  focus() {
    this.focused = true;
  }
  querySelector() {
    return new Element();
  }
}
async function dialog(data, screen = { availWidth: 1440, availHeight: 900 }) {
  const content = new Element(),
    actions = new Element(),
    summary = new Element(),
    progress = new Element();
  summary.getBoundingClientRect = () => ({ height: 18 });
  progress.getBoundingClientRect = () => ({ height: 6 });
  let props,
    unmounted = false;
  const nativeTable = {
    _rowHeight: 28,
    _getColumns: () => props.columns,
    invalidate() {
      content.replaceChildren(
        ...Array.from({ length: props.getRowCount() }, (_, index) =>
          props.renderItem(
            index,
            { isSelected: () => false },
            null,
            props.columns,
          ),
        ),
      );
    },
  };
  const frames = new Map();
  let frameID = 0;
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame();
  };
  const win = {
    arguments: [data],
    screen,
    innerWidth: 1000,
    innerHeight: 600,
    outerWidth: 1000,
    outerHeight: 628,
    events: new Map(),
    close() {
      this.closed = true;
    },
    addEventListener(name, run) {
      this.events.set(name, run);
    },
    requestAnimationFrame(run) {
      frames.set(++frameID, run);
      return frameID;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    resizeBy(dx, dy) {
      this.innerWidth += dx;
      this.innerHeight += dy;
      this.outerWidth += dx;
      this.outerHeight += dy;
    },
    moveTo(x, y) {
      this.position = [x, y];
    },
  };
  const document = {
    body: new Element(),
    createElement: () => new Element(),
    createElementNS: (namespace) => Object.assign(new Element(), { namespace }),
    getElementById: (id) => ({ content, actions, summary, progress })[id],
  };
  const modules = {
    react: { createElement: (component, options) => options },
    "react-dom": {
      createRoot: () => ({
        render(options) {
          props = options;
          nativeTable.invalidate();
          props.ref(nativeTable);
        },
        unmount() {
          unmounted = true;
        },
      }),
    },
    "components/virtualized-table": {
      renderCell(index, text) {
        return Object.assign(new Element(), { textContent: text });
      },
    },
  };
  runInNewContext(
    await readFile(new URL("../content/dialog.js", import.meta.url), "utf8"),
    {
      window: win,
      document,
      require: (id) => modules[id],
      Zotero: { isMac: true, UIProperties: { registerRoot() {} } },
    },
  );
  flushFrames();
  return {
    content,
    actions,
    summary,
    progress,
    win,
    props,
    flushFrames,
    pendingFrames: () => frames.size,
    unmounted: () => unmounted,
  };
}

test("native progress shows concise results with diagnostic details on hover", async () => {
  let cancelled = 0;
  const state = {
    total: 12,
    finished: false,
    rows: [
      { title: "First", status: en.updated },
      {
        title: "Second",
        status: en.failed,
        problem: en.rateLimited,
        detail: "Long HTTP error",
      },
      { title: "Current paper", status: en.working },
    ],
    strings: en,
    cancel: () => cancelled++,
    onResult() {},
  };
  const ui = await dialog(state);
  assert.equal(ui.props.showHeader, true);
  assert.equal(ui.summary.textContent, "2 / 3");
  assert.match(ui.summary.title, /2 \/ 3.*1 updated.*1 failed/);
  assert.equal(ui.progress.value, 2);
  assert.deepEqual(
    Array.from(ui.props.columns, (column) => column.label),
    [en.title, en.status],
  );
  assert.deepEqual(
    ui.content.children[1].children.map((cell) => cell.textContent),
    ["Second", en.failed],
  );
  assert.equal(
    ui.content.children[1].children[1].title,
    "Metadata: Failed\nRate-limited\nLong HTTP error",
  );
  let stopped = false;
  ui.content.children[1].children[1].events.get("mouseover")({
    stopPropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  assert.equal(ui.actions.children.length, 1);
  assert.equal(ui.actions.children[0].label, en.cancel);
  assert.equal(
    ui.actions.children[0].namespace,
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
  );
  ui.actions.children[0].events.get("command")();
  assert.equal(cancelled, 1);
  state.rows[2].status = en.updated;
  state.rows.push({ title: "Last", status: en.noChanges });
  state.finished = true;
  ui.win.renderProgress();
  ui.flushFrames();
  assert.equal(ui.content.children.length, 4);
  assert.equal(ui.summary.textContent, "Done · 4 / 4");
  assert.match(ui.summary.title, /Done.*4 \/ 4.*2 updated.*1 failed/);
  assert.equal(ui.progress.hidden, true);
  assert.equal(ui.content.children[2].children[1].textContent, en.updated);
  assert.equal(ui.actions.children[0].label, en.close);
  ui.win.events.get("unload")();
  assert.equal(ui.unmounted(), true);
});

test("clicking a result row selects its item in Zotero", async () => {
  const selected = [];
  const state = {
    rows: [
      { itemID: 42, title: "First", status: en.updated },
      { title: "Second", status: en.failed },
    ],
    strings: en,
    selectItem: (itemID) => selected.push(itemID),
    cancel() {},
    onResult() {},
  };
  const ui = await dialog(state);
  ui.content.children[0].onclick();
  assert.deepEqual(selected, [42]);
  assert.equal(ui.content.children[1].onclick, null);
});

test("native sorting affects display without reordering processing", async () => {
  const state = {
    rows: [
      { title: "Zulu", status: en.waiting },
      { title: "Alpha", status: en.failed, problem: en.rateLimited },
      { title: "Beta", status: en.updated, problem: en.sourceBlocked },
    ],
    strings: en,
    cancel() {},
    onResult() {},
  };
  const original = [...state.rows];
  const ui = await dialog(state);
  const titles = () =>
    ui.content.children.map((row) => row.children[0].textContent);
  ui.props.onColumnSort(0, 1);
  ui.flushFrames();
  assert.deepEqual(titles(), ["Alpha", "Beta", "Zulu"]);
  ui.props.onColumnSort(0, -1);
  ui.flushFrames();
  assert.deepEqual(titles(), ["Zulu", "Beta", "Alpha"]);
  ui.props.onColumnSort(1, 1);
  ui.flushFrames();
  assert.deepEqual(titles(), ["Alpha", "Beta", "Zulu"]);
  state.rows[0].status = en.cancelled;
  ui.win.renderProgress();
  ui.flushFrames();
  assert.deepEqual(titles(), ["Zulu", "Alpha", "Beta"]);
  assert.deepEqual(state.rows, original);
});

test("initial window fits rows and available screen without resizing on updates", async () => {
  const state = {
    rows: [{ title: "Paper" }],
    strings: en,
    cancel() {},
    onResult() {},
  };
  const single = await dialog(state);
  const batch = await dialog({ ...state, total: 100 });
  assert.equal(single.win.innerWidth, 780);
  assert.ok(single.win.innerHeight >= 180 && single.win.innerHeight < 300);
  assert.ok(
    batch.win.innerHeight > single.win.innerHeight &&
      batch.win.innerHeight < 450,
  );
  single.win.innerWidth = 1000;
  single.win.renderProgress();
  assert.equal(single.win.innerWidth, 1000);
  const small = await dialog(state, { availWidth: 640, availHeight: 400 });
  assert.ok(small.win.outerWidth < 640 && small.win.outerHeight < 400);
});

test("progress coalesces redraws and platform shortcuts preserve IME and cancel on close", async () => {
  let cancelled = 0;
  const state = {
    rows: [{ title: "Before" }],
    strings: en,
    finished: false,
    cancel: () => cancelled++,
    onResult() {},
  };
  const ui = await dialog(state);
  state.rows[0].title = "After";
  ui.win.renderProgress();
  ui.win.renderProgress();
  ui.win.renderProgress();
  assert.equal(ui.pendingFrames(), 1);
  assert.equal(ui.content.children[0].children[0].textContent, "Before");
  ui.flushFrames();
  assert.equal(ui.content.children[0].children[0].textContent, "After");
  const keydown = ui.win.events.get("keydown");
  const key = (options) => ({ key: "w", preventDefault() {}, ...options });
  keydown(key({ ctrlKey: true }));
  keydown(key({ metaKey: true, isComposing: true }));
  assert.equal(ui.win.closed, undefined);
  keydown(key({ metaKey: true }));
  assert.equal(cancelled, 1);
  assert.equal(ui.win.closed, true);
  ui.win.renderProgress();
  ui.win.events.get("unload")();
  assert.equal(ui.pendingFrames(), 0);
});

test("reused batch history keeps cancelled rows out of the processed count", async () => {
  const state = {
    rows: [
      { title: "Earlier cancellation", status: en.cancelled },
      { title: "Current update", status: en.updated },
      { title: "Failed source", status: en.failed },
    ],
    strings: en,
    finished: true,
    cancel() {},
    onResult() {},
  };
  const ui = await dialog(state);
  assert.equal(ui.summary.textContent, "Done · 2 / 3");
  assert.match(ui.summary.title, /Done.*2 \/ 3.*1 updated.*1 failed/);
  assert.equal(ui.progress.value, 2);
  assert.equal(ui.progress.hidden, true);
});

test("metadata and PDF outcomes render separately with localized, deduplicated details", async () => {
  for (const s of [en, zh]) {
    const pdfProblem = s.pdfUnavailableReason.replace(
      "{reason}",
      s.sourceBlocked,
    );
    const state = {
      total: 2,
      finished: true,
      rows: [
        {
          title: "Blocked PDF",
          status: s.noChanges,
          pdfStatus: pdfProblem,
          detail: `${pdfProblem}\nHTTP 403`,
        },
        { title: "New PDF", status: s.noChanges, pdfStatus: s.pdfUpdated },
      ],
      strings: s,
      cancel() {},
      onResult() {},
    };
    const ui = await dialog(state);
    const cell = ui.content.children[0].children[1];
    assert.equal(cell.textContent, `${s.noChanges} · ${pdfProblem}`);
    assert.equal(
      cell.title,
      [
        s.metadataResult.replace("{status}", s.noChanges),
        pdfProblem,
        "HTTP 403",
      ].join("\n"),
    );
    assert.ok(
      ui.summary.title.includes(
        s.progressFinished
          .replace("{completed}", "2")
          .replace("{total}", "2")
          .replace("{updated}", "1")
          .replace("{failed}", "0"),
      ),
    );
  }
});
