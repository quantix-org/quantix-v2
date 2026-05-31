(() => {
  type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

  type QuantixProviderRequest = {
    id: string;
    method: string;
    params?: Json;
  };

  type QuantixProviderSuccess = {
    channel: "quantix:provider-response";
    id: string;
    ok: true;
    result: Json;
  };

  type QuantixProviderFailure = {
    channel: "quantix:provider-response";
    id: string;
    ok: false;
    error: {
      code: number;
      message: string;
    };
  };

  type QuantixProviderResponse = QuantixProviderSuccess | QuantixProviderFailure;

  interface QuantixProvider {
    request(input: { method: string; params?: Json }): Promise<Json>;
    on(eventName: string, listener: (...args: unknown[]) => void): () => void;
    removeListener(eventName: string, listener: (...args: unknown[]) => void): void;
  }

  const pending = new Map<
    string,
    {
      resolve: (value: Json) => void;
      reject: (reason: unknown) => void;
    }
  >();

  function randomId(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  window.addEventListener("message", (event: MessageEvent<QuantixProviderResponse>) => {
    if (event.source !== window) return;
    if (!event.data || event.data.channel !== "quantix:provider-response") return;

    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);

    if (event.data.ok) {
      job.resolve(event.data.result);
      return;
    }

    const error = new Error(event.data.error.message) as Error & { code?: number };
    error.code = event.data.error.code;
    job.reject(error);
  });

  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const provider: QuantixProvider = {
    request(input) {
      if (!input || typeof input.method !== "string" || !input.method.startsWith("quantix_")) {
        return Promise.reject(new Error("Method must use quantix_ prefix."));
      }

      const id = randomId();
      const payload: QuantixProviderRequest = {
        id,
        method: input.method,
        params: input.params,
      };

      window.postMessage(
        {
          channel: "quantix:provider-request",
          payload,
        },
        "*",
      );

      return new Promise<Json>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    on(eventName, listener) {
      const set = listeners.get(eventName) ?? new Set<(...args: unknown[]) => void>();
      set.add(listener);
      listeners.set(eventName, set);
      return () => {
        set.delete(listener);
      };
    },
    removeListener(eventName, listener) {
      const set = listeners.get(eventName);
      if (!set) return;
      set.delete(listener);
    },
  };

  Object.defineProperty(window, "quantix", {
    value: provider,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})();
