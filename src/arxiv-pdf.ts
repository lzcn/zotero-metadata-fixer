import { arxivID, identifiers } from "./identifiers";
import type { Item, Metadata } from "./model";
import type { Operation } from "./operation";
import type { PDFVersion } from "./pdf-cache";

export type ArxivPDF = {
  page: string;
  url: string;
  source: string;
  attachments: Map<string, string>;
};

function versionOf(value: string, id: string): number {
  const parsed = arxivID(value);
  const match = parsed?.match(/^(.*)v([1-9]\d*)$/i);
  return match && match[1].toLowerCase() === id.toLowerCase()
    ? Number(match[2])
    : 0;
}

// Item metadata can already name v3 while its attached PDF still contains v1.
// Only a hash-verified download record or the PDF's own first page proves its version.
export async function resolveArxivPDF(
  zotero: any,
  item: Item,
  operation: Operation,
  latest: (id: string) => Promise<Metadata | undefined>,
  check: () => void,
  cached?: PDFVersion,
): Promise<ArxivPDF | "unchanged" | "skipped"> {
  const id = identifiers(item).arXiv?.replace(/v\d+$/i, "");
  if (!id) return "skipped";
  const source = `arxiv:${id.toLowerCase()}`;
  const attachments = new Map<string, string>();
  let localVersion = 0;
  const pdfs = zotero.Items.get((item as any).getAttachments()).filter(
    (pdf: any) =>
      !pdf.deleted && pdf.attachmentContentType === "application/pdf",
  );
  for (const pdf of pdfs) {
    const hash = await pdf.attachmentHash;
    check();
    if (!hash) continue;
    let version =
      cached?.source === source &&
      cached.attachmentKey === pdf.key &&
      cached.hash === hash
        ? versionOf(cached.url, id)
        : 0;
    if (!version) {
      try {
        const { text } = await operation.wait<{ text: string }>(
          zotero.PDFWorker.getFullText(pdf.id, 1),
        );
        check();
        const marks = String(text || "").matchAll(
          /\barxiv\s*:\s*((?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})v[1-9]\d*)\b/gi,
        );
        for (const mark of marks)
          version = Math.max(version, versionOf(mark[1], id));
      } catch (error) {
        check();
        zotero.debug(`Cannot read arXiv PDF version: ${String(error)}`);
      }
    }
    if ((await pdf.attachmentHash) !== hash)
      throw new Error("PDF changed during version check");
    check();
    if (version) {
      attachments.set(pdf.key, hash);
      localVersion = Math.max(localVersion, version);
    }
  }
  // Unknown files may be a newer manuscript or an entirely different document.
  if (pdfs.length && !localVersion) return "skipped";
  const metadata = await operation.wait(latest(id));
  check();
  const remoteID =
    metadata && arxivID(String(metadata.archiveID || metadata.url || ""));
  const version = versionOf(remoteID || "", id);
  if (!version) throw new Error("No matching arXiv PDF version");
  if (localVersion >= version) return "unchanged";
  return {
    source,
    page: `https://arxiv.org/abs/${remoteID}`,
    url: `https://arxiv.org/pdf/${remoteID}`,
    attachments,
  };
}
