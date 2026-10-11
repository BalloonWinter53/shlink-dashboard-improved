import { ErrorType } from '@shlinkio/shlink-js-sdk/api-contract';
import type { ActionFunctionArgs } from 'react-router';
import { z } from 'zod';
import type { ApiClientBuilder } from '../api/apiClientBuilder.server';
import { AuthHelper } from '../auth/auth-helper.server';
import { serverContainer } from '../container/container.server';
import { ServersService } from '../servers/ServersService.server';
import { problemDetails } from '../utils/response.server';

const MAX_CONCURRENT_REQUESTS = 10;

const VISITS_WINDOWS_SCHEMA = z.object({
  shortUrls: z
    .array(z.object({ shortCode: z.string().min(1), domain: z.string().nullable().optional() }))
    .min(1)
    .max(100),
  // Map of window name -> ISO start date. The end of every window is "now"
  windows: z
    .record(z.string().min(1).max(50), z.iso.datetime({ offset: true }))
    .refine((windows) => Object.keys(windows).length <= 5, 'A maximum of 5 windows is allowed'),
  excludeBots: z.boolean().optional(),
});

export type ShortUrlVisitsWindowsResult = {
  shortCode: string;
  domain: string | null;
  /** Amount of visits per window, or null if they could not be loaded */
  visits: Record<string, number> | null;
};

/** Runs the callbacks with a maximum amount of them in flight at the same time */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/**
 * Resolves the amount of visits that a list of short URLs received since a set of start dates.
 * Short URLs that fail to load resolve with `visits: null`, so that one failure does not break the rest.
 */
export async function action(
  { params, request, url }: ActionFunctionArgs,
  serversService: ServersService = serverContainer[ServersService.name],
  createApiClient: ApiClientBuilder = serverContainer.apiClientBuilder,
  authHelper: AuthHelper = serverContainer[AuthHelper.name],
  console_ = console,
) {
  const sessionData = await authHelper.getSession(request, url);
  if (!sessionData) {
    return problemDetails({
      status: 403,
      type: 'https://shlink.io/api/error/access-denied',
      title: 'Access denied',
      detail: 'You need to log-in to fetch data from Shlink',
    });
  }

  const { serverId = '' } = params;
  let server;
  try {
    server = await serversService.getByPublicIdAndUser(serverId, sessionData.publicId);
  } catch {
    return problemDetails({
      status: 404,
      type: ErrorType.NOT_FOUND,
      title: 'Server not found',
      detail: `Server with ID ${serverId} not found`,
      serverId,
    });
  }

  const parsed = VISITS_WINDOWS_SCHEMA.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return problemDetails({
      status: 400,
      type: 'https://shlink.io/api/error/invalid-arguments',
      title: 'Invalid arguments',
      detail: 'Provided arguments are not valid to resolve short URL visits',
    });
  }

  const { shortUrls, windows } = parsed.data;
  // Shlink treats any value as true, including "false", so the param can only be sent when bots need to be excluded
  const excludeBots = parsed.data.excludeBots || undefined;
  const windowEntries = Object.entries(windows);
  const client = createApiClient(server);

  // One task per short URL and window. Only the pagination total is needed, so a single visit per page is requested
  const tasks = shortUrls.flatMap(({ shortCode, domain }) =>
    windowEntries.map(
      ([, startDate]) =>
        () =>
          client
            .getShortUrlVisits({ shortCode, domain }, { startDate, excludeBots, itemsPerPage: 1, page: 1 })
            .then(({ pagination }) => pagination.totalItems)
            .catch((e) => {
              console_.error(e);
              return null;
            }),
    ),
  );
  const counts = await runWithConcurrency(tasks, MAX_CONCURRENT_REQUESTS);

  const results: ShortUrlVisitsWindowsResult[] = shortUrls.map(({ shortCode, domain }, shortUrlIndex) => {
    const shortUrlCounts = counts.slice(
      shortUrlIndex * windowEntries.length,
      (shortUrlIndex + 1) * windowEntries.length,
    );
    const visits = shortUrlCounts.some((count) => count === null)
      ? null
      : Object.fromEntries(windowEntries.map(([name], windowIndex) => [name, shortUrlCounts[windowIndex] as number]));

    return { shortCode, domain: domain ?? null, visits };
  });

  return Response.json({ results });
}
