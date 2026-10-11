import type { ShlinkApiClient } from '@shlinkio/shlink-js-sdk/api-contract';
import { fromPartial } from '@total-typescript/shoehorn';
import type { ActionFunctionArgs } from 'react-router';
import type { AuthHelper } from '../../app/auth/auth-helper.server';
import { action } from '../../app/routes/short-urls-visits-windows';
import type { ServersService } from '../../app/servers/ServersService.server';

describe('short-urls-visits-windows', () => {
  const getByPublicIdAndUser = vi.fn();
  const serversService = fromPartial<ServersService>({ getByPublicIdAndUser });
  const getShortUrlVisits = vi.fn();
  const createApiClient = vi.fn().mockReturnValue(fromPartial<ShlinkApiClient>({ getShortUrlVisits }));
  const getSession = vi.fn();
  const authHelper = fromPartial<AuthHelper>({ getSession });
  const consoleError = vi.fn();

  const setUp = () => (args: ActionFunctionArgs) =>
    action(args, serversService, createApiClient, authHelper, fromPartial({ error: consoleError }));
  const requestWithBody = (body: unknown) => fromPartial<Request>({ json: () => Promise.resolve(body) });
  const windows = { today: '2026-10-11T00:00:00.000Z', last7Days: '2026-10-05T00:00:00.000Z' };

  it('returns error when user is not authenticated', async () => {
    getSession.mockResolvedValue(undefined);
    const resp = await setUp()(fromPartial({ request: {} }));

    expect(resp.status).toEqual(403);
    expect(getByPublicIdAndUser).not.toHaveBeenCalled();
  });

  it('returns error if server is not found', async () => {
    getSession.mockResolvedValue({ publicId: '123' });
    getByPublicIdAndUser.mockRejectedValue(new Error('Server not found'));
    const resp = await setUp()(fromPartial({ request: {}, params: { serverId: 'abc' } }));

    expect(resp.status).toEqual(404);
    expect(createApiClient).not.toHaveBeenCalled();
  });

  it.each([
    [undefined],
    [{}],
    [{ shortUrls: [], windows }],
    [{ shortUrls: [{ shortCode: 'foo' }], windows: { today: 'not-a-date' } }],
    [{ shortUrls: Array.from({ length: 101 }, (_, i) => ({ shortCode: `${i}` })), windows }],
  ])('returns error if body is invalid', async (body) => {
    getSession.mockResolvedValue({ publicId: '123' });
    getByPublicIdAndUser.mockResolvedValue({});
    const resp = await setUp()(fromPartial({ request: requestWithBody(body), params: { serverId: 'abc' } }));

    expect(resp.status).toEqual(400);
    expect(getShortUrlVisits).not.toHaveBeenCalled();
  });

  it('resolves amount of visits for every short URL and window', async () => {
    getSession.mockResolvedValue({ publicId: '123' });
    getByPublicIdAndUser.mockResolvedValue({});
    getShortUrlVisits.mockImplementation(async ({ shortCode }, { startDate }) => {
      if (shortCode === 'fails') {
        throw new Error('Error loading visits');
      }
      const base = shortCode === 'foo' ? 10 : 20;
      return { pagination: { totalItems: startDate === windows.today ? base : base * 3 } };
    });

    const resp = await setUp()(
      fromPartial({
        request: requestWithBody({
          shortUrls: [{ shortCode: 'foo' }, { shortCode: 'bar', domain: 's.test' }, { shortCode: 'fails' }],
          windows,
          excludeBots: true,
        }),
        params: { serverId: 'abc' },
      }),
    );

    expect(resp.status).toEqual(200);
    expect(await resp.json()).toEqual({
      results: [
        { shortCode: 'foo', domain: null, visits: { today: 10, last7Days: 30 } },
        { shortCode: 'bar', domain: 's.test', visits: { today: 20, last7Days: 60 } },
        { shortCode: 'fails', domain: null, visits: null },
      ],
    });
    expect(getShortUrlVisits).toHaveBeenCalledTimes(6);
    expect(getShortUrlVisits).toHaveBeenCalledWith(
      { shortCode: 'bar', domain: 's.test' },
      { startDate: windows.last7Days, excludeBots: true, itemsPerPage: 1, page: 1 },
    );
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it.each([[false], [undefined]])('does not send excludeBots to Shlink when it is %s', async (excludeBots) => {
    getSession.mockResolvedValue({ publicId: '123' });
    getByPublicIdAndUser.mockResolvedValue({});
    getShortUrlVisits.mockResolvedValue({ pagination: { totalItems: 1 } });

    await setUp()(
      fromPartial({
        request: requestWithBody({ shortUrls: [{ shortCode: 'foo' }], windows: { today: windows.today }, excludeBots }),
        params: { serverId: 'abc' },
      }),
    );

    expect(getShortUrlVisits).toHaveBeenCalledWith(
      { shortCode: 'foo', domain: undefined },
      { startDate: windows.today, excludeBots: undefined, itemsPerPage: 1, page: 1 },
    );
  });
});
