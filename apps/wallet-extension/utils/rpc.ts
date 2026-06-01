function normalizeRpcEndpoint(endpoint: string): string[] {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) return [];

  const candidates = new Set<string>([trimmed]);

  try {
    const url = new URL(trimmed);
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/rpc";
      candidates.add(url.toString().replace(/\/+$/, ""));
    } else if (!url.pathname.endsWith("/rpc")) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/rpc`;
      candidates.add(url.toString().replace(/\/+$/, ""));
    }
  } catch {
    if (!trimmed.endsWith("/rpc")) {
      candidates.add(`${trimmed}/rpc`);
    }
  }

  return [...candidates];
}

async function callRpcOnce<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message ?? "RPC error");
  }

  return json.result as T;
}

export async function rpcCall<T>(endpoint: string, method: string, params: unknown[] = []): Promise<T> {
  const attempts = normalizeRpcEndpoint(endpoint);
  let lastError: unknown;

  for (const candidate of attempts) {
    try {
      return await callRpcOnce<T>(candidate, method, params);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("RPC request failed");
}