/* global window, document, require, Zotero */
const data = window.arguments[0];
const s = data.strings;
const React = require("react");
const ReactDOM = require("react-dom");
const VirtualizedTable = require("components/virtualized-table");
const { renderCell } = VirtualizedTable;
const content = document.getElementById("content");
const actions = document.getElementById("actions");
const summary = document.getElementById("summary");
const progress = document.getElementById("progress");
let table;
let entries = [];
let sortField;
let sortDirection = 1;
let sized = false;
let renderFrame = null;
let disposed = false;
const statusText = (entry) =>
  [entry.status, entry.pdfStatus].filter(Boolean).join(" · ");
function done() {
  if (!data.finished && !data.cancelled) data.cancel();
  data.onResult(null);
  window.close();
}
function sizeWindow() {
  if (sized || window.closed) return;
  sized = true;
  const screen = window.screen;
  const width = Math.min(780, screen.availWidth - 48);
  const visibleRows = Math.min(10, Math.max(4, data.total || data.rows.length));
  const headerHeight = content
    .querySelector(".virtualized-table-header")
    .getBoundingClientRect().height;
  const height = Math.min(
    headerHeight +
      visibleRows * table._rowHeight +
      actions.getBoundingClientRect().height +
      summary.getBoundingClientRect().height +
      progress.getBoundingClientRect().height +
      48,
    screen.availHeight - 80,
  );
  window.resizeBy(width - window.innerWidth, height - window.innerHeight);
  window.moveTo(
    (screen.availLeft || 0) +
      Math.max(0, (screen.availWidth - window.outerWidth) / 2),
    (screen.availTop || 0) +
      Math.max(0, (screen.availHeight - window.outerHeight) / 2),
  );
}
document.body.classList.add("progress-dialog");
document.title = s.name;
Zotero.UIProperties.registerRoot(document.body);
const action = document.createElementNS(
  "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
  "button",
);
actions.appendChild(action);
action.addEventListener(
  "command",
  () => {
    if (!data.finished && !data.cancelled) data.cancel();
    else done();
  },
  false,
  true,
);
function flushProgress() {
  if (disposed || window.closed) return;
  entries = [...data.rows];
  if (sortField)
    entries.sort((left, right) => {
      const a =
        sortField === "status" ? statusText(left) : left[sortField] || "";
      const b =
        sortField === "status" ? statusText(right) : right[sortField] || "";
      return a.localeCompare(b, s.locale, { numeric: true }) * sortDirection;
    });
  const total = entries.length;
  let completed = 0,
    updated = 0,
    failed = 0;
  for (const row of entries) {
    if (![s.waiting, s.working, s.cancelled].includes(row.status)) completed++;
    if (row.status === s.updated || row.pdfStatus === s.pdfUpdated) updated++;
    if (row.status === s.failed) failed++;
  }
  const pending = total - completed;
  const message = data.cancelled
    ? s.progressCancelled
    : data.finished
      ? s.progressFinished
      : s.progressRunning;
  const format = (text) =>
    text
      .replace("{completed}", String(completed))
      .replace("{total}", String(total))
      .replace("{updated}", String(updated))
      .replace("{failed}", String(failed))
      .replace("{pending}", String(pending));
  summary.title = format(message);
  summary.textContent = format(
    data.cancelled
      ? s.progressCancelledCompact
      : data.finished
        ? s.progressFinishedCompact
        : s.progressRunningCompact,
  );
  progress.max = Math.max(1, total);
  progress.value = completed;
  progress.hidden = !!data.finished || !!data.cancelled;
  table?.invalidate();
  action.setAttribute(
    "label",
    data.finished || data.cancelled ? s.close : s.cancel,
  );
}
window.renderProgress = () => {
  if (disposed || window.closed || renderFrame !== null) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = null;
    flushProgress();
  });
};
flushProgress();
const root = ReactDOM.createRoot(content);
root.render(
  React.createElement(VirtualizedTable, {
    id: "metadata-fixer-progress",
    label: s.name,
    showHeader: true,
    containerWidth: Math.min(780, window.screen.availWidth - 48) - 32,
    columns: [
      {
        dataKey: "title",
        label: s.title,
        flex: 1,
        minWidth: 180,
        primary: true,
      },
      {
        dataKey: "status",
        label: s.status,
        width: 240,
        minWidth: 160,
        staticWidth: true,
      },
    ],
    getRowCount: () => entries.length,
    renderItem(index, selection, oldDiv, columns) {
      const entry = entries[index];
      const row = oldDiv || document.createElement("div");
      row.replaceChildren();
      row.className = "row";
      row.classList.toggle("selected", selection.isSelected(index));
      const selectable = entry.itemID != null && Boolean(data.selectItem);
      row.classList.toggle("selectable", selectable);
      row.onclick = selectable
        ? () => {
            try {
              data.selectItem(entry.itemID);
            } catch (error) {
              Zotero.logError?.(error);
            }
          }
        : null;
      for (const column of columns) {
        const text =
          column.dataKey === "status"
            ? statusText(entry)
            : entry[column.dataKey] || "";
        const cell = renderCell(index, text, column);
        if (column.dataKey === "title") {
          const text = document.createElement("span");
          text.className = "cell-text";
          text.textContent = entry.title;
          cell.replaceChildren(text);
        }
        cell.title =
          column.dataKey === "status"
            ? [
                ...new Set(
                  [
                    s.metadataResult.replace("{status}", entry.status || ""),
                    entry.problem,
                    entry.pdfStatus,
                    ...String(entry.detail || "").split(/\r?\n/),
                  ].filter(Boolean),
                ),
              ].join("\n")
            : entry[column.dataKey] || "";
        if (column.dataKey === "status") {
          // Keep the diagnostic tooltip instead of the table's truncated-text tooltip.
          cell.addEventListener("mouseover", (event) =>
            event.stopPropagation(),
          );
        }
        row.appendChild(cell);
      }
      return row;
    },
    onColumnSort(index, direction) {
      sortField = table._getColumns()[index].dataKey;
      sortDirection = direction;
      window.renderProgress();
    },
    onActivate() {
      const entry = entries[table?.selection?.focused];
      if (entry?.itemID == null || !data.selectItem) return false;
      try {
        data.selectItem(entry.itemID);
      } catch (error) {
        Zotero.logError?.(error);
      }
      return true;
    },
    ref(instance) {
      table = instance;
      if (table) {
        flushProgress();
        window.requestAnimationFrame(() => {
          sizeWindow();
          action.focus();
        });
      }
    },
  }),
);
window.addEventListener(
  "unload",
  () => {
    disposed = true;
    if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
    if (!data.finished && !data.cancelled) data.cancel();
    root.unmount();
  },
  { once: true },
);
window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
    return;
  const accel = (Zotero.isMac ? event.metaKey : event.ctrlKey) && !event.altKey;
  if (accel && event.key.toLowerCase() === "w") {
    event.preventDefault();
    done();
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (!data.finished && !data.cancelled) data.cancel();
    else done();
  }
});
