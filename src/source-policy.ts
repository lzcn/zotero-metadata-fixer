import { Operation } from "./operation";

function sourceKey(url: string): string {
  const host = new URL(url).hostname;
  return /^dblp\.(org|dagstuhl\.de|uni-trier\.de)$/.test(host)
    ? "dblp.org"
    : host;
}

// Session-local cooldowns survive batches; successful JSON is reused briefly, never persisted.
export class SourcePolicy {
  private cooldowns = new Map<string, { until: number; failures: number }>();
  private queues = new Map<string, Promise<void>>();
  private lastStart = new Map<string, number>();
  private cache = new Map<string, { text: string; until: number }>();
  private cacheSize = 0;

  cached(url: string): string | undefined {
    const entry = this.cache.get(url);
    if (!entry) return;
    if (entry.until <= Date.now()) {
      this.cache.delete(url);
      this.cacheSize -= entry.text.length;
      return;
    }
    return entry.text;
  }

  remember(url: string, text: string): void {
    if (text.length > 1024 * 1024) return;
    const old = this.cache.get(url);
    if (old) this.cacheSize -= old.text.length;
    this.cache.delete(url);
    this.cache.set(url, { text, until: Date.now() + 5 * 60 * 1000 });
    this.cacheSize += text.length;
    while (this.cache.size > 128 || this.cacheSize > 8 * 1024 * 1024) {
      const key = this.cache.keys().next().value!;
      this.cacheSize -= this.cache.get(key)!.text.length;
      this.cache.delete(key);
    }
  }

  async acquire(url: string, operation: Operation): Promise<() => void> {
    const key = sourceKey(url);
    const intervals: Record<string, number> = {
      "api.crossref.org": 250,
      "api.openalex.org": 200,
      "dblp.org": 500,
      "sparql.dblp.org": 1000,
      "api.semanticscholar.org": 1100,
      "api2.openreview.net": 500,
      "eutils.ncbi.nlm.nih.gov": 400,
    };
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.queues.get(key) || Promise.resolve();
    const queued = previous.then(() => slot);
    this.queues.set(key, queued);
    const releaseSlot = () => {
      release();
      void queued.then(() => {
        if (this.queues.get(key) === queued) this.queues.delete(key);
      });
    };
    try {
      await operation.wait(previous);
      const cooldown = this.cooldowns.get(key);
      if (cooldown && cooldown.until > Date.now())
        throw Object.assign(new Error(`Source rate-limited: ${key}`), {
          status: 429,
          cooldown: true,
        });
      const wait =
        (this.lastStart.get(key) || 0) + (intervals[key] || 0) - Date.now();
      if (wait > 0) await operation.delay(wait);
      if (!operation.active()) throw new Error("Operation cancelled");
      this.lastStart.set(key, Date.now());
      return releaseSlot;
    } catch (error) {
      releaseSlot();
      throw error;
    }
  }

  failed(url: string, error: any): void {
    if (
      Number(error?.status || error?.xmlhttp?.status) !== 429 ||
      error?.cooldown
    )
      return;
    const key = sourceKey(url);
    const failures = (this.cooldowns.get(key)?.failures || 0) + 1;
    let header: string | undefined;
    try {
      header = error.xmlhttp?.getResponseHeader("Retry-After");
    } catch {
      /* Headers may be inaccessible. */
    }
    const retry = header?.trim();
    const until =
      retry && /^\d+$/.test(retry)
        ? Date.now() + Number(retry) * 1000
        : retry
          ? Date.parse(retry)
          : NaN;
    this.cooldowns.set(key, {
      failures,
      until:
        Number.isFinite(until) && until > Date.now()
          ? until
          : Date.now() +
            Math.min(900000, 60000 * 2 ** Math.min(failures - 1, 4)),
    });
  }

  clear(): void {
    this.queues.clear();
    this.cooldowns.clear();
    this.cache.clear();
    this.cacheSize = 0;
    this.lastStart.clear();
  }
}
