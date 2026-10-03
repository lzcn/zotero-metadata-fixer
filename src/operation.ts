// One update owns its cancellation handlers; shutdown never waits for remote work.
export class Operation {
  private stopped = false;
  private handlers = new Set<() => void>();
  private reject!: (error: Error) => void;
  private cancellation = new Promise<never>((_, reject) => {
    this.reject = reject;
  });

  constructor(private message = "Operation cancelled") {
    // Cancellation may happen before the first request starts.
    void this.cancellation.catch(() => {});
  }

  active(): boolean {
    return !this.stopped;
  }

  onCancel(handler: () => void): () => void {
    if (this.stopped) handler();
    else this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  cancel(error = new Error(this.message)): void {
    if (this.stopped) return;
    this.stopped = true;
    this.reject(error);
    for (const handler of this.handlers) {
      try {
        handler();
      } catch (error) {
        // A broken request must not prevent the remaining requests from stopping.
        this.onError(error);
      }
    }
    this.handlers.clear();
  }

  onError: (error: unknown) => void = () => {};

  async wait<T>(work: Promise<T>, timeout = 60000): Promise<T> {
    const timer = setTimeout(
      () => this.cancel(new Error("Metadata request timed out")),
      timeout,
    );
    try {
      return await Promise.race([work, this.cancellation]);
    } finally {
      clearTimeout(timer);
    }
  }

  async delay(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    let release = () => {};
    const work = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
      release = this.onCancel(() => clearTimeout(timer));
    });
    try {
      await this.wait(work);
    } finally {
      clearTimeout(timer!);
      release();
    }
  }
}
