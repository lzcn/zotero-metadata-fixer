import { publicationForItem } from "./publication-short";

declare const Zotero: any;

export const REPLACE_PUBLICATION_PREF =
  "extensions.zotero.metadata-linter.replace-publication-column";
const RESTORE_PREF =
  "extensions.zotero.metadata-linter.publication-column-visibility";
const LEGACY_COLUMN = "metadata-linter\\@lzcn-publication-short";

// Decorate only the native Publication cell and leave row data/sorting untouched.
export class PublicationColumnView {
  private timers = new Map<any, ReturnType<typeof setTimeout>>();
  private views = new Map<any, { view: any; release: () => void }>();
  private migrating = new Set<string>();

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

  private migrate(view: any): void {
    const raw = Zotero.Prefs?.get(RESTORE_PREF, true);
    if (!raw || this.migrating.has(view.id)) return;
    const saved = JSON.parse(raw);
    if (
      !saved ||
      typeof saved !== "object" ||
      Array.isArray(saved) ||
      Object.values(saved).some((value) => typeof value !== "boolean")
    )
      throw new Error("Invalid saved publication column visibility");
    if (!(view.id in saved)) return;
    const prefs = { ...view._getColumnPrefs() };
    const legacy = prefs[LEGACY_COLUMN];
    prefs.publicationTitle = {
      ...prefs.publicationTitle,
      hidden: legacy?.hidden === false ? false : saved[view.id],
      ...(legacy?.width && { width: legacy.width }),
      ...(legacy?.ordinal !== undefined && { ordinal: legacy.ordinal }),
    };
    delete prefs[LEGACY_COLUMN];
    view._storeColumnPrefs(prefs);
    this.migrating.add(view.id);
    void view
      ._writeColumnPrefsToFile(true)
      .then(() => {
        const current = JSON.parse(
          Zotero.Prefs.get(RESTORE_PREF, true) || "{}",
        );
        delete current[view.id];
        Zotero.Prefs.set(RESTORE_PREF, JSON.stringify(current), true);
        this.migrating.delete(view.id);
      })
      .catch((error: unknown) => {
        this.migrating.delete(view.id);
        Zotero.logError(error);
      });
    if (view.tree)
      void view
        ._resetColumns()
        .catch((error: unknown) => Zotero.logError(error));
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
    this.migrate(view);
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
