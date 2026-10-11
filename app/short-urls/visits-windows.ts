export type VisitsWindow = 'last24Hours' | 'last7Days' | 'last30Days';

export type VisitsWindows = Record<VisitsWindow, number>;

const HOUR_MS = 60 * 60 * 1000;

const WINDOWS_HOURS: Record<VisitsWindow, number> = {
  last24Hours: 24,
  last7Days: 7 * 24,
  last30Days: 30 * 24,
};

export const VISITS_WINDOWS = Object.keys(WINDOWS_HOURS) as VisitsWindow[];

/** Windows are exact rolling periods ending now. "Last 7 days" are the last 7 * 24 hours, and so on. */
export const resolveWindowStartDate = (window: VisitsWindow, now = new Date()): string =>
  new Date(now.getTime() - WINDOWS_HOURS[window] * HOUR_MS).toISOString();

export const resolveWindowsStartDates = (now = new Date()): Record<VisitsWindow, string> =>
  Object.fromEntries(VISITS_WINDOWS.map((window) => [window, resolveWindowStartDate(window, now)])) as Record<
    VisitsWindow,
    string
  >;

/**
 * Short URLs list order fields used to sort by visits in a window, like `visitsLast7Days`.
 * The `nonBotVisits` prefix is used when bot visits are excluded, mirroring Shlink's `visits`/`nonBotVisits` fields.
 * These cannot contain dashes, as those are used to separate field and direction in the query string.
 */
const capitalize = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;

export const visitsWindowOrderField = (window: VisitsWindow) => `visits${capitalize(window)}`;

export const parseVisitsWindowOrderField = (
  field: unknown,
): { window: VisitsWindow; excludeBots: boolean } | undefined => {
  if (typeof field !== 'string') {
    return undefined;
  }

  const match = /^(visits|nonBotVisits)(\w+)$/.exec(field);
  const window = VISITS_WINDOWS.find((candidate) => capitalize(candidate) === match?.[2]);
  return match && window ? { window, excludeBots: match[1] === 'nonBotVisits' } : undefined;
};
