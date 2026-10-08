/* global window, document, require, Zotero */
const data = window.arguments[0];
const s = data.strings;
const React = require("react");
const ReactDOM = require("react-dom");
const VirtualizedTable = require("components/virtualized-table");
const { renderCell } = VirtualizedTable;
const content = document.getElementById("content");
const actions = document.getElementById("actions");
let table;
let entries = [];
let sortField;
let sortDirection = 1;
let sized = false;
let renderFrame = null;
let disposed = false;
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
      36,
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
      const a = left[sortField] || "";
      const b = right[sortField] || "";
      // Missing problems stay at the bottom in both directions.
      if (sortField === "problem" && (!a || !b))
        return a === b ? 0 : a ? -1 : 1;
      return a.localeCompare(b, s.locale, { numeric: true }) * sortDirection;
    });
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
    containerWidth: Math.min(780, window.screen.availWidth - 48) - 24,
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
        width: 110,
        minWidth: 90,
        staticWidth: true,
      },
      {
        dataKey: "problem",
        label: s.problem,
        width: 190,
        minWidth: 130,
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
      for (const column of columns) {
        const cell = renderCell(index, entry[column.dataKey] || "", column);
        if (column.dataKey === "title") {
          const text = document.createElement("span");
          text.className = "cell-text";
          text.textContent = entry.title;
          cell.replaceChildren(text);
        }
        cell.title =
          column.dataKey === "problem"
            ? entry.detail || ""
            : entry[column.dataKey] || "";
        if (column.dataKey === "problem") {
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
