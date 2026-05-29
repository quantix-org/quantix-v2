import { type NextRequest, NextResponse } from "next/server";

/**
 * Server-side RPC proxy.
 * Forwards JSON-RPC requests to the Quantix node.
 * Reads NODE_RPC_URL from server env (never exposed to client).
 * Falls back to NEXT_PUBLIC_RPC_URL for convenience in dev.
 */
export async function POST(req: NextRequest) {
  const nodeUrl =
    process.env.NODE_RPC_URL ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    "http://localhost:7330/rpc";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(nodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upstream error";
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: msg } },
      { status: 502 }
    );
  }
}
