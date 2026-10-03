import type { Metadata, PlanOverrides } from "./model";
import { normalize } from "./matching";
import catalog from "../data/conferences.json";
import catalogInfo from "../data/conference-catalog.json";

export type ConferenceRule = {
  id: string;
  name: string;
  aliases: string[];
  itemType: "conferencePaper" | "bookSection" | "journalArticle";
  removeEditors: boolean;
  enabled: boolean;
  excludeAliases: string[];
  publicationTitleOverride: string;
  preserveJournalArticles: boolean;
};
export const CONFERENCE_SETTINGS_PREF =
  "extensions.zotero.metadata-linter.conferences";
export const DEFAULT_CONFERENCE_RULES = validateConferenceRules(catalog);
export const CONFERENCE_CATALOG_VERSION = catalogInfo.id;
export function conferenceInfo(id: string) {
  const conference = catalog.find((conference) => conference.id === id);
  return conference
    ? { ...conference, sourcePDF: catalogInfo.pdfURL }
    : undefined;
}
export type PublicationStyle = "original" | "standard" | "short";
export type ConferenceSettings = {
  publicationStyle?: PublicationStyle;
  catalogVersion?: string;
  removedRuleIDs?: string[];
  rules: ConferenceRule[];
  formatPublication: boolean;
};

export function parseConferenceSettings(stored?: string): ConferenceSettings {
  const defaults = validateConferenceRules(catalog);
  if (!stored)
    return {
      rules: defaults,
      formatPublication: false,
      publicationStyle: "original",
      catalogVersion: CONFERENCE_CATALOG_VERSION,
      removedRuleIDs: [],
    };
  const settings = JSON.parse(stored);
  if (typeof settings.formatPublication !== "boolean")
    throw new Error("Invalid Publication formatting option");
  const publicationStyle =
    settings.publicationStyle ??
    (settings.formatPublication ? "standard" : "original");
  if (!["original", "standard", "short"].includes(publicationStyle))
    throw new Error("Invalid conference naming style");
  const rules = validateConferenceRules(settings.rules);
  const removedRuleIDs = settings.removedRuleIDs ?? [];
  if (
    !Array.isArray(removedRuleIDs) ||
    removedRuleIDs.some((id) => typeof id !== "string")
  )
    throw new Error("Invalid removed conference IDs");
  // Add new bundled conferences during upgrades, preserving edits and deletions.
  if (settings.catalogVersion !== CONFERENCE_CATALOG_VERSION) {
    const existing = new Set(rules.map((rule) => rule.id));
    rules.push(
      ...defaults.filter(
        (rule) => !existing.has(rule.id) && !removedRuleIDs.includes(rule.id),
      ),
    );
  }
  return {
    rules,
    formatPublication: publicationStyle !== "original",
    publicationStyle,
    catalogVersion: CONFERENCE_CATALOG_VERSION,
    removedRuleIDs,
  };
}

export function commonPublicationTitle(id: string): string {
  return (
    catalog.find((conference) => conference.id === id)?.publicationTitle || ""
  );
}

export function validateConferenceRules(value: unknown): ConferenceRule[] {
  if (!Array.isArray(value)) throw new Error("Conference rules must be a list");
  const ids = new Set<string>();
  return value.map((rule) => {
    if (
      !rule ||
      typeof rule.id !== "string" ||
      !rule.id.trim() ||
      ids.has(rule.id.trim())
    )
      throw new Error("Every conference rule needs a unique ID");
    if (typeof rule.name !== "string" || !rule.name.trim())
      throw new Error("Conference name is required");
    if (
      !Array.isArray(rule.aliases) ||
      !rule.aliases.length ||
      rule.aliases.some(
        (alias: unknown) => typeof alias !== "string" || !normalize(alias),
      )
    )
      throw new Error("Conference aliases must be non-empty names");
    if (
      !["conferencePaper", "bookSection", "journalArticle"].includes(
        rule.itemType,
      ) ||
      typeof rule.removeEditors !== "boolean" ||
      typeof rule.enabled !== "boolean"
    )
      throw new Error("Invalid conference rule options");
    if (
      rule.excludeAliases !== undefined &&
      (!Array.isArray(rule.excludeAliases) ||
        rule.excludeAliases.some(
          (alias: unknown) => typeof alias !== "string" || !normalize(alias),
        ))
    )
      throw new Error("Excluded aliases must be non-empty names");
    if (
      rule.publicationTitleOverride !== undefined &&
      typeof rule.publicationTitleOverride !== "string"
    )
      throw new Error("Invalid Publication name override");
    if (
      rule.preserveJournalArticles !== undefined &&
      typeof rule.preserveJournalArticles !== "boolean"
    )
      throw new Error("Invalid journal preservation option");
    ids.add(rule.id.trim());
    return {
      id: rule.id.trim(),
      name: rule.name.trim(),
      aliases: [
        ...new Set<string>(rule.aliases.map((alias: string) => alias.trim())),
      ],
      itemType: rule.itemType,
      removeEditors: rule.removeEditors,
      enabled: rule.enabled,
      excludeAliases: [...new Set<string>(rule.excludeAliases ?? [])].map(
        (alias) => alias.trim(),
      ),
      publicationTitleOverride: rule.publicationTitleOverride?.trim() ?? "",
      preserveJournalArticles: rule.preserveJournalArticles ?? true,
    };
  });
}

export function normalizeConference(
  metadata: Metadata,
  rules: ConferenceRule[],
  formatPublication: boolean | PublicationStyle = false,
): { metadata: Metadata; rule?: ConferenceRule; overrides?: PlanOverrides } {
  // Match venue fields, never the paper title. An entire proceedings volume is not a paper.
  if (
    !["bookSection", "conferencePaper", "journalArticle"].includes(
      metadata.itemType,
    )
  )
    return { metadata };
  const venues = [
    metadata.conferenceName,
    metadata.proceedingsTitle,
    metadata.bookTitle,
    metadata.publicationTitle,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    )
    .map((value) => ` ${normalize(value)} `);
  const secondaryTrack =
    /\b(workshops?|companion|findings|demonstrations?|posters?|short papers?)\b/;
  const hasSecondaryTrack = venues.some((venue) => secondaryTrack.test(venue));
  const matches = rules
    .flatMap((rule) => {
      if (
        !rule.enabled ||
        rule.excludeAliases.some((alias) =>
          venues.some((venue) => venue.includes(` ${normalize(alias)} `)),
        )
      )
        return [];
      let score = 0;
      for (const alias of rule.aliases) {
        const normalizedAlias = normalize(alias);
        const match = ` ${normalizedAlias} `;
        for (const originalVenue of venues) {
          // Publishers sometimes attach the year directly to the acronym, e.g. ECCV2024.
          const venue = originalVenue
            .replace(/([a-z])(20\d{2})(?=\s|$)/g, "$1 $2")
            .replace(/(20\d{2})([a-z])/g, "$1 $2");
          if (
            hasSecondaryTrack &&
            !rule.aliases.some((alias) => secondaryTrack.test(normalize(alias)))
          )
            continue;
          if (venue.includes(match))
            score = Math.max(score, normalizedAlias.length);
        }
      }
      return score ? [{ rule, score }] : [];
    })
    .sort((a, b) => b.score - a.score);
  // Ambiguous short names such as FSE and SEC must not pick the first catalog row.
  const rule =
    matches[0] && (matches.length < 2 || matches[0].score > matches[1].score)
      ? matches[0].rule
      : undefined;
  if (!rule) return { metadata };
  // Conference events can publish in genuine journals (PACMPL, PACMMOD, PVLDB, TOG…).
  if (metadata.itemType === "journalArticle" && rule.preserveJournalArticles)
    return { metadata };
  const normalized: Metadata = { ...metadata, itemType: rule.itemType };
  const fields: Record<string, string> = {};
  const style =
    typeof formatPublication === "boolean"
      ? formatPublication
        ? "standard"
        : "original"
      : formatPublication;
  const commonTitle =
    style !== "original"
      ? rule.publicationTitleOverride ||
        (style === "short"
          ? conferenceInfo(rule.id)?.acronym || commonPublicationTitle(rule.id)
          : commonPublicationTitle(rule.id))
      : "";
  if (rule.itemType === "conferencePaper") {
    // Name formatting targets the proceedings, not the separate conference event field.
    if (!normalized.conferenceName) normalized.conferenceName = rule.name;
    const misplacedProceedings =
      typeof metadata.conferenceName === "string" &&
      /^proceedings of\b/i.test(metadata.conferenceName)
        ? metadata.conferenceName
        : "";
    const proceedings =
      misplacedProceedings ||
      metadata.proceedingsTitle ||
      metadata.bookTitle ||
      metadata.publicationTitle;
    if (commonTitle) fields.proceedingsTitle = commonTitle;
    else if (typeof proceedings === "string" && proceedings)
      fields.proceedingsTitle = proceedings;
    delete normalized.bookTitle;
  } else if (rule.itemType === "bookSection") {
    const bookTitle =
      metadata.bookTitle ||
      metadata.proceedingsTitle ||
      metadata.publicationTitle;
    if (commonTitle) fields.bookTitle = commonTitle;
    else if (typeof bookTitle === "string" && bookTitle)
      fields.bookTitle = bookTitle;
  } else {
    const title =
      metadata.publicationTitle ||
      metadata.proceedingsTitle ||
      metadata.bookTitle;
    if (commonTitle) fields.publicationTitle = commonTitle;
    else if (typeof title === "string" && title)
      fields.publicationTitle = title;
  }
  Object.assign(normalized, fields);
  return {
    metadata: normalized,
    rule,
    overrides: {
      itemType: rule.itemType,
      removeEditors: rule.removeEditors,
      fields,
    },
  };
}
