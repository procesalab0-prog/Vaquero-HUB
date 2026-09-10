export const REPORT_GROUPINGS = ["day", "week", "month", "year"] as const;

export type ReportGrouping = (typeof REPORT_GROUPINGS)[number];

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isReportGrouping(value: string): value is ReportGrouping {
  return REPORT_GROUPINGS.includes(value as ReportGrouping);
}

export function validReportDate(value: string | undefined, fallback: string) {
  if (!value || !datePattern.test(value)) return fallback;
  const parsed = new Date(`${value}T12:00:00-06:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : value;
}

export function reportDateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00-06:00`);
  const end = new Date(`${to}T00:00:00-06:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function reportDefaultDates(reference = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Mexico_City",
  });
  const to = formatter.format(reference);
  const fromDate = new Date(reference);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  return { from: formatter.format(fromDate), to };
}
