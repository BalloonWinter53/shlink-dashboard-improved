import type { ShlinkApiClient } from '@shlinkio/shlink-js-sdk/api-contract';
import { fromPartial } from '@total-typescript/shoehorn';
import {
  listShortUrlsOrderedByVisitsWindow,
  resolveVisitsWindowOrder,
} from '../../app/short-urls/short-urls-visits-window-ordering.server';
import { parseVisitsWindowOrderField, visitsWindowOrderField } from '../../app/short-urls/visits-windows';

describe('short-urls-visits-window-ordering', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  const shortUrl = (shortCode: string, domain = 's.test') =>
    fromPartial({ shortCode, shortUrl: `https://${domain}/${shortCode}` });
  const visit = (visitedUrl: string | null) => ({ visitedUrl });

  describe('visits window order fields', () => {
    it.each([
      ['last24Hours', 'visitsLast24Hours'],
      ['last7Days', 'visitsLast7Days'],
      ['last30Days', 'visitsLast30Days'],
    ] as const)('round-trips %s', (window, field) => {
      expect(visitsWindowOrderField(window)).toEqual(field);
      expect(parseVisitsWindowOrderField(field)).toEqual({ window, excludeBots: false });
      expect(parseVisitsWindowOrderField(`nonBotV${field.slice(1)}`)).toEqual({ window, excludeBots: true });
    });

    it.each([['visits'], ['nonBotVisits'], ['visitsLast1Day'], ['dateCreated'], [undefined], [3]])(
      'does not parse %s',
      (field) => {
        expect(parseVisitsWindowOrderField(field)).toBeUndefined();
      },
    );
  });

  describe('resolveVisitsWindowOrder', () => {
    it.each([
      [
        { orderBy: { field: 'visitsLast7Days', dir: 'DESC' } },
        { window: 'last7Days', excludeBots: false, dir: 'DESC' },
      ],
      [
        { orderBy: { field: 'nonBotVisitsLast24Hours', dir: 'ASC' } },
        { window: 'last24Hours', excludeBots: true, dir: 'ASC' },
      ],
      [{ orderBy: { field: 'visitsLast7Days' } }, undefined],
      [{ orderBy: { field: 'visits', dir: 'DESC' } }, undefined],
      [{}, undefined],
      [undefined, undefined],
    ])('resolves order from %s', (params, expected) => {
      expect(resolveVisitsWindowOrder(params)).toEqual(expected);
    });
  });

  describe('listShortUrlsOrderedByVisitsWindow', () => {
    const listShortUrls = vi.fn();
    const getNonOrphanVisits = vi.fn();
    const client = fromPartial<ShlinkApiClient>({ listShortUrls, getNonOrphanVisits });

    beforeEach(() => {
      listShortUrls.mockResolvedValue({
        data: [shortUrl('a'), shortUrl('b'), shortUrl('c'), shortUrl('d')],
        pagination: { currentPage: 1, pagesCount: 1, totalItems: 4 },
      });
      getNonOrphanVisits.mockResolvedValue({
        data: [
          visit('https://s.test/c'),
          visit('https://S.TEST/c/'),
          visit('https://s.test/a?utm_source=foo'),
          visit('https://s.test/c'),
          visit('https://s.test/a'),
          visit('https://s.test/b'),
          visit(null),
        ],
        pagination: { currentPage: 1, pagesCount: 1, totalItems: 7 },
      });
    });

    const codes = (result: { data: Array<{ shortCode: string }> }) => result.data.map(({ shortCode }) => shortCode);

    it('loads all matching short URLs and the visits in the window', async () => {
      await listShortUrlsOrderedByVisitsWindow(
        client,
        { page: '2', itemsPerPage: 5, searchTerm: 'foo', orderBy: { field: 'nonBotVisitsLast7Days', dir: 'DESC' } },
        { window: 'last7Days', excludeBots: true, dir: 'DESC' },
        now,
      );

      expect(listShortUrls).toHaveBeenCalledWith({
        searchTerm: 'foo',
        itemsPerPage: -1,
        orderBy: { field: 'dateCreated', dir: 'DESC' },
      });
      expect(getNonOrphanVisits).toHaveBeenCalledWith({
        startDate: '2026-10-04T12:00:00.000Z',
        excludeBots: true,
        itemsPerPage: 5000,
        page: 1,
      });
    });

    it.each([
      ['DESC', ['c', 'a', 'b', 'd']],
      ['ASC', ['d', 'b', 'a', 'c']],
    ] as const)('sorts by visits in %s order, keeping original order on ties', async (dir, expected) => {
      const result = await listShortUrlsOrderedByVisitsWindow(
        client,
        {},
        { window: 'last24Hours', excludeBots: false, dir },
        now,
      );
      expect(codes(result)).toEqual(expected);
    });

    it('keeps original order for short URLs with the same visits', async () => {
      getNonOrphanVisits.mockResolvedValue({ data: [], pagination: { currentPage: 1, pagesCount: 1, totalItems: 0 } });
      const result = await listShortUrlsOrderedByVisitsWindow(
        client,
        {},
        { window: 'last24Hours', excludeBots: false, dir: 'DESC' },
        now,
      );
      expect(codes(result)).toEqual(['a', 'b', 'c', 'd']);
    });

    it.each([
      [{ page: '1', itemsPerPage: 3 }, ['c', 'a', 'b'], { currentPage: 1, pagesCount: 2, totalItems: 4 }],
      [{ page: '2', itemsPerPage: 3 }, ['d'], { currentPage: 2, pagesCount: 2, totalItems: 4 }],
      [{ page: '9', itemsPerPage: 3 }, ['d'], { currentPage: 2, pagesCount: 2, totalItems: 4 }],
      [{}, ['c', 'a', 'b', 'd'], { currentPage: 1, pagesCount: 1, totalItems: 4 }],
    ])('paginates sorted results for %s', async (params, expectedCodes, expectedPagination) => {
      const result = await listShortUrlsOrderedByVisitsWindow(
        client,
        params,
        { window: 'last30Days', excludeBots: false, dir: 'DESC' },
        now,
      );
      expect(codes(result)).toEqual(expectedCodes);
      expect(result.pagination).toEqual(expectedPagination);
    });

    it('loads every page of visits', async () => {
      getNonOrphanVisits
        .mockResolvedValueOnce({ data: [visit('https://s.test/d')], pagination: { currentPage: 1, pagesCount: 2 } })
        .mockResolvedValueOnce({ data: [visit('https://s.test/d')], pagination: { currentPage: 2, pagesCount: 2 } });

      const result = await listShortUrlsOrderedByVisitsWindow(
        client,
        {},
        { window: 'last30Days', excludeBots: false, dir: 'DESC' },
        now,
      );

      expect(getNonOrphanVisits).toHaveBeenCalledTimes(2);
      expect(getNonOrphanVisits).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
      expect(codes(result)[0]).toEqual('d');
    });

    it('does not mix up short URLs with the same code in different domains', async () => {
      listShortUrls.mockResolvedValue({
        data: [shortUrl('a', 'one.test'), shortUrl('a', 'two.test')],
        pagination: { currentPage: 1, pagesCount: 1, totalItems: 2 },
      });
      getNonOrphanVisits.mockResolvedValue({
        data: [visit('https://two.test/a')],
        pagination: { currentPage: 1, pagesCount: 1, totalItems: 1 },
      });

      const result = await listShortUrlsOrderedByVisitsWindow(
        client,
        {},
        { window: 'last30Days', excludeBots: false, dir: 'DESC' },
        now,
      );

      expect(result.data.map(({ shortUrl }) => shortUrl)).toEqual(['https://two.test/a', 'https://one.test/a']);
    });
    it('does not send excludeBots to Shlink when bots are included', async () => {
      await listShortUrlsOrderedByVisitsWindow(
        client,
        {},
        { window: 'last24Hours', excludeBots: false, dir: 'DESC' },
        now,
      );
      expect(getNonOrphanVisits).toHaveBeenCalledWith(expect.objectContaining({ excludeBots: undefined }));
    });
  });
});
