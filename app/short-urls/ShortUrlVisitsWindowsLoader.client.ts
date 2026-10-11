import type { ShlinkShortUrl } from '@shlinkio/shlink-js-sdk/api-contract';
import type { ShortUrlVisitsWindowsResult } from '../routes/short-urls-visits-windows';
import type { VisitsWindows } from './visits-windows';
import { resolveWindowsStartDates } from './visits-windows';

export type { VisitsWindow, VisitsWindows } from './visits-windows';
export { resolveWindowsStartDates } from './visits-windows';

/** Needs to match the max allowed by the short-urls/visits-windows route */
const MAX_SHORT_URLS_PER_REQUEST = 100;

type PendingRequest = {
  shortUrl: ShlinkShortUrl;
  resolve: (visits: VisitsWindows | null) => void;
};

/** Cached results are considered stale after this time, as visits keep falling out of the rolling windows */
const CACHE_TTL_MS = 60 * 1000;

const identifierKey = ({ shortCode, domain }: { shortCode: string; domain?: string | null }) =>
  `${domain ?? ''}/${shortCode}`;

/**
 * Loads the amount of visits per time window for short URLs.
 * Requests done in the same tick are batched in a single call to the server, and results are cached until the
 * short URL total visits change (e.g. via real-time updates), or for a minute at most.
 */
export class ShortUrlVisitsWindowsLoader {
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;
  readonly #cache = new Map<string, Promise<VisitsWindows | null>>();
  readonly #pending = new Map<boolean, PendingRequest[]>();

  constructor(endpoint: string, fetch = globalThis.fetch.bind(globalThis), now = () => new Date()) {
    this.#endpoint = endpoint;
    this.#fetch = fetch;
    this.#now = now;
  }

  load(shortUrl: ShlinkShortUrl, excludeBots: boolean): Promise<VisitsWindows | null> {
    const ttlBucket = Math.floor(this.#now().getTime() / CACHE_TTL_MS);
    const cacheKey = [ttlBucket, excludeBots, identifierKey(shortUrl), shortUrl.visitsSummary.total].join('|');
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = new Promise<VisitsWindows | null>((resolve) => {
      const pending = this.#pending.get(excludeBots) ?? [];
      if (pending.length === 0) {
        setTimeout(() => this.#flush(excludeBots), 0);
      }
      this.#pending.set(excludeBots, [...pending, { shortUrl, resolve }]);
    });
    this.#cache.set(cacheKey, promise);

    // Do not cache failures, so that they are retried next time
    void promise.then((result) => result === null && this.#cache.delete(cacheKey));

    return promise;
  }

  #flush(excludeBots: boolean) {
    const pending = this.#pending.get(excludeBots) ?? [];
    this.#pending.delete(excludeBots);

    for (let i = 0; i < pending.length; i += MAX_SHORT_URLS_PER_REQUEST) {
      void this.#request(pending.slice(i, i + MAX_SHORT_URLS_PER_REQUEST), excludeBots);
    }
  }

  async #request(pending: PendingRequest[], excludeBots: boolean) {
    try {
      const resp = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortUrls: pending.map(({ shortUrl: { shortCode, domain } }) => ({ shortCode, domain })),
          windows: resolveWindowsStartDates(this.#now()),
          excludeBots,
        }),
      });
      if (!resp.ok) {
        throw new Error(`Unexpected status ${resp.status} loading short URL visits`);
      }

      const { results } = (await resp.json()) as { results: ShortUrlVisitsWindowsResult[] };
      const resultsByKey = new Map(results.map((result) => [identifierKey(result), result.visits]));
      pending.forEach(({ shortUrl, resolve }) =>
        resolve((resultsByKey.get(identifierKey(shortUrl)) as VisitsWindows | undefined) ?? null),
      );
    } catch (e) {
      console.error(e);
      pending.forEach(({ resolve }) => resolve(null));
    }
  }
}
