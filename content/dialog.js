/* global window, document */
const data = window.arguments[0];
const s = data.strings;
const content = document.getElementById("content");
const actions = document.getElementById("actions");
function node(tag, text, parent) {
  const element = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
  if (text !== undefined) element.textContent = text;
  if (parent) parent.appendChild(element);
  return element;
}
function done() {
  data.onResult(null);
  window.close();
}
function button(text, run) {
  const entry = document.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "button",
  );
  entry.setAttribute("label", text);
  actions.appendChild(entry);
  entry.addEventListener("command", run, false, true);
}
function table(columns, parent) {
  const element = node("table", undefined, parent);
  const header = node("tr", undefined, node("thead", undefined, element));
  columns.forEach((column) => node("th", column, header));
  return node("tbody", undefined, element);
}
document.body.classList.add("progress-dialog");
document.title = s.name;
const body = table([s.title, s.status], content);
const rendered = [];
window.renderProgress = () => {
  data.rows.forEach((entry, index) => {
    let cells = rendered[index];
    if (!cells) {
      const row = node("tr", undefined, body);
      const title = node("td", entry.title, row);
      title.title = entry.title;
      cells = { status: node("td", undefined, row) };
      rendered.push(cells);
    }
    cells.status.textContent = entry.status;
  });
  actions.replaceChildren();
  button(data.finished || data.cancelled ? s.close : s.cancel, () => {
    if (!data.finished && !data.cancelled) data.cancel();
    else done();
  });
};
window.renderProgress();

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!data.finished && !data.cancelled) data.cancel();
    else done();
  }
});
window.resizeTo(
  500,
  Math.min(320, 110 + Math.max(1, data.total || data.rows.length) * 32),
);
