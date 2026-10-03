import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { en } from "../.tests-build/strings.js";

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.textContent = "";
    this.events = new Map();
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  replaceChildren() {
    this.children = [];
  }
  remove() {
    this.parent.children = this.parent.children.filter(
      (child) => child !== this,
    );
  }
  addEventListener(name, run) {
    this.events.set(name, run);
  }
  setAttribute(name, value) {
    this[name] = value;
  }
  focus() {}
  click() {
    this.events.get("click")?.();
  }
}
async function dialog(data) {
  const elements = Object.fromEntries(
    ["content", "options", "heading", "description", "actions", "warnings"].map(
      (id) => [id, new Element("div")],
    ),
  );
  const win = {
    arguments: [data],
    close() {},
    addEventListener() {},
    resizeTo() {},
  };
  elements.window = win;
  const document = {
    body: { classList: { add() {} } },
    createElementNS: (_, tag) => new Element(tag),
    getElementById: (id) => elements[id],
  };
  const code = await readFile(
    new URL("../content/dialog.js", import.meta.url),
    "utf8",
  );
  runInNewContext(code, { window: win, document });
  return elements;
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

test("batch progress shows only paper titles, short statuses and one action", async () => {
  let cancelled = 0;
  const state = {
    kind: "progress",
    total: 12,
    finished: false,
    rows: [
      { title: "First", status: en.updated },
      { title: "Second", status: en.failed, detail: "Long HTTP error" },
      { title: "Current paper", status: en.working },
    ],
    strings: en,
    cancel: () => cancelled++,
    onResult() {},
  };
  const elements = await dialog(state);
  const content = descendants(elements.content);
  assert.equal(
    content.filter((child) =>
      ["details", "progress", "pre"].includes(child.tag),
    ).length,
    0,
  );
  assert.deepEqual(
    content
      .filter((child) => child.tag === "th")
      .map((child) => child.textContent),
    [en.title, en.status],
  );
  const body = content.find((child) => child.tag === "tbody");
  assert.equal(body.children.length, 3);
  assert.deepEqual(
    body.children[1].children.map((child) => child.textContent),
    ["Second", en.failed],
  );
  assert.equal(elements.actions.children.length, 1);
  elements.actions.children[0].click();
  assert.equal(cancelled, 1);
  state.rows[2].status = en.updated;
  state.rows.push({ title: "Last", status: en.noChanges });
  state.finished = true;
  elements.window.renderProgress();
  assert.equal(body.children.length, 4);
  assert.equal(body.children[2].children[1].textContent, en.updated);
  assert.equal(elements.actions.children[0].textContent, en.close);
});
