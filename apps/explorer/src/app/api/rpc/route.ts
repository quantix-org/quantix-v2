import { type NextRequest, NextResponse } from "next/server";

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
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
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
