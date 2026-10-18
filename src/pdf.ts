import type { Item } from "./model";
import { canonicalDOI, identifiers, isPreprint } from "./identifiers";
import { articleEvidence } from "./metadata";
import { matchesAuthor, titleScore } from "./matching";
import { fingerprint } from "./update";
import type { Operation } from "./operation";
import {
  PDFVersionCache,
  PDF_RECHECK_INTERVAL,
  pdfValidators,
  unchangedPDF,
} from "./pdf-cache";

export const UPDATE_PDFS_PREF = "extensions.metadata-linter.updatePDFs";
export type PDFResult = "added" | "unchanged" | "unavailable" | "skipped";

// Stage downloads separately; only the short import transaction may change the library.
export class PDFUpdater {
  constructor(
    private zotero: any,
    private document: (url: string) => Promise<Document>,
    private cache = new PDFVersionCache(zotero),
  ) {}

  async update(item: Item, operation: Operation): Promise<PDFResult> {
    const z = this.zotero;
    const ids = identifiers(item);
    if (isPreprint(item) || (!ids.DOI && !ids.URL)) return "skipped";
    if (!z.Libraries.get(item.libraryID).filesEditable) return "skipped";
    const baseline = fingerprint(item);
    const check = () => {
      if (!operation.active()) throw new Error("Operation cancelled");
      if (
        item.deleted ||
        !item.isEditable() ||
        !z.Libraries.get(item.libraryID).filesEditable ||
        fingerprint(item) !== baseline
      )
        throw new Error("Item changed during PDF update");
    };
    check();
    const cacheKey = `${item.libraryID}/${item.key}`;
    const previous = this.cache.get(cacheKey);
    const source = ids.DOI ? `doi:${canonicalDOI(ids.DOI)}` : `url:${ids.URL}`;
    const attachments = () => z.Items.get((item as any).getAttachments());
    const tracked =
      previous &&
      attachments().find((entry: any) => entry.key === previous.attachmentKey);
    const primary = await (item as any).getBestAttachment();
    const oldPDFs: { item: any; baseline: string; hash: string | null }[] = [];
    for (const old of new Set<any>([primary, tracked])) {
      if (
        !old ||
        old.attachmentContentType !== "application/pdf" ||
        old.deleted ||
        /\b(?:supplement(?:ary|al|s)?|supporting information|appendi(?:x|ces))\b|补充|附录/i.test(
          old.getField("title"),
        )
      )
        continue;
      oldPDFs.push({
        item: old,
        baseline: fingerprint(old),
        hash: await old.attachmentHash,
      });
    }
    check();
    const retire = async (current: any, hash: string) => {
      for (const snapshot of oldPDFs) {
        const old = snapshot.item;
        if (old.id === current.id || snapshot.hash === hash) continue;
        const currentHash = await old.attachmentHash;
        check();
        // Recheck inside the import transaction: annotations may arrive during retrieval.
        if (
          old.deleted ||
          old.parentID !== item.id ||
          !old.isEditable() ||
          fingerprint(old) !== snapshot.baseline ||
          currentHash !== snapshot.hash ||
          old.getAnnotations(true).length ||
          old.getNotes(true).length ||
          old
            .getNote()
            .replace(/<[^>]*>/g, "")
            .trim()
        )
          continue;
        old.deleted = true;
        await old.save();
        check();
      }
    };
    const transaction = async (run: () => Promise<void>) => {
      try {
        await z.DB.executeTransaction(run);
      } catch (error) {
        for (const snapshot of oldPDFs) {
          try {
            await snapshot.item.reload(null, true);
          } catch (reloadError) {
            z.logError(reloadError);
          }
        }
        throw error;
      }
    };
    const errors: string[] = [];
    // Like arXiv Workflow, resolve published DOIs through the publisher only.
    // A retained manuscript URL must not supply an older PDF if that fails.
    const pages = z.Attachments.getFileResolvers(
      item,
      ids.DOI ? ["doi"] : ["url"],
    )
      .map((resolver: { pageURL: string }) => resolver.pageURL)
      .filter(
        (url: string) =>
          !isPreprint({
            itemType: "document",
            isRegularItem: () => true,
            getField: (field) => (field === "url" ? url : ""),
          }),
      );
    for (const page of new Set<string>(pages)) {
      let temporary: any;
      try {
        const doc = await operation.wait(this.document(page));
        check();
        const evidence = articleEvidence(doc, doc.location?.href || page);
        const sameDOI = Boolean(
          evidence.doi &&
            ids.DOI &&
            canonicalDOI(evidence.doi) === canonicalDOI(ids.DOI),
        );
        const authors = Array.from(
          doc.querySelectorAll('meta[name="citation_author"]'),
          (meta) => meta.getAttribute("content") || "",
        );
        if (
          (evidence.doi &&
            ids.DOI &&
            canonicalDOI(evidence.doi) !== canonicalDOI(ids.DOI)) ||
          (evidence.title &&
            titleScore(item.getField("title"), evidence.title) < 0.9) ||
          (!sameDOI &&
            (!evidence.title ||
              !matchesAuthor(item.getCreators()[0]?.lastName || "", authors)))
        )
          throw new Error("No matching article identity for PDF");
        const links = [
          ...new Set(
            Array.from(
              doc.querySelectorAll('meta[name="citation_pdf_url"]'),
              (meta) => meta.getAttribute("content")?.trim(),
            ).filter(Boolean),
          ),
        ];
        const resolved: { url?: string } | false =
          links.length === 1
            ? { url: links[0] }
            : await operation.wait<{ url?: string } | false>(
                z.Utilities.Internal.getFileFromDocument(doc),
              );
        check();
        if (!resolved || !resolved.url) continue;
        const url = new URL(resolved.url, doc.location?.href || page).href;
        if (!/^https?:\/\//i.test(url)) throw new Error("Invalid PDF URL");
        const cached =
          previous &&
          previous.source === source &&
          previous.url === url &&
          tracked &&
          !tracked.deleted &&
          (await tracked.attachmentHash) === previous.hash
            ? previous
            : undefined;
        check();
        const headers: Record<string, string> = {
          Referer: doc.location?.href || page,
        };
        if (cached?.etag) headers["If-None-Match"] = cached.etag;
        else if (cached?.modified)
          headers["If-Modified-Since"] = cached.modified;
        const remember = (
          current: any,
          hash: string,
          validators: ReturnType<typeof pdfValidators>,
        ) => {
          check();
          this.cache.remember(cacheKey, {
            source,
            url,
            attachmentKey: current.key,
            hash,
            checked: Date.now(),
            ...validators,
          });
        };
        const reuse = async (
          validators: ReturnType<typeof pdfValidators>,
          refresh = true,
        ) => {
          // Check again after a network wait; local files or annotations can change meanwhile.
          if (
            !tracked ||
            tracked.deleted ||
            (await tracked.attachmentHash) !== cached?.hash
          )
            return false;
          check();
          await transaction(async () => {
            check();
            await retire(tracked, cached!.hash);
            check();
          });
          if (refresh) remember(tracked, cached!.hash, validators);
          return true;
        };
        if (cached) {
          if (
            !cached.etag &&
            !cached.modified &&
            Date.now() >= cached.checked &&
            Date.now() - cached.checked < PDF_RECHECK_INTERVAL &&
            (await reuse(cached, false))
          )
            return "unchanged";
          let releaseHead = () => {};
          let head: any;
          try {
            head = await z.HTTP.request("HEAD", url, {
              headers,
              timeout: 8000,
              errorDelayMax: 0,
              successCodes: [200, 304],
              cancellerReceiver: (cancel: () => void) => {
                releaseHead();
                releaseHead = operation.onCancel(cancel);
              },
            });
          } catch (error) {
            check();
            // Publishers may reject HEAD; the conditional GET remains available.
            z.debug(`PDF version probe failed: ${String(error)}`);
          } finally {
            releaseHead();
          }
          check();
          if (head) {
            const validators = pdfValidators((name) =>
              head.getResponseHeader(name),
            );
            if (
              (head.status === 304 || unchangedPDF(cached, validators)) &&
              (await reuse(head.status === 304 ? cached : validators))
            )
              return "unchanged";
          }
        }
        temporary = await z.Attachments.createTemporaryStorageDirectory();
        check();
        const file = temporary.clone();
        file.append("document.pdf");
        let release = () => {};
        let response: any;
        try {
          // Await the actual download so cleanup cannot race a late temporary write.
          response = await z.HTTP.download(url, file.path, {
            headers,
            successCodes: [200, 304],
            noCache: true,
            timeout: 20000,
            errorDelayMax: 0,
            noRetryOnThrottle: true,
            cancellerReceiver: (cancel: () => void) => {
              release();
              release = operation.onCancel(cancel);
            },
          });
        } finally {
          release();
        }
        check();
        if (response.status === 304) {
          if (cached && (await reuse(cached))) return "unchanged";
          throw new Error("Local PDF changed during version check");
        }
        if ((await z.MIME.getMIMETypeFromFile(file)) !== "application/pdf")
          throw new Error("Downloaded file is not a PDF");
        const hash = await z.Utilities.Internal.md5Async(file.path);
        check();
        // Re-read attachments after download to include files added concurrently.
        for (const attachment of z.Items.get((item as any).getAttachments())) {
          if (attachment.attachmentContentType !== "application/pdf") continue;
          if ((await attachment.attachmentHash) === hash) {
            check();
            await transaction(async () => {
              check();
              await retire(attachment, hash);
              check();
            });
            remember(
              attachment,
              hash,
              pdfValidators((name) => response.headers.get(name)),
            );
            return "unchanged";
          }
        }
        check();
        let storage: any;
        const attachment = new z.Item("attachment");
        try {
          await transaction(async () => {
            check();
            attachment.libraryID = item.libraryID;
            attachment.parentID = item.id;
            attachment.attachmentLinkMode =
              z.Attachments.LINK_MODE_IMPORTED_URL;
            attachment.attachmentContentType = "application/pdf";
            attachment.setField("url", url);
            attachment.setField("accessDate", "CURRENT_TIMESTAMP");
            attachment.setAutoAttachmentTitle();
            await attachment.save();
            check();
            storage = z.File.pathToFile(
              await z.Attachments.createDirectoryForItem(attachment),
            );
            check();
            const name =
              z.File.getValidFileName(
                z.Attachments.getFileBaseNameFromItem(item),
              ) + ".pdf";
            const target = storage.clone();
            target.append(name);
            const copied = z.File.copyToUnique(file, target);
            attachment.attachmentPath = copied.path;
            await z.File.setNormalFilePermissions(copied.path);
            check();
            await attachment.save();
            check();
            await retire(attachment, hash);
            check();
          });
        } catch (error) {
          if (storage?.exists()) storage.remove(true);
          throw error;
        }
        remember(
          attachment,
          hash,
          pdfValidators((name) => response.headers.get(name)),
        );
        if (operation.active()) {
          try {
            await z.FullText.queueItem(attachment);
          } catch (error) {
            z.logError(error);
          }
        }
        return "added";
      } catch (error) {
        check();
        errors.push(`${page}: ${String(error)}`);
      } finally {
        if (temporary?.exists()) temporary.remove(true);
      }
    }
    if (errors.length) throw new Error(errors.join("\n"));
    return "unavailable";
  }
}
