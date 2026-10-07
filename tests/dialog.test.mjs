import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { en } from "../.tests-build/strings.js";

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
  querySelector() {
    return new Element();
  }
}
async function dialog(data, screen = { availWidth: 1440, availHeight: 900 }) {
  const content = new Element(),
    actions = new Element();
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
  const win = {
    arguments: [data],
    screen,
    innerWidth: 1000,
    innerHeight: 600,
    outerWidth: 1000,
    outerHeight: 628,
    events: new Map(),
    close() {},
    addEventListener(name, run) {
      this.events.set(name, run);
    },
    requestAnimationFrame(run) {
      run();
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
    getElementById: (id) => ({ content, actions })[id],
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
      Zotero: { UIProperties: { registerRoot() {} } },
    },
  );
  return { content, actions, win, props, unmounted: () => unmounted };
}

test("native progress keeps problems, live results and a single action", async () => {
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
  assert.deepEqual(
    Array.from(ui.props.columns, (column) => column.label),
    [en.title, en.status, en.problem],
  );
  assert.deepEqual(
    ui.content.children[1].children.map((cell) => cell.textContent),
    ["Second", en.failed, en.rateLimited],
  );
  assert.equal(ui.content.children[1].children[2].title, "Long HTTP error");
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
  assert.equal(ui.content.children.length, 4);
  assert.equal(ui.content.children[2].children[1].textContent, en.updated);
  assert.equal(ui.actions.children[0].label, en.close);
  ui.win.events.get("unload")();
  assert.equal(ui.unmounted(), true);
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
  assert.deepEqual(titles(), ["Alpha", "Beta", "Zulu"]);
  ui.props.onColumnSort(0, -1);
  assert.deepEqual(titles(), ["Zulu", "Beta", "Alpha"]);
  ui.props.onColumnSort(1, 1);
  assert.deepEqual(titles(), ["Alpha", "Beta", "Zulu"]);
  state.rows[0].status = en.cancelled;
  ui.win.renderProgress();
  assert.deepEqual(titles(), ["Zulu", "Alpha", "Beta"]);
  ui.props.onColumnSort(2, 1);
  assert.equal(titles().at(-1), "Zulu");
  ui.props.onColumnSort(2, -1);
  assert.equal(titles().at(-1), "Zulu");
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
  assert.ok(single.win.innerHeight >= 180 && single.win.innerHeight < 260);
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
