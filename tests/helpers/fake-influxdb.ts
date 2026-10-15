import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import { setTimeout } from "node:timers";

export interface FakeRequest {
  method: string;
  path: string;
  db?: string;
  q?: string;
}

export interface FakeReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
}

/** Scripted HTTP boundary shared by protocol tests. No credential recording. */
export async function startFakeInflux(
  respond: (request: FakeRequest) => FakeReply,
) {
  const requests: FakeRequest[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    const request = {
      method: req.method || "GET",
      path: url.pathname,
      db: payload.db ?? url.searchParams.get("db") ?? undefined,
      q: payload.q ?? url.searchParams.get("q") ?? undefined,
    };
    requests.push(request);
    const reply = respond(request);
    if (reply.delayMs)
      await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    res.writeHead(reply.status, {
      "Content-Type": "application/json",
      ...reply.headers,
    });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
