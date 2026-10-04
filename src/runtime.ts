import type {
  Candidate,
  Item,
  Metadata,
  RetrievalSource,
  UpdateHost,
} from "./model";
import { identifiers, isPreprint, preprintDOI } from "./identifiers";
import { PublicationFinder, type Network } from "./providers";
import { MetadataRetriever } from "./translate";
import { applyPlan } from "./update";
import { Operation } from "./operation";
import { parseJSONResponse } from "./responses";
import { buildRepairPlan } from "./repair";
import { publishedVenue, rankCandidates, titleScore } from "./matching";
import { selectPublication } from "./selection";
import { en, zh } from "./strings";
import {
  CONFERENCE_SETTINGS_PREF,
  parseConferenceSettings,
  normalizeConference,
  type ConferenceSettings,
  type PublicationStyle,
} from "./conferences";

declare const Zotero: any;
declare const MLRootURI: string;

export class Runtime {
  private alive = true;
  private generation = 0;
  private busy = false;
  private operationGeneration = 0;
  private windows = new Map<any, () => void>();
  private dialogs = new Set<any>();
  private preferencePane?: string;
  private registeringPreferences = false;
  private settingsCache?: { raw?: string; value: ConferenceSettings };
  private operation?: Operation;
  private operationWindow?: any;
  private dialogOwners = new Map<any, any>();
  private progressWindow?: any;
  private progressState?: any;
  private progressResult?: Promise<any>;
  private s = String(Zotero.locale).startsWith("zh") ? zh : en;
  private lastArxivRequest = 0;
  private lastScholarRequest = 0;
  private finder?: PublicationFinder;
  private retriever?: MetadataRetriever;

  private network(operation: Operation): Network {
    return {
      json: async (url) =>
        parseJSONResponse(await this.request(url, operation), {
          blocked: this.s.apiBlocked,
          invalid: this.s.apiInvalid,
        }),
      text: (url) => this.request(url, operation),
      html: (text) => {
        if (!operation.active()) throw new Error(this.s.cancelled);
        return new (Zotero.getMainWindow().DOMParser)().parseFromString(
          text,
          "text/html",
        );
      },
      xml: (text) => {
        if (!operation.active()) throw new Error(this.s.cancelled);
        const doc = new (Zotero.getMainWindow().DOMParser)().parseFromString(
          text,
          "text/xml",
        );
        if (doc.getElementsByTagName("parsererror").length)
          throw new Error("Invalid XML response");
        return doc;
      },
    };
  }

  private async request(
    url: string,
    operation = this.operation,
    responseType = "text",
  ): Promise<any> {
    if (
      !operation?.active() ||
      !this.alive ||
      !this.busy ||
      this.generation !== this.operationGeneration
    )
      throw new Error(this.s.cancelled);
    if (url.startsWith("https://export.arxiv.org/")) {
      const wait = 3000 - (Date.now() - this.lastArxivRequest);
      if (wait > 0) await operation.delay(wait);
      this.lastArxivRequest = Date.now();
    }
    if (url.startsWith("https://scholar.google.com/")) {
      const wait = 2000 - (Date.now() - this.lastScholarRequest);
      if (wait > 0) await operation.delay(wait);
      this.lastScholarRequest = Date.now();
    }
    if (!operation.active()) throw new Error(this.s.cancelled);
    let release = () => {};
    try {
      const response: any = await operation.wait(
        Zotero.HTTP.request("GET", url, {
          responseType,
          headers: {
            Accept:
              responseType === "document" ||
              url.startsWith("https://scholar.google.com/")
                ? "text/html"
                : "application/json, application/xml;q=0.9, text/plain;q=0.8",
          },
          timeout: 20000,
          cancellerReceiver: (cancel: () => void) => {
            release();
            release = operation.onCancel(cancel);
          },
        }),
      );
      if (!operation.active()) throw new Error(this.s.cancelled);
      return responseType === "document"
        ? Zotero.HTTP.wrapDocument(response.response, response.responseURL)
        : response.responseText;
    } finally {
      release();
    }
  }

  private host(token: number): UpdateHost {
    return {
      transaction: (run) => Zotero.DB.executeTransaction(run),
      typeID: (type) => Zotero.ItemTypes.getID(type),
      validField: (field, typeID) => {
        const id = Zotero.ItemFields.getID(field);
        return Boolean(id && Zotero.ItemFields.isValidForType(id, typeID));
      },
      validCreator: (type, typeID) => {
        const id = Zotero.CreatorTypes.getID(type);
        return Boolean(
          id && Zotero.CreatorTypes.isValidForItemType(id, typeID),
        );
      },
      active: () =>
        this.alive &&
        token === this.generation &&
        this.operation?.active() !== false,
      creatorTypeName: (id) => Zotero.CreatorTypes.getName(id),
    };
  }

  inject(win: any): void {
    if (!this.alive || this.windows.has(win)) return;
    const doc = win.document;
    const popup = doc.getElementById("zotero-itemmenu");
    if (!popup) return;
    const menu = doc.createXULElement("menuitem");
    menu.id = "metadata-linter-menu";
    menu.setAttribute("label", this.s.name);
    menu.setAttribute("tooltiptext", this.s.lint);
    menu.setAttribute("class", "menuitem-iconic");
    menu.setAttribute("image", MLRootURI + "icons/icon-16.png");
    menu.addEventListener("command", () => {
      void this.run(win, "lint").catch((error) => Zotero.logError(error));
    });
    const showing = (event: Event) => {
      if (event.target !== popup) return;
      const selected: Item[] = win.ZoteroPane.getSelectedItems().filter(
        (item: Item) =>
          item.isRegularItem() && item.isEditable() && !item.deleted,
      );
      menu.hidden = false;
      menu.disabled = !selected.length || this.busy;
    };
    popup.addEventListener("popupshowing", showing);
    popup.appendChild(menu);
    this.windows.set(win, () => {
      popup.removeEventListener("popupshowing", showing);
      menu.remove();
    });
  }

  remove(win: any): void {
    if (this.operationWindow === win) this.cancel();
    for (const [dialog, owner] of this.dialogOwners)
      if (owner === win) this.cleanup(() => dialog.close());
    const remove = this.windows.get(win);
    this.windows.delete(win);
    remove?.();
  }

  private cleanup(run: () => void): void {
    try {
      run();
    } catch (error) {
      Zotero.logError(error);
    }
  }

  private open(win: any, data: any): { window: any; result: Promise<any> } {
    let resolve!: (value: any) => void;
    let settled = false;
    const result = new Promise<any>((done) => {
      resolve = done;
    });
    data.strings = this.s;
    data.onResult = (value: any) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const dialog = win.openDialog(
      "chrome://metadata-linter/content/dialog.xhtml",
      "_blank",
      "chrome,centerscreen,resizable,dialog=no",
      data,
    );
    this.dialogs.add(dialog);
    this.dialogOwners.set(dialog, win);
    dialog.addEventListener("unload", (event: any) => {
      // openDialog first unloads about:blank. That is navigation, not cancellation.
      if (
        event.target !== dialog.document ||
        event.target?.documentURI !==
          "chrome://metadata-linter/content/dialog.xhtml"
      )
        return;
      this.dialogs.delete(dialog);
      this.dialogOwners.delete(dialog);
      data.onResult(null);
    });
    return { window: dialog, result };
  }

  cancel(): void {
    ++this.generation;
    this.operation?.cancel();
    if (this.progressState) {
      this.progressState.cancelled = true;
      for (const row of this.progressState.rows)
        if (row.status === this.s.working || row.status === this.s.waiting)
          row.status = this.s.cancelled;
      if (!this.progressWindow?.closed)
        this.cleanup(() => this.progressWindow?.renderProgress?.());
    }
    for (const dialog of [...this.dialogs])
      if (dialog !== this.progressWindow || !this.alive)
        this.cleanup(() => dialog.close());
  }

  stop(): void {
    if (!this.alive) return;
    this.alive = false;
    this.cleanup(() => this.cancel());
    for (const win of [...this.windows.keys()])
      this.cleanup(() => this.remove(win));
    this.dialogs.clear();
    this.dialogOwners.clear();
    if (this.preferencePane) {
      this.cleanup(() =>
        Zotero.PreferencePanes.unregister(this.preferencePane),
      );
      this.preferencePane = undefined;
    }
    if (Zotero.MetadataLinter === this) delete Zotero.MetadataLinter;
  }

  registerPreferences(): void {
    if (!this.alive || this.registeringPreferences || this.preferencePane)
      return;
    Zotero.MetadataLinter = this;
    if (!Zotero.PreferencePanes?.register) return;
    this.registeringPreferences = true;
    void Zotero.PreferencePanes.register({
      pluginID: "metadata-linter@lzcn",
      id: "metadata-linter-preferences",
      label: this.s.name,
      image: MLRootURI + "icons/icon-20.png",
      src: MLRootURI + "content/preferences.xhtml",
    })
      .then((id: string) => {
        if (!this.alive) Zotero.PreferencePanes.unregister(id);
        else this.preferencePane = id;
      })
      .catch((error: unknown) => Zotero.logError(error))
      .finally(() => {
        this.registeringPreferences = false;
      });
  }

  preferenceData(): any {
    return { strings: this.s, settings: this.conferenceSettings() };
  }

  initializePreferences(doc: any): void {
    doc.getElementById("ml-publication-style").addEventListener(
      "command",
      (event: any) => {
        this.setPublicationStyle(event.target.value);
      },
      false,
      true,
    );
    this.refreshPreferences(doc);
  }

  refreshPreferences(doc: any): void {
    if (!this.alive) return;
    for (const [id, text] of Object.entries({
      "ml-settings-help": this.s.settingsHelp,
      "ml-publication-label": this.s.publicationStyle,
      "ml-retrieved-names": this.s.retrievedNames,
      "ml-standard-names": this.s.standardNames,
      "ml-short-names": this.s.shortNames,
      "ml-publication-help": this.s.formatHelp,
    })) {
      const element = doc.getElementById(id);
      if (element.localName === "menuitem") element.setAttribute("label", text);
      else if (element.localName === "label")
        element.setAttribute("value", text);
      else element.textContent = text;
    }
    doc.getElementById("ml-publication-style").value =
      this.conferenceSettings().publicationStyle;
  }

  setPublicationStyle(publicationStyle: PublicationStyle | boolean): void {
    if (!this.alive) return;
    const style =
      typeof publicationStyle === "boolean"
        ? publicationStyle
          ? "standard"
          : "original"
        : publicationStyle;
    if (!["original", "standard", "short"].includes(style))
      throw new Error("Invalid conference naming style");
    Zotero.Prefs.set(
      CONFERENCE_SETTINGS_PREF,
      JSON.stringify({
        ...this.conferenceSettings(),
        publicationStyle: style,
        formatPublication: style !== "original",
      }),
      true,
    );
    this.settingsCache = undefined;
  }

  private conferenceSettings(): ConferenceSettings {
    // Parsing validates hundreds of rules, so reuse the result until the raw
    // preference changes (for example after the naming style is saved).
    const raw: string | undefined = Zotero.Prefs?.get(
      CONFERENCE_SETTINGS_PREF,
      true,
    );
    const cached = this.settingsCache;
    if (cached && cached.raw === raw) return cached.value;
    const value = parseConferenceSettings(raw);
    this.settingsCache = { raw, value };
    return value;
  }

  private validatePublication(
    item: Item,
    candidate: Candidate,
    metadata: Metadata,
  ): void {
    if (
      !["journalArticle", "conferencePaper", "bookSection"].includes(
        metadata.itemType,
      ) ||
      (typeof metadata.DOI === "string" && preprintDOI(metadata.DOI)) ||
      !metadata.creators?.length ||
      titleScore(item.getField("title"), metadata.title) <
        (candidate.linked ? 0.75 : 0.9) ||
      !publishedVenue(
        String(
          metadata.publicationTitle ||
            metadata.proceedingsTitle ||
            metadata.bookTitle ||
            candidate.venue ||
            "",
        ),
      ) ||
      !rankCandidates(item, [
        {
          ...candidate,
          linked: false,
          title: metadata.title,
          authors: metadata.creators.map(
            (author) => `${author.firstName || ""} ${author.lastName}`,
          ),
        },
      ]).length
    )
      throw new Error(this.s.unsupported);
  }

  private enqueue(items: Item[], source: RetrievalSource | "lint"): void {
    const state = this.progressState;
    for (const item of items) {
      if (
        state.rows.some(
          (row: any) =>
            row.itemID === item.id && row.generation === this.generation,
        )
      )
        continue;
      const row = {
        itemID: item.id,
        generation: this.generation,
        title: item.getField("title"),
        status: this.s.waiting,
        detail: "",
      };
      state.rows.push(row);
      state.tasks.push({ item, source, row });
    }
    state.total = state.rows.length;
    if (!this.progressWindow?.closed)
      this.cleanup(() => this.progressWindow?.renderProgress?.());
  }

  async run(win: any, source: RetrievalSource | "lint"): Promise<void> {
    if (!this.alive) return;
    const selected: Item[] = win.ZoteroPane.getSelectedItems().filter(
      (item: Item) =>
        item.isRegularItem() && item.isEditable() && !item.deleted,
    );
    if (!selected.length) {
      Zotero.alert(win, this.s.name, this.s.empty);
      return;
    }
    if (this.busy) {
      if (this.operation?.active()) this.enqueue(selected, source);
      this.progressWindow?.focus?.();
      return;
    }
    this.busy = true;
    const token = ++this.generation;
    this.operationGeneration = token;
    const host = this.host(token);
    const operation = new Operation(this.s.cancelled);
    operation.onError = (error) => Zotero.logError(error);
    this.operation = operation;
    this.operationWindow = win;
    const net = this.network(operation);
    const finder = this.finder ?? new PublicationFinder(net);
    const retriever =
      this.retriever ??
      new MetadataRetriever(
        Zotero,
        finder,
        net,
        () => this.alive && operation.active(),
        (url) => this.request(url, operation, "document"),
      );
    const reuse = this.progressWindow && !this.progressWindow.closed;
    const state: any = reuse
      ? this.progressState
      : {
          kind: "progress",
          total: 0,
          rows: [],
          tasks: [],
          finished: false,
        };
    state.finished = false;
    state.cancelled = false;
    state.tasks = [];
    let progress: ReturnType<Runtime["open"]>;
    try {
      progress = reuse
        ? { window: this.progressWindow, result: this.progressResult! }
        : this.open(win, state);
    } catch (error) {
      operation.cancel();
      this.busy = false;
      this.operation = undefined;
      this.operationWindow = undefined;
      Zotero.logError(error);
      return;
    }
    this.progressWindow = progress.window;
    this.progressState = state;
    this.progressResult = progress.result;
    state.cancel = () => this.cancel();
    this.enqueue(selected, source);
    // Closing the progress window is cancellation while work is running.
    if (!reuse) {
      void progress.result.then(() => {
        if (state !== this.progressState) return;
        if (!state.finished) this.cancel();
        this.progressWindow = undefined;
        this.progressState = undefined;
        this.progressResult = undefined;
      });
    }
    this.progressWindow.focus?.();
    try {
      while (state.tasks.length && host.active()) {
        const { item, source, row } = state.tasks.shift() as {
          item: Item;
          source: RetrievalSource | "lint";
          row: any;
        };
        row.status = this.s.working;
        if (!progress.window.closed)
          this.cleanup(() => progress.window.renderProgress?.());
        try {
          const preprint = isPreprint(item);
          const ids = identifiers(item);
          const itemDOI = ids.DOI;
          const missingDOI = !itemDOI || preprintDOI(itemDOI);
          let metadata: Metadata | undefined;
          let publication = false;
          if (source === "lint" && missingDOI && ids.PMID) {
            try {
              const resolved = await operation.wait(
                retriever.retrieve(item, "PMID"),
              );
              this.validatePublication(
                item,
                { source: "PMID", title: item.getField("title") },
                resolved,
              );
              metadata = resolved;
              publication = preprint;
            } catch (error) {
              if (!host.active()) throw error;
              row.detail = `PMID: ${String(error)}`;
            }
          }
          if (source === "lint" && !metadata && (preprint || missingDOI)) {
            const lookup = !missingDOI
              ? {
                  candidates: [
                    {
                      source: "DOI",
                      title: item.getField("title"),
                      doi: itemDOI,
                      linked: true,
                    },
                  ],
                  warnings: [],
                  answered: 1,
                }
              : await operation.wait(
                  finder.find(item, preprint, async (candidate) => {
                    const resolved = await operation.wait(
                      retriever.candidate(candidate, host.active),
                    );
                    this.validatePublication(item, candidate, resolved);
                    metadata = resolved;
                    return true;
                  }),
                );
            if (!host.active()) break;
            row.detail = [row.detail, ...lookup.warnings]
              .filter(Boolean)
              .join("\n");
            if (!lookup.candidates.length) {
              const status = lookup.warnings.length
                ? this.s.partial
                : preprint
                  ? this.s.noPublished
                  : this.s.noDOI;
              row.detail = [status, row.detail].filter(Boolean).join("\n");
            } else {
              const candidate = selectPublication(item, lookup.candidates);
              if (!candidate) {
                row.status = this.s.skipped;
                row.detail = this.s.ambiguous;
                continue;
              }
              metadata ??= await operation.wait(
                retriever.candidate(candidate, host.active),
              );
              this.validatePublication(item, candidate, metadata);
              publication = preprint;
            }
          }
          if (!metadata) {
            if (source === "lint") {
              try {
                const current = await operation.wait(
                  retriever.retrieveCurrent(item, host.active),
                );
                metadata = current.metadata;
                if (
                  item.getField("title") &&
                  titleScore(item.getField("title"), metadata.title) < 0.9
                )
                  throw new Error(this.s.unsupported);
                row.detail = [row.detail, ...current.warnings]
                  .filter(Boolean)
                  .join("\n");
              } catch (error) {
                if (!host.active()) throw error;
                const settings = this.conferenceSettings();
                const local = normalizeConference(
                  item.toJSON(),
                  settings.rules,
                  settings.publicationStyle,
                );
                if ((!local.rule && !missingDOI) || preprint) throw error;
                metadata = item.toJSON();
                row.detail = [row.detail, String(error)]
                  .filter(Boolean)
                  .join("\n");
              }
            } else
              metadata = await operation.wait(retriever.retrieve(item, source));
          }
          if (!host.active()) break;
          const settings = this.conferenceSettings();
          const conference = normalizeConference(
            metadata,
            settings.rules,
            settings.publicationStyle,
          );
          metadata = conference.metadata;
          const existingConference = normalizeConference(
            item.toJSON(),
            settings.rules,
            "original",
          );
          // Translators may omit the old event field; use the baseline to repair misplaced proceedings.
          if (
            settings.publicationStyle === "original" &&
            conference.rule?.id === existingConference.rule?.id &&
            /^proceedings of\b/i.test(item.getField("conferenceName")) &&
            conference.overrides?.fields &&
            existingConference.overrides?.fields?.proceedingsTitle
          )
            conference.overrides.fields.proceedingsTitle =
              existingConference.overrides.fields.proceedingsTitle;
          const plan = buildRepairPlan(
            item,
            metadata,
            host,
            conference.overrides,
            publication,
            settings.publicationStyle !== "original",
            {
              preserve: Boolean(
                conference.rule &&
                  conference.rule.id === existingConference.rule?.id,
              ),
              repair: Boolean(
                conference.rule &&
                  existingConference.rule &&
                  conference.rule.id !== existingConference.rule.id,
              ),
            },
          );
          if (!plan.changes.length) {
            row.status = this.s.noChanges;
            continue;
          }
          await applyPlan(item, plan, host, publication);
          row.status = this.s.updated;
        } catch (error) {
          row.status = host.active() ? this.s.failed : this.s.cancelled;
          row.detail += `\n${String(error)}`;
          if (host.active()) Zotero.logError(error);
        } finally {
          if (!progress.window.closed)
            this.cleanup(() => progress.window.renderProgress?.());
        }
      }
    } finally {
      if (!host.active()) {
        for (const row of state.rows)
          if (row.status === this.s.working || row.status === this.s.waiting)
            row.status = this.s.cancelled;
      }
      state.finished = true;
      state.cancelled = !host.active();
      if (!progress.window.closed)
        this.cleanup(() => progress.window.renderProgress?.());
      state.tasks = [];
      operation.cancel();
      this.busy = false;
      this.operation = undefined;
      this.operationWindow = undefined;
    }
  }
}

// esbuild exports this through the named IIFE variable in loadSubScript's target.
// globalThis is the Gecko sandbox global, which can differ from that target.
export function start(): Runtime {
  const runtime = new Runtime();
  try {
    for (const win of Zotero.getMainWindows()) runtime.inject(win);
    runtime.registerPreferences();
  } catch (error) {
    runtime.stop();
    throw error;
  }
  return runtime;
}
