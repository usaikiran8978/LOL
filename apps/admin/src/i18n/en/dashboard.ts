/** English copy for the dashboard module (merged into `en` as `dashboard.*`). */
export const dashboard = {
  title: 'Dashboard',
  intro: 'Live counters and daily KPI trends (UTC days).',
  range: 'Time range',
  rangeDays: 'Last {days} days',
  live: {
    title: 'Live counters',
    total_users: 'Total users',
    active_users: 'Active in the last 24 h',
    premium: 'Premium users',
    open_cases: 'Open moderation cases',
    breached: 'Cases past SLA',
  },
  trend: {
    title: 'Trend',
    metric: 'Metric',
  },
  latest: {
    title: 'Latest values',
    metric: 'Metric',
    date: 'Latest day',
    value: 'Value',
    dimension: 'Dimension',
    show: 'Show trend',
    showFor: 'Show trend for {metric}',
  },
  empty: 'No KPI values have been computed for this range yet.',
  noLive: 'Live counters are unavailable.',
  exportCsv: 'Export CSV',
  exportLabel: 'Export metrics for the last {days} days as CSV',
  exported: 'CSV export downloaded.',
};
