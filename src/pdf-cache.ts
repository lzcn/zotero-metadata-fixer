export const PDF_CACHE_PREF = "extensions.metadata-linter.pdfVersions";
export const PDF_RECHECK_INTERVAL = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 256;

export type PDFVersion = {
  source: string;
  url: string;
  attachmentKey: string;
  hash: string;
  checked: number;
  etag?: string;
  modified?: string;
  length?: string;
};

function validVersion(value: any): value is PDFVersion {
  return Boolean(
    value &&
      ["source", "url", "attachmentKey", "hash"].every(
        (key) => typeof value[key] === "string" && value[key],
      ) &&
      Number.isFinite(value.checked) &&
      value.checked >= 0 &&
      ["etag", "modified", "length"].every(
        (key) => value[key] === undefined || typeof value[key] === "string",
      ),
  );
}

// Rebuildable local state; attachment records and synced metadata stay untouched.
export class PDFVersionCache {
  private loaded = false;
  private entries = new Map<string, PDFVersion>();

  constructor(private zotero: any) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.zotero.Prefs.get(PDF_CACHE_PREF, true);
      if (!raw) return;
      const cache = JSON.parse(raw);
      if (cache.version !== 1 || !Array.isArray(cache.entries))
        throw new Error("Unsupported PDF version cache");
      for (const pair of cache.entries) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== "string" ||
          !validVersion(pair[1])
        )
          throw new Error("Invalid PDF version cache entry");
        this.entries.set(pair[0], pair[1]);
      }
      while (this.entries.size > MAX_ENTRIES)
        this.entries.delete(this.entries.keys().next().value!);
    } catch (error) {
      // This cache only mirrors server validators. Discard it instead of
      // disabling PDF checks for every item until the preference is cleared.
      this.entries.clear();
      this.zotero.logError(
        new Error("Metadata Fixer: discarding invalid PDF version cache", {
          cause: error,
        }),
      );
    }
  }

  get(key: string): PDFVersion | undefined {
    this.load();
    return this.entries.get(key);
  }

  remember(key: string, value: PDFVersion): void {
    this.load();
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > MAX_ENTRIES)
      this.entries.delete(this.entries.keys().next().value!);
    this.zotero.Prefs.set(
      PDF_CACHE_PREF,
      JSON.stringify({
        version: 1,
        entries: [...this.entries],
      }),
      true,
    );
  }
}

export function pdfValidators(
  get: (name: string) => string | null,
): Pick<PDFVersion, "etag" | "modified" | "length"> {
  const etag = get("ETag") || undefined;
  const modified = get("Last-Modified") || undefined;
  const length = get("Content-Length") || undefined;
  return {
    etag: etag && /^(?:W\/)?"[^"\r\n]*"$/.test(etag) ? etag : undefined,
    modified:
      modified && Number.isFinite(Date.parse(modified)) ? modified : undefined,
    length:
      length && /^\d+$/.test(length) && Number(length) > 0 ? length : undefined,
  };
}

export function unchangedPDF(
  previous: PDFVersion,
  current: ReturnType<typeof pdfValidators>,
): boolean {
  if (previous.etag && current.etag) return previous.etag === current.etag;
  // A timestamp alone has limited resolution; require the size to agree too.
  return Boolean(
    !previous.etag &&
      previous.modified &&
      previous.length &&
      current.modified === previous.modified &&
      current.length === previous.length,
  );
}
