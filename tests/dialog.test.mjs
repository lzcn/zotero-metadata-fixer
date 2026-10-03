import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { en } from "../.tests-build/strings.js";
import {
  parseConferenceSettings,
  commonPublicationTitle,
  conferenceInfo,
  validateConferenceRules,
} from "../.tests-build/conferences.js";

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

test("conference settings keep the naming choice in the main preferences and the CCF mapping read-only", async () => {
  let saved;
  const settings = parseConferenceSettings();
  const elements = await dialog({
    kind: "conferences",
    settings,
    defaults: parseConferenceSettings(),
    strings: en,
    commonTitle: commonPublicationTitle,
    conferenceInfo,
    validateRules: validateConferenceRules,
    saveConfiguration: (value) => {
      saved = value;
    },
    onResult() {},
  });
  elements.actions.children
    .find((child) => child.textContent === en.saveRules)
    .click();
  assert.equal(saved.formatPublication, false);
  assert.equal(saved.rules[0].id, "eccv");
  assert.equal(saved.rules[0].removeEditors, true);
  assert.equal(settings.formatPublication, false);
  const ccfLabel = elements.content.children[0].children.find(
    (child) => child.tag === "p",
  );
  assert.match(ccfLabel.textContent, /European Conference on Computer Vision/);
});

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

test("searching and paging conference settings preserves edited drafts and saving keeps all rules", async () => {
  let saved;
  const settings = parseConferenceSettings();
  const elements = await dialog({
    kind: "conferences",
    settings,
    defaults: parseConferenceSettings(),
    strings: en,
    commonTitle: commonPublicationTitle,
    conferenceInfo,
    validateRules: validateConferenceRules,
    saveConfiguration: (value) => {
      saved = value;
    },
    onResult() {},
  });
  assert.equal(elements.content.children.length, 8);
  const editor = elements.content.children[0].children.find(
    (child) => child.tag === "details",
  );
  assert.equal(editor.open, undefined);
  const name = editor.children.find(
    (child) => child.textContent === en.conferenceName,
  ).children[0];
  name.value = "My ECCV name";
  const search = elements.options.children.find(
    (child) => child.type === "search",
  );
  search.value = "ICLR";
  search.events.get("input")();
  assert.equal(elements.content.children.length, 1);
  assert.equal(elements.content.children[0].children[0].textContent, "ICLR");
  const enabled = descendants(elements.content.children[0]).find(
    (child) => child.type === "checkbox",
  );
  enabled.checked = false;
  elements.actions.children
    .find((child) => child.textContent === en.saveRules)
    .click();
  assert.equal(saved.rules.length, 386);
  assert.equal(
    saved.rules.find((rule) => rule.id === "eccv").name,
    "My ECCV name",
  );
  assert.equal(saved.rules.find((rule) => rule.id === "iclr").enabled, false);
  assert.equal(
    settings.rules[0].name,
    "European Conference on Computer Vision",
  );
});

test("invalid imported configuration leaves the existing drafts unchanged", async () => {
  let saved;
  const elements = await dialog({
    kind: "conferences",
    settings: parseConferenceSettings(),
    defaults: parseConferenceSettings(),
    strings: en,
    commonTitle: commonPublicationTitle,
    conferenceInfo,
    validateRules: validateConferenceRules,
    saveConfiguration: (value) => {
      saved = value;
    },
    onResult() {},
  });
  const backup = elements.options.children.find(
    (child) => child.tag === "details",
  );
  const importButton = backup.children.find(
    (child) => child.textContent === en.importRules,
  );
  importButton.click();
  const transfer = backup.children.find((child) => child.tag === "textarea");
  transfer.value = JSON.stringify({
    formatPublication: true,
    rules: [{ id: "bad" }],
  });
  importButton.click();
  assert.match(elements.warnings.textContent, /Conference name is required/);
  elements.actions.children
    .find((child) => child.textContent === en.saveRules)
    .click();
  assert.equal(saved.rules.length, 386);
  assert.equal(saved.formatPublication, false);
});

test("batch progress stays compact with results collapsed and one cancel action", async () => {
  let cancelled = 0;
  const state = {
    kind: "progress",
    total: 12,
    finished: false,
    rows: [
      { title: "First", status: en.updated },
      { title: "Second", status: en.failed, detail: "Offline" },
      { title: "Current paper", status: en.working },
    ],
    strings: en,
    cancel: () => cancelled++,
    onResult() {},
  };
  const elements = await dialog(state);
  assert.match(elements.description.textContent, /2 \/ 12/);
  assert.match(elements.description.textContent, /Updated 1/);
  assert.match(elements.description.textContent, /Failed 1/);
  const details = elements.content.children.find(
    (child) => child.tag === "details",
  );
  assert.equal(details.open, false);
  assert.equal(
    descendants(details).some((child) => child.tag === "table"),
    false,
  );
  assert.equal(elements.actions.children.length, 1);
  elements.actions.children[0].click();
  assert.equal(cancelled, 1);
  details.open = true;
  details.events.get("toggle")();
  assert.equal(
    descendants(details).filter((child) => child.tag === "tbody")[0].children
      .length,
    3,
  );
  state.finished = true;
  elements.window.renderProgress();
  assert.equal(elements.heading.textContent, en.complete);
  assert.equal(elements.actions.children[0].textContent, en.close);
});
