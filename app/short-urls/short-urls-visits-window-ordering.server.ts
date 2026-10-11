import type {
  ShlinkApiClient,
  ShlinkShortUrlsList,
  ShlinkShortUrlsListParams,
} from '@shlinkio/shlink-js-sdk/api-contract';
import type { VisitsWindow } from './visits-windows';
import { parseVisitsWindowOrderField, resolveWindowStartDate } from './visits-windows';

/** Same default used by Shlink when itemsPerPage is not provided */
const DEFAULT_ITEMS_PER_PAGE = 10;

const VISITS_PER_REQUEST = 5000;

type OrderDir = 'ASC' | 'DESC';

export type VisitsWindowOrder = { window: VisitsWindow; excludeBots: boolean; dir: OrderDir };

/** List params as sent by the short URLs table, where the order field can be one not supported by Shlink */
type ListParams = Omit<ShlinkShortUrlsListParams, 'orderBy'> & { orderBy?: { field?: string; dir?: string } };

/** Returns the visits window order requested in list params, if any */
export function resolveVisitsWindowOrder(params: unknown): VisitsWindowOrder | undefined {
  const orderBy = (params as ListParams | undefined)?.orderBy;
  const parsed = parseVisitsWindowOrderField(orderBy?.field);
  const dir = orderBy?.dir;
  return parsed && (dir === 'ASC' || dir === 'DESC') ? { ...parsed, dir } : undefined;
}

/** Visits only carry the URL that was visited, so short URLs are matched by host and path */
const urlKey = (url: string) => {
  const { host, pathname } = new URL(url);
  return `${host.toLowerCase()}${pathname.replace(/\/+$/, '')}`;
};

async function countVisitsPerShortUrl(
  client: ShlinkApiClient,
  { window, excludeBots }: VisitsWindowOrder,
  now: Date,
): Promise<Map<string, number>> {
  const startDate = resolveWindowStartDate(window, now);
  const counts = new Map<string, number>();
  let page = 1;
  let pagesCount = 1;

  do {
    const { data, pagination } = await client.getNonOrphanVisits({
      startDate,
      // Shlink treats any value as true, including "false", so the param can only be sent when bots need to be excluded
      excludeBots: excludeBots || undefined,
      itemsPerPage: VISITS_PER_REQUEST,
      page,
    });
    data.forEach(({ visitedUrl }) => {
      if (visitedUrl) {
        const key = urlKey(visitedUrl);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    });
    pagesCount = pagination.pagesCount;
    page++;
  } while (page <= pagesCount);

  return counts;
}

/**
 * Shlink cannot sort short URLs by the visits they got in a time window, so every short URL matching the filters is
 * loaded, sorted here by its visits in the window, and the requested page is sliced from the result.
 */
export async function listShortUrlsOrderedByVisitsWindow(
  client: ShlinkApiClient,
  params: unknown,
  order: VisitsWindowOrder,
  now = new Date(),
): Promise<ShlinkShortUrlsList> {
  const { orderBy: _orderBy, page, itemsPerPage, ...filters } = (params ?? {}) as ListParams;
  const [{ data: shortUrls }, visitsPerShortUrl] = await Promise.all([
    // Newest first, so that short URLs with the same amount of visits keep that order
    client.listShortUrls({ ...filters, itemsPerPage: -1, orderBy: { field: 'dateCreated', dir: 'DESC' } }),
    countVisitsPerShortUrl(client, order, now),
  ]);

  const visitsFor = ({ shortUrl }: { shortUrl: string }) => visitsPerShortUrl.get(urlKey(shortUrl)) ?? 0;
  const dirMultiplier = order.dir === 'ASC' ? 1 : -1;
  const sorted = shortUrls.toSorted((a, b) => (visitsFor(a) - visitsFor(b)) * dirMultiplier);

  const perPage = itemsPerPage && itemsPerPage > 0 ? itemsPerPage : DEFAULT_ITEMS_PER_PAGE;
  const pagesCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), pagesCount);

  return {
    data: sorted.slice((currentPage - 1) * perPage, currentPage * perPage),
    pagination: { currentPage, pagesCount, totalItems: sorted.length },
  };
}
