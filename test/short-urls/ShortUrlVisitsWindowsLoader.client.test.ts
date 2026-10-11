import type { ShlinkShortUrl } from '@shlinkio/shlink-js-sdk/api-contract';
import { fromPartial } from '@total-typescript/shoehorn';
import {
  resolveWindowsStartDates,
  ShortUrlVisitsWindowsLoader,
} from '../../app/short-urls/ShortUrlVisitsWindowsLoader.client';

describe('ShortUrlVisitsWindowsLoader', () => {
  const fetch = vi.fn();
  const now = new Date(2026, 9, 11, 15, 30);
  const createShortUrl = (shortCode: string, total = 5, domain: string | null = null) =>
    fromPartial<ShlinkShortUrl>({ shortCode, domain, visitsSummary: { total } });
  const respondWith = (results: unknown[]) => fetch.mockResolvedValue({ ok: true, json: async () => ({ results }) });
  const setUp = () => new ShortUrlVisitsWindowsLoader('/server/123/short-urls/visits-windows', fetch, () => now);
  const visits = { last24Hours: 1, last7Days: 2, last30Days: 3 };

  it('resolves windows as rolling periods ending now', () => {
    const now = new Date('2026-10-11T15:30:00.000Z');
    expect(resolveWindowsStartDates(now)).toEqual({
      last24Hours: '2026-10-10T15:30:00.000Z',
      last7Days: '2026-10-04T15:30:00.000Z',
      last30Days: '2026-09-11T15:30:00.000Z',
    });
  });

  it('batches requests done in the same tick and caches results', async () => {
    respondWith([
      { shortCode: 'foo', domain: null, visits },
      { shortCode: 'bar', domain: 's.test', visits: { ...visits, last24Hours: 10 } },
    ]);
    const loader = setUp();

    const [foo, bar, fooAgain] = await Promise.all([
      loader.load(createShortUrl('foo'), false),
      loader.load(createShortUrl('bar', 5, 's.test'), false),
      loader.load(createShortUrl('foo'), false),
    ]);

    expect(foo).toEqual(visits);
    expect(fooAgain).toBe(foo);
    expect(bar).toEqual({ ...visits, last24Hours: 10 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      shortUrls: [
        { shortCode: 'foo', domain: null },
        { shortCode: 'bar', domain: 's.test' },
      ],
      windows: resolveWindowsStartDates(now),
      excludeBots: false,
    });

    await loader.load(createShortUrl('foo'), false);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('loads again once cached results are stale', async () => {
    respondWith([{ shortCode: 'foo', domain: null, visits }]);
    let currentNow = now;
    const loader = new ShortUrlVisitsWindowsLoader('/visits-windows', fetch, () => currentNow);

    await loader.load(createShortUrl('foo'), false);
    currentNow = new Date(now.getTime() + 61_000);
    await loader.load(createShortUrl('foo'), false);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('loads again when total visits change', async () => {
    respondWith([{ shortCode: 'foo', domain: null, visits }]);
    const loader = setUp();

    await loader.load(createShortUrl('foo', 5), false);
    await loader.load(createShortUrl('foo', 6), false);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resolves null and does not cache when request fails', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const loader = setUp();

    expect(await loader.load(createShortUrl('foo'), true)).toBeNull();
    expect(await loader.load(createShortUrl('foo'), true)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
