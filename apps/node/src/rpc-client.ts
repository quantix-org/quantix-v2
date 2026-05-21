import { RpcError, RpcErrorCode } from "./rpc-errors.js";

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number = 2500,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${Date.now()}:${Math.random()}`,
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RpcError(RpcErrorCode.INTERNAL_ERROR, `peer RPC HTTP ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new RpcError(payload.error.code, payload.error.message, payload.error.data);
    }

    return payload.result as T;
  } catch (error) {
    if (error instanceof RpcError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new RpcError(RpcErrorCode.INTERNAL_ERROR, `peer RPC failed: ${error.message}`);
    }

    throw new RpcError(RpcErrorCode.INTERNAL_ERROR, "peer RPC failed");
  } finally {
    clearTimeout(timer);
  }
}
