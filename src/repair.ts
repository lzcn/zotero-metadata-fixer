import type { Item, Metadata, Plan, PlanOverrides, UpdateHost } from "./model";
import { cleanDOI, preprintDOI } from "./identifiers";
import { normalize } from "./matching";
import { buildPlan } from "./update";

function comparable(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Different source formatting is not evidence that a populated field is wrong.
export function buildRepairPlan(
  item: Item,
  retrieved: Metadata,
  host: UpdateHost,
  overrides?: PlanOverrides,
  publication = false,
  formatPublication = false,
  venuePolicy?: { preserve: boolean; repair: boolean },
): Plan {
  const metadata = { ...retrieved };
  const fields =
    publication || formatPublication || venuePolicy?.repair
      ? { ...overrides?.fields }
      : {};
  if (
    overrides?.fields?.proceedingsTitle &&
    /^proceedings of\b/i.test(item.getField("conferenceName")) &&
    (venuePolicy?.preserve ||
      normalize(String(metadata.conferenceName || "")) ===
        normalize(item.getField("conferenceName")))
  )
    fields.proceedingsTitle = overrides.fields.proceedingsTitle;
  if (!publication) {
    // Type conversion maps the existing venue before filling from another source.
    const targetType = overrides?.itemType || metadata.itemType;
    const venueField =
      targetType === "conferencePaper"
        ? "proceedingsTitle"
        : targetType === "bookSection"
          ? "bookTitle"
          : targetType === "journalArticle"
            ? "publicationTitle"
            : undefined;
    if (
      venueField &&
      !fields[venueField] &&
      !item.getField(venueField) &&
      (venuePolicy?.preserve ?? Boolean(overrides?.itemType))
    ) {
      const oldVenue =
        item.getField("proceedingsTitle") ||
        item.getField("bookTitle") ||
        item.getField("publicationTitle");
      if (oldVenue) metadata[venueField] = oldVenue;
    }
    const oldDOI = item.getField("DOI");
    if (oldDOI && cleanDOI(String(metadata.DOI || ""))) {
      const clean = cleanDOI(oldDOI);
      // Repair malformed DOIs and DOI URLs stored in the DOI field; preserve valid values.
      if (!clean || (preprintDOI(clean) && !preprintDOI(String(metadata.DOI))))
        fields.DOI = String(metadata.DOI);
      else if (oldDOI !== clean) fields.DOI = clean;
    }
  }
  const plan = buildPlan(
    item,
    metadata,
    publication ? "replace" : "blank",
    host,
    {
      ...overrides,
      itemType:
        overrides?.itemType ||
        (["journalArticle", "conferencePaper", "bookSection"].includes(
          metadata.itemType,
        )
          ? metadata.itemType
          : item.itemType),
      fields,
    },
  );
  plan.changes = plan.changes.filter((change) => {
    if (typeof change.before === "string" && typeof change.after === "string")
      return [
        "DOI",
        "url",
        "ISBN",
        "ISSN",
        "archiveID",
        "reportNumber",
      ].includes(change.field)
        ? comparable(change.before) !== comparable(change.after)
        : normalize(change.before) !== normalize(change.after);
    if (change.field === "creators") {
      const role = (creator: any) =>
        creator.creatorType ||
        host.creatorTypeName?.(creator.creatorTypeID) ||
        "author";
      const key = (creator: any) =>
        [
          creator.firstName || "",
          creator.lastName || creator.name || "",
          role(creator),
        ]
          .map(comparable)
          .join("|");
      const before = change.before as any[];
      const after = (change.after as any[]).map(
        (creator) =>
          before.find((original) => key(original) === key(creator)) || creator,
      );
      change.after = after;
      return JSON.stringify(before) !== JSON.stringify(after);
    }
    return true;
  });
  if (
    publication &&
    !cleanDOI(String(metadata.DOI || "")) &&
    preprintDOI(cleanDOI(item.getField("DOI")) || "")
  )
    plan.changes.push({
      field: "DOI",
      before: item.getField("DOI"),
      after: "",
    });
  return plan;
}
