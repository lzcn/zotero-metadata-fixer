import { publicationForItem } from "./publication-short";

declare const Zotero: any;

export const REPLACE_PUBLICATION_PREF =
  "extensions.zotero.metadata-linter.replace-publication-column";

// Decorate only the native Publication cell and leave row data/sorting untouched.
export class PublicationColumnView {
  private timers = new Map<any, ReturnType<typeof setTimeout>>();
  private views = new Map<any, { view: any; release: () => void }>();

  enabled(): boolean {
    return Zotero.Prefs?.get(REPLACE_PUBLICATION_PREF, true) !== false;
  }

  cancel(win: any): void {
    const timer = this.timers.get(win);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(win);
  }

  private redraw(view: any): void {
    view.tree?.invalidate();
  }

  sync(win: any, attempt = 0): void {
    this.cancel(win);
    const existing = this.views.get(win);
    const view = win.ZoteroPane?.itemsView;
    if (existing && existing.view !== view) {
      existing.release();
      this.views.delete(win);
    }
    if (win.closed) return;
    if (!view?._renderCell || !view?.getRow) {
      if (attempt >= 100) {
        Zotero.logError(new Error("Publication view did not become ready"));
        return;
      }
      this.timers.set(
        win,
        setTimeout(() => this.sync(win, attempt + 1), 100),
      );
      return;
    }
    if (!this.enabled()) {
      this.restore([win]);
      return;
    }
    if (this.views.has(win)) return;
    const original = view._renderCell;
    const owned = Object.hasOwn(view, "_renderCell");
    let active = true;
    const render = function (
      this: any,
      index: number,
      data: string,
      column: any,
      ...rest: any[]
    ) {
      if (active && column.dataKey === "publicationTitle") {
        const item = this.getRow(index)?.ref;
        if (item?.isRegularItem) {
          try {
            data = publicationForItem(item);
          } catch (error) {
            Zotero.logError(error);
          }
        }
      }
      return original.call(this, index, data, column, ...rest);
    };
    view._renderCell = render;
    this.views.set(win, {
      view,
      release: () => {
        active = false;
        // Preserve wrappers another plugin may have installed after ours.
        if (view._renderCell === render) {
          if (owned) view._renderCell = original;
          else delete view._renderCell;
        }
        if (!win.closed) this.redraw(view);
      },
    });
    this.redraw(view);
  }

  refresh(): void {
    for (const { view } of this.views.values()) this.redraw(view);
  }

  restore(windows: any[]): void {
    for (const win of windows) {
      this.cancel(win);
      this.views.get(win)?.release();
      this.views.delete(win);
    }
  }
}
