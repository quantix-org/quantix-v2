export const RpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  VALIDATION_ERROR: -32001,
  NOT_FOUND: -32004,
  SIGNATURE_INVALID: -32010,
  NONCE_STALE: -32011,
  NONCE_CONFLICT: -32012,
  NONCE_SEQUENCE: -32013,
} as const;

export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export function asRpcError(error: unknown): RpcError {
  if (error instanceof RpcError) {
    return error;
  }

  if (error instanceof SyntaxError) {
    return new RpcError(RpcErrorCode.PARSE_ERROR, "invalid JSON payload");
  }

  if (error instanceof Error) {
    return new RpcError(RpcErrorCode.INTERNAL_ERROR, error.message);
  }

  return new RpcError(RpcErrorCode.INTERNAL_ERROR, "internal error");
}
