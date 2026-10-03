import type {
  Item,
  Metadata,
  Plan,
  UpdateHost,
  Creator,
  PlanOverrides,
} from "./model";
import { identifiers, cleanDOI, preprintDOI } from "./identifiers";

// Only bibliographic fields may come from a retrieved record.
export const BIBLIOGRAPHIC_FIELDS = [
  "title",
  "abstractNote",
  "publicationTitle",
  "proceedingsTitle",
  "conferenceName",
  "bookTitle",
  "date",
  "DOI",
  "url",
  "volume",
  "issue",
  "pages",
  "ISSN",
  "ISBN",
  "publisher",
  "place",
  "language",
  "journalAbbreviation",
  "series",
  "seriesTitle",
  "edition",
  "numPages",
  "shortTitle",
  "archive",
  "archiveID",
  "repository",
  "reportNumber",
  "reportType",
  "university",
  "thesisType",
  "libraryCatalog",
] as const;

export function fingerprint(item: Item): string {
  return JSON.stringify(item.toJSON());
}

export function buildPlan(
  item: Item,
  metadata: Metadata,
  mode: "blank" | "replace",
  host: UpdateHost,
  overrides?: PlanOverrides,
): Plan {
  if (!metadata.title?.trim()) throw new Error("Retrieved record has no title");
  const targetType =
    overrides?.itemType ||
    (mode === "replace" ? metadata.itemType : item.itemType);
  const typeID = host.typeID(targetType);
  if (!typeID) throw new Error("Unsupported item type: " + metadata.itemType);
  const changes: Plan["changes"] = [];
  if (targetType !== item.itemType)
    changes.push({
      field: "itemType",
      before: item.itemType,
      after: targetType,
    });
  for (const field of BIBLIOGRAPHIC_FIELDS) {
    const value = overrides?.fields?.[field] ?? metadata[field];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      !host.validField(field, typeID)
    )
      continue;
    const before = item.getField(field) || "";
    if (mode === "blank" && before && !overrides?.fields?.[field]) continue;
    if (before !== value) changes.push({ field, before, after: value });
  }
  const role = (creator: Creator) =>
    creator.creatorType ||
    (creator.creatorTypeID
      ? host.creatorTypeName?.(creator.creatorTypeID)
      : undefined) ||
    "author";
  const retrievedCreators = metadata.creators?.filter(
    (creator) => !overrides?.removeEditors || role(creator) !== "editor",
  );
  const existingNonEditors = item
    .getCreators()
    .filter((creator) => role(creator) !== "editor");
  const selectedCreators =
    (mode === "replace" || !existingNonEditors.length) &&
    retrievedCreators?.length
      ? retrievedCreators
      : item.getCreators();
  if (overrides?.removeEditors) {
    const creators = selectedCreators.filter(
      (creator) => role(creator) !== "editor",
    );
    if (JSON.stringify(creators) !== JSON.stringify(item.getCreators()))
      changes.push({
        field: "creators",
        before: item.getCreators(),
        after: creators,
      });
  } else if (
    metadata.creators?.length &&
    (mode === "replace" || !item.getCreators().length)
  ) {
    const creators = metadata.creators.map((creator) => ({
      ...creator,
      creatorType: host.validCreator(role(creator), typeID)
        ? role(creator)
        : "author",
    }));
    if (JSON.stringify(creators) !== JSON.stringify(item.getCreators()))
      changes.push({
        field: "creators",
        before: item.getCreators(),
        after: creators,
      });
  }
  return { itemID: item.id, baseline: fingerprint(item), changes };
}

export async function applyPlan(
  item: Item,
  plan: Plan,
  host: UpdateHost,
  publication = false,
): Promise<void> {
  if (!host.active()) throw new Error("Operation cancelled");
  if (
    item.id !== plan.itemID ||
    !item.isRegularItem() ||
    !item.isEditable() ||
    item.deleted
  )
    throw new Error("Item cannot be edited");
  if (fingerprint(item) !== plan.baseline)
    throw new Error("Item changed during update. Try again.");
  if (!plan.changes.length) return;
  const original = item.toJSON();
  try {
    await host.transaction(async () => {
      if (!host.active()) throw new Error("Operation cancelled");
      if (
        fingerprint(item) !== plan.baseline ||
        !item.isEditable() ||
        item.deleted
      )
        throw new Error("Item changed during update");
      const typeChange = plan.changes.find(
        (change) => change.field === "itemType",
      );
      if (typeChange) item.setType(host.typeID(String(typeChange.after)));
      for (const change of plan.changes) {
        if (change.field === "itemType") continue;
        if (change.field === "creators")
          item.setCreators(change.after as Creator[]);
        else if (host.validField(change.field, item.itemTypeID))
          item.setField(change.field, String(change.after));
      }
      const extra = String(original.extra || "");
      const lines: string[] = [];
      if (publication) {
        const ids = identifiers({
          getField: (field) => String(original[field] || ""),
        });
        if (ids.arXiv) lines.push(`arXiv: ${ids.arXiv}`);
        if (original.url) lines.push(`Preprint URL: ${original.url}`);
        if (ids.DOI) lines.push(`Preprint DOI: ${ids.DOI}`);
      }
      if (
        !publication &&
        preprintDOI(cleanDOI(String(original.DOI || "")) || "") &&
        plan.changes.some((change) => change.field === "DOI")
      )
        lines.push(`Preprint DOI: ${original.DOI}`);
      // Preserve fields Zotero cannot represent after a type conversion.
      if (typeChange)
        for (const [field, value] of Object.entries(original)) {
          if (
            typeof value === "string" &&
            value &&
            host.validField(field, host.typeID(original.itemType)) &&
            !host.validField(field, item.itemTypeID) &&
            field !== "extra"
          )
            lines.push(`Original ${field}: ${value}`);
        }
      const existing = new Set(extra.split(/\r?\n/).map((line) => line.trim()));
      const additions = lines.filter((line) => !existing.has(line));
      item.setField(
        "extra",
        additions.length
          ? [extra, ...additions].filter(Boolean).join("\n")
          : extra,
      );
      if (!host.active()) throw new Error("Operation cancelled");
      await item.save();
      if (!host.active()) throw new Error("Operation cancelled");
    });
  } catch (error) {
    await item.reload(null, true);
    throw error;
  }
}
