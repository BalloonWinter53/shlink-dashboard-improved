import type { ShortUrlsTableExtraColumn, ShortUrlsTableExtraColumnCellProps } from '@shlinkio/shlink-web-component';
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import type { ShortUrlVisitsWindowsLoader, VisitsWindow, VisitsWindows } from './ShortUrlVisitsWindowsLoader.client';
import { VISITS_WINDOWS_DEFAULT_ORDER_DIR, visitsWindowOrderField } from './visits-windows';

const numberFormatter = new Intl.NumberFormat();

type LoadState = { status: 'loading' } | { status: 'loaded'; visits: VisitsWindows | null };

const createVisitsWindowCell = (
  loader: ShortUrlVisitsWindowsLoader,
  window: VisitsWindow,
): FC<ShortUrlsTableExtraColumnCellProps> =>
  function VisitsWindowCell({ shortUrl, excludeBots }) {
    const [state, setState] = useState<LoadState>({ status: 'loading' });

    useEffect(() => {
      let cancelled = false;
      void loader.load(shortUrl, excludeBots).then((visits) => {
        if (!cancelled) {
          setState({ status: 'loaded', visits });
        }
      });

      return () => {
        cancelled = true;
      };
    }, [shortUrl, excludeBots]);

    if (state.status === 'loading') {
      return (
        <span className="text-placeholder" aria-label="Loading">
          …
        </span>
      );
    }

    if (!state.visits) {
      return (
        <span className="text-placeholder cursor-help" title="Visits could not be loaded">
          -
        </span>
      );
    }

    return <strong>{numberFormatter.format(state.visits[window])}</strong>;
  };

const COLUMNS: Array<{ window: VisitsWindow; name: string }> = [
  { window: 'last24Hours', name: 'Last 24 hours' },
  { window: 'last7Days', name: 'Last 7 days' },
  { window: 'last30Days', name: 'Last 30 days' },
];

export const createVisitsWindowsColumns = (loader: ShortUrlVisitsWindowsLoader): ShortUrlsTableExtraColumn[] =>
  COLUMNS.map(({ window, name }) => ({
    key: `visits-${window}`,
    name: `Visits ${name.toLowerCase()}`,
    header: (
      <span className="whitespace-nowrap" title={`Visits ${name.toLowerCase()}`}>
        {name}
      </span>
    ),
    className: 'lg:text-right',
    orderField: visitsWindowOrderField(window),
    defaultOrderDir: VISITS_WINDOWS_DEFAULT_ORDER_DIR,
    Cell: createVisitsWindowCell(loader, window),
  }));
