import type { Metadata } from "./model";
import { titleScore } from "./matching";
import { conferencePoster } from "./identifiers";

// Conference records can be public before their OpenReview forums or proceedings.
export function conferenceSiteMetadata(doc: Document, url: string): Metadata {
  const site = conferencePoster(url);
  const records = Array.from(
    doc.querySelectorAll('script[type="application/ld+json"]'),
  ).flatMap((node) => {
    const value = JSON.parse(node.textContent || "null");
    return Array.isArray(value) ? value : [value];
  });
  const record = records.filter(
    (value) =>
      value?.["@type"] === "CreativeWork" &&
      value.creditText === `${site?.conference} ${site?.year}`,
  );
  const title = doc.querySelector("h1.event-title")?.textContent?.trim();
  const work = record[0];
  const authors = work?.author;
  if (
    !site ||
    record.length !== 1 ||
    !title ||
    typeof work.name !== "string" ||
    titleScore(title, work.name) < 0.9 ||
    !Array.isArray(authors) ||
    !authors.length ||
    authors.some(
      (author: any) =>
        author?.["@type"] !== "Person" ||
        typeof author.name !== "string" ||
        !author.name.trim(),
    )
  )
    throw new Error("Unverified conference record");
  return {
    itemType: "conferencePaper",
    title: work.name.trim(),
    proceedingsTitle: `${site.conference} ${site.year}`,
    date: site.year,
    url,
    creators: authors.map((author: { name: string }) => {
      const words = author.name.trim().split(/\s+/);
      return {
        firstName: words.slice(0, -1).join(" "),
        lastName: words[words.length - 1],
        creatorType: "author",
      };
    }),
    abstractNote:
      doc.querySelector(".abstract-text-inner")?.textContent?.trim() || "",
  };
}
