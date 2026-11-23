import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hasExplicitTimestamp,
  operationErrorDetails,
  resolveWriteError,
} from "../src/services/error-resolution.service.js";
import {
  ENT_400_EXPLICIT_SCHEMA_UNDECLARED_FIELD_ON_LINE_2,
  ENT_400_EXPLICIT_SCHEMA_UNDECLARED_TABLE,
  ENT_401_INVALID_TOKEN,
  ENT_403_WRITE_WITH_READ_ONLY_TOKEN,
  ENT_500_WRITE_TO_PROCESS_ONLY_NODE,
  BATCH_REJECTING_LINES_2_AND_3,
  WRITE_400_NO_PARTIAL_REJECTS_LINE_2,
  WRITE_400_ACCEPT_PARTIAL_REJECTS_LINES_2_AND_3,
  CORE_429_V3_WAL_BUFFER_FULL,
  CORE_429_V2_WAL_BUFFER_FULL,
  SYNTHETIC_429_RETRY_AFTER_2S,
} from "./fixtures/write-errors-3.12.2.js";
import { SYNTHETIC_503_WITHOUT_BODY } from "./fixtures/write-errors.js";
import { startFakeInfluxDB, FakeInfluxDB } from "./helpers/fake-influxdb.js";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";
import { expectValidEnvelope } from "./helpers/envelope.js";

const coreEnterprise = (lineProtocol: string, acceptPartial = true) => ({
  lineProtocol,
  acceptPartial,
});

describe("resolveWriteError", () => {
  it("lists every rejected line and infers that the rest were stored", () => {
    const error = resolveWriteError(
      WRITE_400_ACCEPT_PARTIAL_REJECTS_LINES_2_AND_3,
      "db",
      coreEnterprise(BATCH_REJECTING_LINES_2_AND_3),
    );
    expect(error.code).toBe("write_lines_rejected");
    expect(error.recovery).toBe("none");
    expect(error.status).toBe(400);
    expect(error.message).toContain("line 2: invalid column type");
    expect(error.message).toContain("line 3: No fields were provided");
    expect(error.write).toEqual({
      accept_partial: true,
      stored: "some",
      stored_source: "inferred",
      lines_submitted: 4,
      lines_rejected: 2,
      rejected_lines: [
        expect.objectContaining({ line_number: 2 }),
        expect.objectContaining({ line_number: 3 }),
      ],
      rejected_lines_truncated: false,
    });
    expect(error.fix).toMatch(/resend only the rejected lines/);
  });

  it("reports nothing stored when accept_partial=false", () => {
    const error = resolveWriteError(
      WRITE_400_NO_PARTIAL_REJECTS_LINE_2,
      "db",
      coreEnterprise("m,host=a v=4 1700000004\nbad line here", false),
    );
    expect(error.code).toBe("write_lines_rejected");
    expect(error.write?.stored).toBe("none");
    expect(error.write?.lines_rejected).toBe(1);
    expect(error.fix).toMatch(/Nothing from this request was written/);
  });

  it("reports nothing stored when every line is rejected, even with accept_partial=true", () => {
    const error = resolveWriteError(
      ENT_400_EXPLICIT_SCHEMA_UNDECLARED_TABLE,
      "db",
      coreEnterprise("nope,host=a usage=1.0 1700000000"),
    );
    expect(error.write?.stored).toBe("none");
  });

  it("leaves stored unknown when the path doesn't send accept_partial", () => {
    const error = resolveWriteError(
      WRITE_400_ACCEPT_PARTIAL_REJECTS_LINES_2_AND_3,
      "db",
      {
        lineProtocol: BATCH_REJECTING_LINES_2_AND_3,
      },
    );
    expect(error.write?.stored).toBe("unknown");
    expect(error.write).not.toHaveProperty("accept_partial");
  });

  it("classifies an explicit-schema rejection as fix_reference and says who declares it", () => {
    const error = resolveWriteError(
      ENT_400_EXPLICIT_SCHEMA_UNDECLARED_FIELD_ON_LINE_2,
      "db",
      coreEnterprise("t,host=a usage=1.0 1\nt,host=a temp=2.0 2"),
    );
    expect(error.code).toBe("write_schema_not_declared");
    expect(error.recovery).toBe("fix_reference");
    expect(error.message).toContain("column 'temp'");
    expect(error.fix).toMatch(/describe_table/);
    expect(error.fix).toMatch(/\/api\/v3\/configure\/table/);
    expect(error.write?.stored).toBe("some");
  });

  it("treats a 403 as a denial not to retry", () => {
    const error = resolveWriteError(
      ENT_403_WRITE_WITH_READ_ONLY_TOKEN,
      "db",
      coreEnterprise("m v=1"),
    );
    expect(error.code).toBe("not_found_or_denied");
    expect(error.recovery).toBe("none");
    expect(error.message).toMatch(/^Access denied: /);
    expect(error.write).toBeUndefined();
  });

  it("asks for a new credential on a 401", () => {
    const error = resolveWriteError(
      ENT_401_INVALID_TOKEN,
      "db",
      coreEnterprise("m v=1"),
    );
    expect(error.code).toBe("credential_invalid");
    expect(error.recovery).toBe("renew_credential");
    expect(error.message).toContain("the request was not authenticated");
  });

  it("points a write at an ingest node when the node lacks ingest mode", () => {
    const error = resolveWriteError(
      ENT_500_WRITE_TO_PROCESS_ONLY_NODE,
      "db",
      coreEnterprise("m v=1"),
    );
    expect(error.code).toBe("write_node_not_ingest");
    expect(error.recovery).toBe("change_endpoint");
    expect(error.fix).toMatch(/ingest node/);
  });

  it.each([
    ["a recorded WAL-full 429", CORE_429_V3_WAL_BUFFER_FULL, undefined],
    ["a 429 with Retry-After", SYNTHETIC_429_RETRY_AFTER_2S, 2000],
    ["a 503", SYNTHETIC_503_WITHOUT_BODY, undefined],
  ])("makes %s retryable", (_case, fixture, retryAfter) => {
    const error = resolveWriteError(fixture, "db", coreEnterprise("m v=1"));
    expect(error.code).toBe("write_unavailable");
    expect(error.recovery).toBe("retry");
    expect(error.retry_after_ms).toBe(retryAfter);
    expect(operationErrorDetails(error, "write_failed").retryable).toBe(true);
  });

  it("caps the message at five lines but keeps the full list up to 100", () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({
      error_message: "No fields were provided",
      line_number: i + 1,
      original_line: "bad",
    }));
    const error = resolveWriteError(
      {
        response: {
          status: 400,
          data: {
            error: "partial write of line protocol occurred",
            data: entries,
          },
        },
      },
      "db",
      coreEnterprise(Array(130).fill("bad").join("\n")),
    );
    expect(error.message).toContain("and 115 more rejected lines");
    expect(error.write?.rejected_lines).toHaveLength(100);
    expect(error.write?.rejected_lines_truncated).toBe(true);
    expect(error.write?.lines_rejected).toBe(120);
    expect(error.write?.stored).toBe("some");
  });

  it("falls back to write_failed with the database name when there's no response", () => {
    const error = resolveWriteError(
      new Error("connect ECONNREFUSED"),
      "some_db",
      coreEnterprise("m v=1"),
    );
    expect(error.code).toBe("write_failed");
    expect(error.message).toContain("some_db");
  });
});

it.each([
  ["v3 plain text", CORE_429_V3_WAL_BUFFER_FULL, "wal buffer is full"],
  ["v2 JSON", CORE_429_V2_WAL_BUFFER_FULL, "wal buffer full with 1 ops"],
])(
  "retries a WAL-full 429 (%s) and passes its text through",
  (_body, fixture, text) => {
    const error = resolveWriteError(fixture, "db", coreEnterprise("m v=1"));
    expect(error.code).toBe("write_unavailable");
    expect(error.recovery).toBe("retry");
    expect(error.message).toContain(text);
  },
);

const networkError = (code: string) =>
  Object.assign(new Error(`connect ${code}`), { code });

const GATEWAY_TIMEOUT_504 = {
  response: { status: 504, statusText: "Gateway Timeout", data: "" },
  message: "Request failed with status code 504",
};

const TIMESTAMPED_BATCH = "m,host=a v=1 1700000000\nm,host=b v=2 1700000001";
const BATCH_WITH_UNTIMESTAMPED_LINE = "m,host=a v=1 1700000000\nm,host=b v=2";

describe("write failures where the server may not have answered", () => {
  it("retries a refused connection and says nothing was written", () => {
    const error = resolveWriteError(
      networkError("ECONNREFUSED"),
      "db",
      coreEnterprise(BATCH_WITH_UNTIMESTAMPED_LINE),
    );
    expect(error.code).toBe("write_connection_refused");
    expect(error.recovery).toBe("retry");
    expect(error.fix).toMatch(/nothing was written/);
    expect(error.fix).not.toMatch(/second point/);
    expect(operationErrorDetails(error, "write_failed").retryable).toBe(true);
  });

  it.each([
    ["a reset connection", networkError("ECONNRESET")],
    ["a 504 from a gateway", GATEWAY_TIMEOUT_504],
  ])("retries %s and leaves the outcome unknown", (_case, failure) => {
    const error = resolveWriteError(
      failure,
      "db",
      coreEnterprise(TIMESTAMPED_BATCH),
    );
    expect(error.code).toBe("write_outcome_unknown");
    expect(error.recovery).toBe("retry");
    expect(error.fix).toMatch(/may .*been stored/);
    expect(error.fix).not.toMatch(/second point/);
  });

  it.each([
    ["a reset connection", networkError("ECONNRESET")],
    ["a 504 from a gateway", GATEWAY_TIMEOUT_504],
  ])(
    "doesn't retry %s when a line has no timestamp, because a resend adds a second point",
    (_case, failure) => {
      const error = resolveWriteError(
        failure,
        "db",
        coreEnterprise(BATCH_WITH_UNTIMESTAMPED_LINE),
      );
      expect(error.code).toBe("write_outcome_unknown");
      expect(error.recovery).toBe("none");
      expect(operationErrorDetails(error, "write_failed").retryable).toBe(
        false,
      );
      expect(error.fix).toMatch(/second point at a later time/);
      expect(error.fix).toMatch(/Don't resend automatically/);
    },
  );
});

describe("hasExplicitTimestamp", () => {
  it.each([
    ["m,host=a v=1 1700000000", true],
    ["m v=1 -5", true],
    ["m,host=a v=1", false],
    ['m s="text with 123" ', false],
    ['m s="a b 123"', false],
    ['m s="a b" 123', true],
    ["m\\ name,tag\\ key=v\\ 1 f=1", false],
    ["m\\ name,tag\\ key=v\\ 1 f=1 99", true],
  ])("%s → %s", (line, expected) => {
    expect(hasExplicitTimestamp(line)).toBe(expected);
  });
});

describe("write_line_protocol error response", () => {
  let fake: FakeInfluxDB;
  let client: TestClient;

  beforeAll(async () => {
    fake = await startFakeInfluxDB([
      {
        name: "partial write, two lines rejected",
        provenance: {
          products: ["core", "enterprise"],
          version: "3.12.2",
          source: "live",
          detail:
            "2026-11-20 testbench Core and Enterprise node0. The shape is claim-20261120-0011 (Core) and claim-20261120-0012 (Enterprise).",
        },
        request: { method: "POST", path: "/api/v3/write_lp" },
        response: {
          status: 400,
          headers: { "content-type": "application/json" },
          body: WRITE_400_ACCEPT_PARTIAL_REJECTS_LINES_2_AND_3.response
            .data as object,
        },
      },
    ]);
    client = await createTestClient({
      INFLUX_DB_INSTANCE_URL: fake.url,
      INFLUX_DB_PRODUCT_TYPE: "core",
    });
  });

  afterAll(async () => {
    await client?.close();
    await fake?.close();
  });

  it("keeps the text error format and puts the envelope in structuredContent", async () => {
    const result = (await client.client.callTool({
      name: "write_line_protocol",
      arguments: {
        database: "db",
        data: BATCH_REJECTING_LINES_2_AND_3,
        precision: "second",
      },
    })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
      structuredContent?: any;
    };

    expect(result.isError).toBe(true);
    const [message, fix] = result.content[0].text.split("\n");
    expect(message).toMatch(/^Error: Bad request: line 2: .*; line 3: /);
    expect(fix).toMatch(/resend only the rejected lines/);

    const envelope = result.structuredContent;
    expectValidEnvelope(envelope, "write_line_protocol structuredContent");
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toMatchObject({
      code: "write_lines_rejected",
      recovery: "none",
      retryable: false,
      status: 400,
      fix,
    });
    expect(envelope.write).toMatchObject({
      accept_partial: true,
      stored: "some",
      lines_submitted: 4,
      lines_rejected: 2,
    });
    const writes = fake.requests.filter((r) => r.path === "/api/v3/write_lp");
    expect(writes).toHaveLength(1);
  });
});
