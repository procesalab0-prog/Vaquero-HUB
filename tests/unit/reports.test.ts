import { describe, expect, it } from "vitest";

import {
  isReportGrouping,
  reportDateRange,
  validReportDate,
} from "../../lib/reports";

describe("filtros de reportes", () => {
  it("acepta únicamente agrupaciones conocidas", () => {
    expect(isReportGrouping("day")).toBe(true);
    expect(isReportGrouping("week")).toBe(true);
    expect(isReportGrouping("quarter")).toBe(false);
  });

  it("descarta fechas imposibles o con otro formato", () => {
    expect(validReportDate("2026-09-08", "2026-01-01")).toBe("2026-09-08");
    expect(validReportDate("08/09/2026", "2026-01-01")).toBe("2026-01-01");
  });

  it("incluye completo el día final usando un límite exclusivo", () => {
    expect(reportDateRange("2026-09-01", "2026-09-08")).toEqual({
      from: "2026-09-01T06:00:00.000Z",
      to: "2026-09-09T06:00:00.000Z",
    });
  });
});
