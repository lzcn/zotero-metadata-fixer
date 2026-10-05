import type { Metadata } from "./model";
import { arxivID, extraValue } from "./identifiers";
import { DEFAULT_CONFERENCE_RULES, conferenceInfo } from "./conferences";
import { containerTitle, matchConference } from "./venues";
import journals from "../data/journal-abbreviations.json";

// Exact journal aliases avoid confusing similarly named journals and supplements.
const journalKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
const journalNames = new Map(
  journals.flatMap((journal) =>
    [journal.name, journal.acronym, ...journal.aliases].map(
      (name) => [journalKey(name), journal.acronym] as const,
    ),
  ),
);

const medlineKey = (value: string) =>
  journalKey(value.toLowerCase().replace(/\b(and|et|y|und|la|le|the)\b/g, ""));
const fullJournalAbbreviations = new Map<string, string>();

export function addJournalTitleAbbreviations(
  entries: Record<string, string>,
): void {
  for (const [name, abbreviation] of Object.entries(entries)) {
    if (typeof abbreviation === "string" && abbreviation.trim())
      fullJournalAbbreviations.set(medlineKey(name), abbreviation);
  }
}

export function addJournalAliases(
  abbreviate: (name: string) => string | undefined,
): void {
  for (const journal of journals) {
    const alias = abbreviate(journal.name);
    if (alias) journalNames.set(journalKey(alias), journal.acronym);
  }
}

export function publicationShort(metadata: Metadata): string {
  if (metadata.itemType === "preprint") return repositoryTitle(metadata);
  if (metadata.itemType === "report") return String(metadata.institution || "");
  if (metadata.itemType === "book") return String(metadata.publisher || "");
  if (metadata.itemType === "thesis") return String(metadata.university || "");
  const publication =
    containerTitle(metadata) || String(metadata.publicationTitle || "");
  if (!publication.trim())
    return String(metadata.publisher || "") || repositoryTitle(metadata);
  if (metadata.itemType === "journalArticle") {
    const abbreviation = String(metadata.journalAbbreviation || "").trim();
    return (
      journalNames.get(journalKey(publication)) ||
      (abbreviation &&
        (journalNames.get(journalKey(abbreviation)) || abbreviation)) ||
      fullJournalAbbreviations.get(medlineKey(publication)) ||
      publication
    );
  }
  if (["conferencePaper", "bookSection"].includes(metadata.itemType)) {
    const rule = matchConference(metadata, DEFAULT_CONFERENCE_RULES);
    if (rule) return conferenceInfo(rule.id)?.acronym || publication;
  }
  return publication;
}

function repositoryTitle(metadata: Metadata): string {
  const repository = String(
    metadata.repository || metadata.archive || "",
  ).trim();
  if (repository) return repository;
  const url = String(metadata.url || "");
  const doi = String(metadata.DOI || "");
  const extra = String(metadata.extra || "");
  if (
    arxivID(url) ||
    arxivID(doi) ||
    arxivID(String(metadata.archiveID || "")) ||
    arxivID(extraValue(extra, "arXiv"))
  )
    return "arXiv";
  const host = url
    .match(/^https?:\/\/(?:www\.)?([^/:?#]+)/i)?.[1]
    .toLowerCase();
  const repositories: Record<string, string> = {
    "biorxiv.org": "bioRxiv",
    "medrxiv.org": "medRxiv",
    "chemrxiv.org": "ChemRxiv",
    "ssrn.com": "SSRN",
    "papers.ssrn.com": "SSRN",
    "openreview.net": "OpenReview",
    "osf.io": "OSF",
    "zenodo.org": "Zenodo",
  };
  return (host && repositories[host]) || "";
}
