declare const Zotero: any;

export const REPLACE_PUBLICATION_PREF =
  "extensions.zotero.metadata-linter.replace-publication-column";
const RESTORE_PREF =
  "extensions.zotero.metadata-linter.publication-column-visibility";

// Use Zotero's column preferences and redraw methods, never replace its renderer.
export class PublicationColumnView {
  private timers = new Map<any, ReturnType<typeof setTimeout>>();
  private originals?: Record<string, boolean>;
  private revisions = new Map<string, number>();

  enabled(): boolean {
    return Zotero.Prefs?.get(REPLACE_PUBLICATION_PREF, true) !== false;
  }

  private visibility(): Record<string, boolean> {
    if (!this.originals) {
      const raw = Zotero.Prefs?.get(RESTORE_PREF, true);
      const saved = typeof raw === "string" ? JSON.parse(raw) : {};
      if (
        !saved ||
        typeof saved !== "object" ||
        Array.isArray(saved) ||
        Object.values(saved).some((value) => typeof value !== "boolean")
      )
        throw new Error("Invalid saved publication column visibility");
      this.originals = saved;
    }
    return this.originals!;
  }

  private save(): void {
    Zotero.Prefs.set(RESTORE_PREF, JSON.stringify(this.visibility()), true);
  }

  cancel(win: any): void {
    const timer = this.timers.get(win);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(win);
  }

  sync(win: any, key?: string, enabled = this.enabled(), attempt = 0): void {
    this.cancel(win);
    if (win.closed && enabled) return;
    const view = win.ZoteroPane?.itemsView;
    const columns = enabled ? view?._getColumns?.() : undefined;
    const original = columns?.find(
      (column: any) => column.dataKey === "publicationTitle",
    );
    const custom =
      key && columns?.find((column: any) => column.dataKey === key);
    if (enabled && (!original || !view?.tree || !custom)) {
      if (attempt >= 100) {
        Zotero.logError(
          new Error("Publication column view did not become ready"),
        );
        return;
      }
      this.timers.set(
        win,
        setTimeout(() => this.sync(win, key, enabled, attempt + 1), 100),
      );
      return;
    }
    if (!view?._getColumnPrefs || !view?._storeColumnPrefs) return;
    const originals = this.visibility();
    const revision = (this.revisions.get(view.id) || 0) + 1;
    this.revisions.set(view.id, revision);
    const prefs = { ...view._getColumnPrefs() };
    if (enabled) {
      if (!(view.id in originals)) {
        originals[view.id] = Boolean(original.hidden);
        this.save();
      }
      prefs.publicationTitle = { ...prefs.publicationTitle, hidden: true };
      prefs[key!] = {
        ...prefs[key!],
        hidden: false,
        ordinal: original.ordinal,
        width: prefs[key!]?.width || original.width || custom.width,
      };
    } else {
      if (!(view.id in originals)) return;
      prefs.publicationTitle = {
        ...prefs.publicationTitle,
        hidden: originals[view.id],
      };
    }
    view._storeColumnPrefs(prefs);
    if (!win.closed && view.tree)
      void view
        ._resetColumns()
        .catch((error: unknown) => Zotero.logError(error));
    // Persist the restoration now rather than waiting for Zotero's throttled save.
    if (!enabled) {
      void view
        ._writeColumnPrefsToFile(true)
        .then(() => {
          // Retain recovery state until the native preferences have been saved.
          if (this.revisions.get(view.id) === revision) {
            delete originals[view.id];
            this.save();
          }
        })
        .catch((error: unknown) => Zotero.logError(error));
    }
  }

  restore(windows: any[]): void {
    for (const win of [...this.timers.keys()]) this.cancel(win);
    for (const win of windows) this.sync(win, undefined, false);
    // Shutdown must never leave readiness retries running.
    for (const win of [...this.timers.keys()]) this.cancel(win);
  }
}
