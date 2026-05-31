type QuantixProviderRequestEnvelope = {
  channel: "quantix:provider-request";
  payload: {
    id: string;
    method: string;
    params?: unknown;
  };
};

type QuantixProviderResponseEnvelope = {
  channel: "quantix:provider-response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

function injectProviderScript(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("inpage/provider.js");
  script.type = "module";
  script.async = false;

  const root = document.head || document.documentElement;
  root.appendChild(script);
  script.remove();
}

injectProviderScript();

window.addEventListener("message", (event: MessageEvent<QuantixProviderRequestEnvelope>) => {
  if (event.source !== window) return;
  if (!event.data || event.data.channel !== "quantix:provider-request") return;

  const payload = event.data.payload;
  chrome.runtime.sendMessage(
    {
      type: "quantix:provider-request",
      origin: window.location.origin,
      request: payload,
    },
    (response?: QuantixProviderResponseEnvelope) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        window.postMessage(
          {
            channel: "quantix:provider-response",
            id: payload.id,
            ok: false,
            error: {
              code: -32603,
              message: runtimeError.message,
            },
          } satisfies QuantixProviderResponseEnvelope,
          "*",
        );
        return;
      }

      window.postMessage(
        response ?? {
          channel: "quantix:provider-response",
          id: payload.id,
          ok: false,
          error: { code: -32603, message: "No response from extension background." },
        },
        "*",
      );
    },
  );
});
