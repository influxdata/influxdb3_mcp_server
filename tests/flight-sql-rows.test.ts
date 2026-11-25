import { describe, expect, it, vi } from "vitest";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import { QueryService } from "../src/services/query.service.js";
import { BaseConnectionService } from "../src/services/base-connection.service.js";

const FLIGHT_PRODUCTS = [
  ["cloud-dedicated", InfluxProductType.CloudDedicated],
  ["cloud-serverless", InfluxProductType.CloudServerless],
] as const;

function serviceReturningRows(
  type: InfluxProductType,
  rows: Record<string, unknown>[],
) {
  const client = {
    query: vi.fn().mockReturnValue(
      (async function* () {
        yield* rows;
      })(),
    ),
  };
  const base = {
    validateDataCapabilities: vi.fn(),
    getConnectionInfo: vi.fn().mockReturnValue({ type }),
    getInfluxHttpClient: vi.fn(),
    getClient: vi.fn().mockReturnValue(client),
  } as unknown as BaseConnectionService;
  return { service: new QueryService(base), client };
}

describe("Flight SQL rows on Cloud Dedicated and Cloud Serverless", () => {
  it.each(FLIGHT_PRODUCTS)(
    "%s keeps Int64 aggregates, which the client library returns as bigint",
    async (_name, type) => {
      const { service } = serviceReturningRows(type, [
        { n: 2n, count_v: 2n, sum_v: 3 },
      ]);

      const rows = await service.executeQuery(
        "SELECT COUNT(*) AS n, COUNT(v) AS count_v, SUM(v) AS sum_v FROM m",
        "db",
      );

      expect(rows).toEqual([{ n: 2, count_v: 2, sum_v: 3 }]);
      expect(() => JSON.stringify(rows)).not.toThrow();
    },
  );

  it("returns an Int64 beyond the exact Number range as a string", async () => {
    const { service } = serviceReturningRows(
      InfluxProductType.CloudServerless,
      [{ big: 9007199254740993n }],
    );

    const rows = await service.executeQuery("SELECT big FROM m", "db");

    expect(rows).toEqual([{ big: "9007199254740993" }]);
  });

  it("returns flat rows with time as an ISO 8601 string", async () => {
    const { service } = serviceReturningRows(InfluxProductType.CloudDedicated, [
      { time: 1700000010000, host: "h", v: 10 },
    ]);

    const rows = await service.executeQuery("SELECT * FROM e2e_rw", "db");

    expect(rows).toEqual([
      { time: "2023-11-14T22:13:30.000Z", host: "h", v: 10 },
    ]);
  });

  it("lists Cloud Serverless tables from plain rows", async () => {
    const { service } = serviceReturningRows(
      InfluxProductType.CloudServerless,
      [{ table_name: "e2e_rw" }, { table_name: "cpu" }],
    );

    const tables = await service.getMeasurements("bucket");

    expect(tables).toEqual([{ name: "e2e_rw" }, { name: "cpu" }]);
  });

  it("describes a Cloud Serverless table from plain rows", async () => {
    const { service } = serviceReturningRows(
      InfluxProductType.CloudServerless,
      [
        { column_name: "time", data_type: "Timestamp(Nanosecond, None)" },
        { column_name: "host", data_type: "Dictionary(Int32, Utf8)" },
        { column_name: "v", data_type: "Float64" },
      ],
    );

    const schema = await service.getMeasurementSchema("e2e_rw", "bucket");

    expect(
      schema.columns.map((column) => [column.name, column.category]),
    ).toEqual([
      ["time", "time"],
      ["host", "tag"],
      ["v", "unknown"],
    ]);
  });
});
