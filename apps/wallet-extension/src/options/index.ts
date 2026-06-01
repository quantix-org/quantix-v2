const ACTIVE_ADDRESS_KEY = "quantix_active_address_v1";
const ACCOUNTS_KEY = "quantix_accounts_v1";
const RPC_ENDPOINT_KEY = "quantix_rpc_endpoint_v1";
const DEFAULT_RPC_ENDPOINT = "http://127.0.0.1:7330/rpc";

type StoredAccount = {
  address: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
};

type AccountMap = Record<string, StoredAccount>;

function isValidQtxAddress(value: string): boolean {
  return value.startsWith("qtx1") && value.length === 42;
}

function isValidRpcEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function asWalletAccount(value: unknown): StoredAccount {
  if (typeof value !== "object" || value === null) {
    throw new Error("Wallet JSON must be an object.");
  }
  const obj = value as Record<string, unknown>;
  const address = String(obj.address ?? "").trim();
  const publicKey = String(obj.publicKey ?? "").trim();
  const privateKey = String(obj.privateKey ?? "").trim();

  if (!isValidQtxAddress(address)) throw new Error("Wallet address is invalid.");
  if (!/^[0-9a-fA-F]+$/.test(publicKey) || publicKey.length < 64) throw new Error("Wallet publicKey is invalid.");
  if (!/^[0-9a-fA-F]+$/.test(privateKey) || privateKey.length < 64) throw new Error("Wallet privateKey is invalid.");

  return {
    address,
    publicKey,
    privateKey,
    createdAt: Date.now(),
  };
}

async function run(): Promise<void> {
  const input = document.getElementById("active-address") as HTMLInputElement | null;
  const rpcInput = document.getElementById("rpc-endpoint") as HTMLInputElement | null;
  const walletJsonInput = document.getElementById("wallet-json") as HTMLInputElement | null;
  const saveButton = document.getElementById("save") as HTMLButtonElement | null;
  const importButton = document.getElementById("import-wallet") as HTMLButtonElement | null;
  const status = document.getElementById("status");

  if (!input || !rpcInput || !walletJsonInput || !saveButton || !importButton || !status) return;

  const existing = await chrome.storage.local.get([ACTIVE_ADDRESS_KEY, RPC_ENDPOINT_KEY]);
  if (typeof existing[ACTIVE_ADDRESS_KEY] === "string") {
    input.value = existing[ACTIVE_ADDRESS_KEY] as string;
  }
  rpcInput.value = typeof existing[RPC_ENDPOINT_KEY] === "string"
    ? String(existing[RPC_ENDPOINT_KEY])
    : DEFAULT_RPC_ENDPOINT;

  saveButton.addEventListener("click", async () => {
    const value = input.value.trim();
    const rpcEndpoint = rpcInput.value.trim();

    if (!isValidQtxAddress(value)) {
      status.className = "err";
      status.textContent = "Address must be qtx1... with length 42.";
      return;
    }

    if (!isValidRpcEndpoint(rpcEndpoint)) {
      status.className = "err";
      status.textContent = "RPC endpoint must be a valid http(s) URL.";
      return;
    }

    const accounts = (await chrome.storage.local.get(ACCOUNTS_KEY))[ACCOUNTS_KEY] as AccountMap | undefined;
    if (!accounts || !accounts[value]) {
      status.className = "err";
      status.textContent = "Address not found in extension account store. Import wallet JSON first.";
      return;
    }

    await chrome.storage.local.set({
      [ACTIVE_ADDRESS_KEY]: value,
      [RPC_ENDPOINT_KEY]: rpcEndpoint,
    });
    status.className = "ok";
    status.textContent = "Saved account and RPC endpoint.";
  });

  importButton.addEventListener("click", async () => {
    try {
      const raw = walletJsonInput.value.trim();
      if (!raw) {
        status.className = "err";
        status.textContent = "Wallet JSON input is empty.";
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      const account = asWalletAccount(parsed);

      const accounts = ((await chrome.storage.local.get(ACCOUNTS_KEY))[ACCOUNTS_KEY] as AccountMap | undefined) ?? {};
      accounts[account.address] = account;

      await chrome.storage.local.set({
        [ACCOUNTS_KEY]: accounts,
        [ACTIVE_ADDRESS_KEY]: account.address,
      });

      input.value = account.address;
      status.className = "ok";
      status.textContent = "Wallet imported and set active.";
    } catch (err) {
      status.className = "err";
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

void run();

export {};
