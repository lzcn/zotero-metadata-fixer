/* global window, document */
const data = window.arguments[0];
const s = data.strings;
const content = document.getElementById("content");
const actions = document.getElementById("actions");
const options = document.getElementById("options");
function node(tag, text, parent) {
  const element = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
  if (text !== undefined) element.textContent = text;
  if (parent) parent.appendChild(element);
  return element;
}
function done(value) {
  data.onResult(value);
  window.close();
}
function button(text, run, parent = actions) {
  const entry = node("button", text, parent);
  entry.addEventListener("click", run, false, true);
  return entry;
}
function heading(text, description) {
  document.title = text;
  document.getElementById("heading").textContent = text;
  document.getElementById("description").textContent = description || "";
}
function table(columns, parent) {
  parent.replaceChildren();
  const element = node("table", undefined, parent);
  const header = node("tr", undefined, node("thead", undefined, element));
  columns.forEach((column) => node("th", column, header));
  return node("tbody", undefined, element);
}
if (data.kind === "conferences") {
  heading(s.conferences, s.conferenceHelp);
  let drafts = data.settings.rules.map((rule) => ({
    ...rule,
    aliases: [...rule.aliases],
  }));
  let cards = [],
    page = 0,
    nextID = 0;
  const search = node("input", undefined, options);
  search.type = "search";
  search.placeholder = s.searchConferences;
  search.setAttribute("aria-label", s.searchConferences);
  const filter = (label, values) => {
    const wrapper = node("label", label, options);
    const select = node("select", undefined, wrapper);
    node("option", s.all, select).value = "";
    for (const value of values) node("option", value, select).value = value;
    select.value = "";
    return select;
  };
  const category = filter(s.category, [
    ...new Set(
      drafts
        .map((rule) => data.conferenceInfo?.(rule.id)?.category)
        .filter(Boolean),
    ),
  ]);
  const rank = filter("CCF", ["A", "B", "C"]);
  const summary = node("p", undefined, options);
  summary.className = "muted";
  const check = (parent, text, checked) => {
    const label = node("label", undefined, parent);
    const input = node("input", undefined, label);
    input.type = "checkbox";
    input.checked = checked;
    node("span", text, label);
    return input;
  };
  const field = (card, text, value, multiline = false) => {
    const wrapper = node("label", text, card);
    const input = node(multiline ? "textarea" : "input", undefined, wrapper);
    if (multiline) input.rows = 3;
    input.value = value;
    return input;
  };
  const read = (entry) => ({
    ...entry.rule,
    name: entry.name.value,
    aliases: entry.aliases.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
    excludeAliases: entry.excludes.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
    publicationTitleOverride: entry.publication.value,
    itemType: entry.type.value,
    enabled: entry.enabled.checked,
    removeEditors: entry.editors.checked,
    preserveJournalArticles: entry.journal.checked,
  });
  const flush = () => {
    for (const entry of cards) {
      const index = drafts.findIndex((rule) => rule.id === entry.rule.id);
      if (index >= 0) drafts[index] = read(entry);
    }
  };
  const add = (rule) => {
    const card = node("section", undefined, content);
    card.className = "rule-card";
    const info = data.conferenceInfo?.(rule.id);
    node("h2", info?.acronym || rule.name || s.addConference, card);
    const enabled = check(card, s.enabled, rule.enabled);
    const editor = node("details", undefined, card);
    editor.className = "rule-editor";
    node("summary", s.configureConference, editor);
    if (rule.id.startsWith("custom-") && !rule.name) editor.open = true;
    const name = field(editor, s.conferenceName, rule.name);
    const aliases = field(editor, s.aliases, rule.aliases.join("\n"), true);
    const excludes = field(
      editor,
      s.excludeAliases,
      (rule.excludeAliases || []).join("\n"),
      true,
    );
    const typeLabel = node("label", s.itemType, editor);
    const type = node("select", undefined, typeLabel);
    for (const [value, label] of [
      ["conferencePaper", s.typeConference],
      ["bookSection", s.typeBookSection],
      ["journalArticle", s.typeJournal],
    ])
      node("option", label, type).value = value;
    type.value = rule.itemType;
    const editors = check(editor, s.removeEditors, rule.removeEditors);
    const journal = check(
      editor,
      s.preserveJournals,
      rule.preserveJournalArticles !== false,
    );
    node(
      "p",
      `${s.commonTitle}: ${data.commonTitle(rule.id) || s.unmapped}`,
      card,
    );
    const publication = field(
      editor,
      s.overridePublication,
      rule.publicationTitleOverride || "",
    );
    publication.placeholder = s.useMaintainedName;
    if (info) {
      node(
        "p",
        `${info.category} · CCF ${info.rank} · ${info.publisher} · ${info.catalogVersion} · ${info.checkedOn}`,
        editor,
      );
      button(
        `${s.openCatalog} (${s.page} ${info.sourcePage})`,
        () => data.openURL(`${info.sourcePDF}#page=${info.sourcePage}`),
        editor,
      );
      button("DBLP", () => data.openURL(info.url), editor);
      button(
        s.resetConference,
        () => {
          flush();
          const bundled = data.defaults.rules.find(
            (entry) => entry.id === rule.id,
          );
          if (bundled)
            drafts[drafts.findIndex((entry) => entry.id === rule.id)] = {
              ...bundled,
              aliases: [...bundled.aliases],
            };
          draw(false);
        },
        editor,
      );
    }
    const entry = {
      rule,
      name,
      aliases,
      excludes,
      type,
      enabled,
      editors,
      journal,
      publication,
    };
    cards.push(entry);
    button(
      s.removeRule,
      () => {
        flush();
        drafts = drafts.filter((entry) => entry.id !== rule.id);
        draw(false);
      },
      editor,
    );
  };
  const previous = button(
    s.previous,
    () => {
      flush();
      page--;
      draw(false);
    },
    options,
  );
  const next = button(
    s.next,
    () => {
      flush();
      page++;
      draw(false);
    },
    options,
  );
  function draw(save = true) {
    if (save) flush();
    content.replaceChildren();
    cards = [];
    const query = search.value?.trim().toLocaleLowerCase() || "";
    const matches = drafts.filter((rule) => {
      const info = data.conferenceInfo?.(rule.id);
      return (
        (!category.value || info?.category === category.value) &&
        (!rank.value || info?.rank === rank.value) &&
        (!query ||
          [rule.id, rule.name, ...rule.aliases, info?.acronym, info?.category]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(query))
      );
    });
    const pages = Math.max(1, Math.ceil(matches.length / 8));
    page = Math.max(0, Math.min(page, pages - 1));
    summary.textContent = `${matches.length} / ${drafts.length} · ${s.page} ${page + 1} / ${pages}`;
    previous.disabled = page === 0;
    next.disabled = page === pages - 1;
    matches.slice(page * 8, (page + 1) * 8).forEach(add);
    if (!matches.length) node("p", s.noConferenceMatches, content);
    content.scrollTop = 0;
  }
  for (const control of [search, category, rank])
    control.addEventListener(
      control === search ? "input" : "change",
      () => {
        page = 0;
        draw();
      },
      false,
      true,
    );
  button(
    s.addConference,
    () => {
      flush();
      const id = `custom-${Date.now()}-${nextID++}`;
      drafts.unshift({
        id,
        name: "",
        aliases: [],
        excludeAliases: [],
        publicationTitleOverride: "",
        itemType: "conferencePaper",
        removeEditors: false,
        preserveJournalArticles: true,
        enabled: true,
      });
      search.value = "";
      category.value = "";
      rank.value = "";
      page = 0;
      draw(false);
    },
    options,
  );
  button(
    s.resetRules,
    () => {
      drafts = data.defaults.rules.map((rule) => ({
        ...rule,
        aliases: [...rule.aliases],
      }));

      page = 0;
      draw(false);
    },
    options,
  );
  const backup = node("details", undefined, options);
  node("summary", s.backup, backup);
  const transfer = node("textarea", undefined, backup);
  transfer.rows = 4;
  transfer.hidden = true;
  transfer.setAttribute("aria-label", s.configurationJSON);
  button(
    s.exportRules,
    () => {
      flush();
      transfer.hidden = false;
      transfer.value = JSON.stringify(
        {
          ...data.settings,
          rules: drafts,
          formatPublication: data.settings.formatPublication,
        },
        null,
        2,
      );
    },
    backup,
  );
  button(
    s.importRules,
    () => {
      if (transfer.hidden) {
        transfer.hidden = false;
        transfer.value = "";
        transfer.focus();
        return;
      }
      try {
        const imported = JSON.parse(transfer.value);
        if (typeof imported.formatPublication !== "boolean")
          throw new Error(s.invalidConfiguration);
        const publicationStyle =
          imported.publicationStyle ??
          (imported.formatPublication ? "standard" : "original");
        if (!["original", "standard", "short"].includes(publicationStyle))
          throw new Error(s.invalidConfiguration);
        drafts = data.validateRules(imported.rules);
        cards = [];
        data.settings.formatPublication = imported.formatPublication;
        data.settings.publicationStyle = publicationStyle;
        page = 0;
        search.value = "";
        category.value = "";
        rank.value = "";
        document.getElementById("warnings").textContent = "";
        draw(false);
      } catch (error) {
        document.getElementById("warnings").textContent = String(error);
      }
    },
    backup,
  );
  draw(false);
  button(s.cancel, () => done(null));
  button(s.saveRules, () => {
    try {
      flush();
      const settings = {
        ...data.settings,
        formatPublication: data.settings.formatPublication,
        rules: drafts,
      };
      data.saveConfiguration(settings);
      done(settings);
    } catch (error) {
      document.getElementById("warnings").textContent = String(error);
    }
  });
} else {
  document.body.classList.add("progress-dialog");
  document.getElementById("options").hidden = true;
  document.getElementById("warnings").hidden = true;
  const progress = node("progress", undefined, content);
  progress.setAttribute("aria-label", s.working);
  const current = node("p", undefined, content);
  current.className = "current-item";
  const details = node("details", undefined, content);
  details.className = "results";
  details.open = false;
  node("summary", s.warning, details);
  const results = node("div", undefined, details);
  const renderRows = () => {
    const body = table([s.title, s.status], results);
    for (const entry of data.rows) {
      const row = node("tr", undefined, body);
      node("td", entry.title, row);
      const cell = node("td", entry.status, row);
      if (entry.detail) node("pre", entry.detail, cell);
    }
  };
  details.addEventListener("toggle", () => {
    if (details.open) renderRows();
    window.resizeTo(480, details.open ? 480 : 260);
  });
  window.renderProgress = () => {
    const total = data.total ?? data.rows.length;
    const completed = data.rows.filter(
      (entry) => entry.status !== s.working && entry.status !== s.cancelled,
    ).length;
    const counts = [s.updated, s.noChanges, s.skipped, s.failed]
      .map((status) => [
        status,
        data.rows.filter((entry) => entry.status === status).length,
      ])
      .filter(([, count]) => count)
      .map(([status, count]) => `${status} ${count}`);
    heading(
      data.cancelled ? s.cancelled : data.finished ? s.complete : s.working,
      [`${completed} / ${total}`, ...counts].join(" · "),
    );
    progress.max = Math.max(total, 1);
    progress.value = completed;
    progress.hidden = data.finished || data.cancelled;
    const active = data.rows.find((entry) => entry.status === s.working);
    current.textContent = active?.title || "";
    current.title = current.textContent;
    current.hidden = !active || data.finished || data.cancelled;
    details.hidden = !data.rows.length;
    if (details.open) renderRows();
    actions.replaceChildren();
    button(data.finished || data.cancelled ? s.close : s.cancel, () => {
      if (!data.finished && !data.cancelled) data.cancel();
      else done(null);
    });
  };
  window.renderProgress();
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (data.kind === "progress" && !data.finished) data.cancel();
    else done(null);
  }
});
window.resizeTo(
  data.kind === "conferences" ? 950 : 480,
  data.kind === "conferences" ? 680 : 260,
);
