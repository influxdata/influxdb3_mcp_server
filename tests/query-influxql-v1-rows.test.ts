import { describe, it, expect, vi } from "vitest";
import { QueryService } from "../src/services/query.service.js";
import { v1SeriesRows } from "../src/services/v1-query.js";
import { BaseConnectionService } from "../src/services/base-connection.service.js";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";

const MAPPED_EMPTY_BUCKET = { results: [{ statement_id: 0 }] };

const COUNT_OF_TWO = {
  results: [
    {
      statement_id: 0,
      series: [
        {
          name: "dup",
          columns: ["time", "count"],
          values: [["1970-01-01T00:00:00Z", 2]],
        },
      ],
    },
  ],
};

const THREE_POINTS_GROUPED_BY_HOST = {
  results: [
    {
      statement_id: 0,
      series: [
        {
          name: "cpu",
          tags: { host: "a" },
          columns: ["time", "usage"],
          values: [
            ["2026-11-24T00:00:00Z", 1.5],
            ["2026-11-24T00:00:10Z", 2.5],
          ],
        },
        {
          name: "cpu",
          tags: { host: "b" },
          columns: ["time", "usage"],
          values: [["2026-11-24T00:00:00Z", 3.5]],
        },
      ],
    },
  ],
};

describe("v1SeriesRows", () => {
  it("returns no rows for a statement without series", () => {
    expect(v1SeriesRows(MAPPED_EMPTY_BUCKET)).toEqual([]);
  });

  it("returns one row per value, keyed by column, with the measurement", () => {
    expect(v1SeriesRows(COUNT_OF_TWO)).toEqual([
      { "iox::measurement": "dup", time: "1970-01-01T00:00:00Z", count: 2 },
    ]);
  });

  it("carries each series' tags onto its rows", () => {
    expect(v1SeriesRows(THREE_POINTS_GROUPED_BY_HOST)).toEqual([
      {
        "iox::measurement": "cpu",
        host: "a",
        time: "2026-11-24T00:00:00Z",
        usage: 1.5,
      },
      {
        "iox::measurement": "cpu",
        host: "a",
        time: "2026-11-24T00:00:10Z",
        usage: 2.5,
      },
      {
        "iox::measurement": "cpu",
        host: "b",
        time: "2026-11-24T00:00:00Z",
        usage: 3.5,
      },
    ]);
  });

  it("returns no rows for a body that isn't a v1 response", () => {
    expect(v1SeriesRows(undefined)).toEqual([]);
    expect(v1SeriesRows({ unexpected: true })).toEqual([]);
  });
});

describe("query_influxql over v1 /query counts rows, not response bodies", () => {
  function serviceAnswering(type: InfluxProductType, body: unknown) {
    const base = {
      validateDataCapabilities: vi.fn(),
      getConnectionInfo: vi.fn().mockReturnValue({ type }),
      getInfluxHttpClient: vi
        .fn()
        .mockReturnValue({ get: vi.fn().mockResolvedValue(body) }),
      getClient: vi.fn().mockReturnValue(null),
    } as unknown as BaseConnectionService;
    return new QueryService(base);
  }

  it.each([
    ["cloud-dedicated", InfluxProductType.CloudDedicated],
    ["cloud-serverless", InfluxProductType.CloudServerless],
    ["clustered", InfluxProductType.Clustered],
  ])(
    "%s: a mapped, empty bucket is empty, with row_count 0",
    async (_, type) => {
      const result = await serviceAnswering(
        type,
        MAPPED_EMPTY_BUCKET,
      ).queryInfluxqlReadOnly("SELECT count(v) FROM dup", "mybucket");

      expect(result.access_outcome).toBe("empty");
      expect(result.rows).toEqual([]);
      expect(result.metadata.row_count).toBe(0);
    },
  );

  it.each([
    ["cloud-dedicated", InfluxProductType.CloudDedicated],
    ["cloud-serverless", InfluxProductType.CloudServerless],
    ["clustered", InfluxProductType.Clustered],
  ])("%s: three points in two series give row_count 3", async (_, type) => {
    const result = await serviceAnswering(
      type,
      THREE_POINTS_GROUPED_BY_HOST,
    ).queryInfluxqlReadOnly(
      "SELECT usage FROM cpu GROUP BY host LIMIT 10",
      "mybucket",
    );

    expect(result.access_outcome).toBe("data");
    expect(result.metadata.row_count).toBe(3);
    expect(result.rows[2]).toMatchObject({ host: "b", usage: 3.5 });
  });

  it("caps v1 rows at max_rows like the v3 path", async () => {
    const result = await serviceAnswering(
      InfluxProductType.CloudDedicated,
      THREE_POINTS_GROUPED_BY_HOST,
    ).queryInfluxqlReadOnly("SELECT usage FROM cpu GROUP BY host", "mybucket", {
      maxRows: 2,
    });

    expect(result.metadata.row_count).toBe(2);
    expect(result.metadata.completeness).toBe("capped");
  });
});
