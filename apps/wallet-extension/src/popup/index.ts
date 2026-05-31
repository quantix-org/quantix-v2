import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";

const ACTIVE_ADDRESS_KEY = "quantix_active_address_v1";
const ACCOUNTS_KEY = "quantix_accounts_v1";
const RPC_ENDPOINT_KEY = "quantix_rpc_endpoint_v1";
const ACTIVITY_KEY = "quantix_popup_activity_v1";
const DEFAULT_RPC_ENDPOINT = "http://127.0.0.1:7330/rpc";
const DEFAULT_CHAIN_ID = "quantix-devnet";
const ONE_QTX = 10n ** 18n;

type InternalRpcBridgeResult<T> = {
  ok: boolean;
  result?: T;
  error?: string;
};

type StoredAccount = {
  address: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
};

type AccountMap = Record<string, StoredAccount>;

type SignedTx = {
  chainId: string;
  type: string;
  from: string;
  nonce: number;
  timestamp: number;
  amount: bigint;
  fee: bigint;
  signerPublicKey: string;
  signature: string;
  to?: string;
  contractAddress?: string;
  method?: string;
  args?: unknown[];
  gasLimit?: number;
  maxFeePerGas?: bigint;
  value?: bigint;
};

type ActivityItem = {
  ts: number;
  type: "transfer" | "token_transfer" | "read";
  hash?: string;
  detail: string;
};

function setStatus(ok: boolean, message: string): void {
  const status = document.getElementById("status");
  if (!status) return;
  status.className = ok ? "ok" : "err";
  status.textContent = message;
}

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value;
}

function getInputValue(id: string): string {
  const node = document.getElementById(id) as HTMLInputElement | null;
  return node?.value.trim() ?? "";
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Invalid hex value.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function parseQtxToBaseUnits(input: string): bigint {
  const raw = input.trim();
  if (!raw) return 0n;
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid QTX amount: ${raw}`);
  }
  const [wholePart, fracPart = ""] = raw.split(".");
  if (fracPart.length > 18) {
    throw new Error("QTX amount max 18 decimal places.");
  }
  const whole = BigInt(wholePart || "0");
  const frac = BigInt((fracPart + "0".repeat(18)).slice(0, 18));
  return whole * ONE_QTX + frac;
}

function parseTokenToBaseUnits(input: string, decimalsRaw: string): bigint {
  const raw = input.trim();
  if (!raw) return 0n;
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid token amount: ${raw}`);
  }

  const decimals = Number(decimalsRaw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new Error("Token decimals must be an integer 0..30.");
  }

  const [wholePart, fracPart = ""] = raw.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`Token amount max ${decimals} decimal places.`);
  }

  const whole = BigInt(wholePart || "0");
  const frac = BigInt((fracPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  return whole * (10n ** BigInt(decimals)) + frac;
}

function formatQtx(raw: string): string {
  if (!/^\d+$/.test(raw)) return "0";
  const value = BigInt(raw);
  const whole = value / ONE_QTX;
  const frac = value % ONE_QTX;
  if (frac === 0n) return `${whole.toString()} QTX`;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr.slice(0, 6)} QTX`;
}

function transactionSigningPayload(tx: SignedTx): string {
  return JSON.stringify({
    chainId: tx.chainId,
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    to: tx.to ?? null,
    validatorId: null,
    contractAddress: tx.contractAddress ?? null,
    contractCode: null,
    method: tx.method ?? null,
    args: tx.args ?? [],
    gasLimit: tx.gasLimit ?? null,
    maxFeePerGas: tx.maxFeePerGas?.toString() ?? null,
    value: tx.value?.toString() ?? null,
    salt: null,
  });
}

function signTx(unsigned: Omit<SignedTx, "signature">, privateKeyHex: string): SignedTx {
  const payload = transactionSigningPayload({ ...unsigned, signature: "" });
  const sigBytes = ml_dsa87.sign(new TextEncoder().encode(payload), hexToBytes(privateKeyHex));
  return {
    ...unsigned,
    signature: bytesToHex(sigBytes),
  };
}

function serializeSignedTx(tx: SignedTx): Record<string, unknown> {
  const out: Record<string, unknown> = {
    chainId: tx.chainId,
    type: tx.type,
    from: tx.from,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    amount: tx.amount.toString(),
    fee: tx.fee.toString(),
    signerPublicKey: tx.signerPublicKey,
    signature: tx.signature,
  };

  if (tx.to !== undefined) out.to = tx.to;
  if (tx.contractAddress !== undefined) out.contractAddress = tx.contractAddress;
  if (tx.method !== undefined) out.method = tx.method;
  if (tx.args !== undefined) out.args = tx.args;
  if (tx.gasLimit !== undefined) out.gasLimit = tx.gasLimit;
  if (tx.maxFeePerGas !== undefined) out.maxFeePerGas = tx.maxFeePerGas.toString();
  if (tx.value !== undefined) out.value = tx.value.toString();

  return out;
}

async function rpcCall<T>(rpcEndpoint: string, method: string, params: unknown[]): Promise<T> {
  const bridge = await chrome.runtime.sendMessage({
    type: "quantix:internal-rpc",
    rpcEndpoint,
    method,
    params,
  }) as InternalRpcBridgeResult<T>;

  if (!bridge || !bridge.ok) {
    throw new Error(bridge?.error ?? "RPC bridge error");
  }
  return bridge.result as T;
}

async function loadSigner(activeAddress: string): Promise<StoredAccount> {
  const values = await chrome.storage.local.get([ACCOUNTS_KEY]);
  const accounts = (values[ACCOUNTS_KEY] as AccountMap | undefined) ?? {};
  const signer = accounts[activeAddress];
  if (!signer) {
    throw new Error("Active address not found in account store. Import wallet in settings.");
  }
  return signer;
}

async function getNextNonce(rpcEndpoint: string, address: string): Promise<number> {
  const result = await rpcCall<{ nonce: number }>(rpcEndpoint, "qtx_getBalance", [address]);
  return Number(result.nonce ?? 0) + 1;
}

async function appendActivity(item: ActivityItem): Promise<void> {
  const values = await chrome.storage.local.get([ACTIVITY_KEY]);
  const current = (values[ACTIVITY_KEY] as ActivityItem[] | undefined) ?? [];
  const next = [item, ...current].slice(0, 12);
  await chrome.storage.local.set({ [ACTIVITY_KEY]: next });
  renderActivity(next);
}

function renderActivity(items: ActivityItem[]): void {
  const node = document.getElementById("activity");
  if (!node) return;
  if (items.length === 0) {
    node.textContent = "No activity yet.";
    return;
  }

  node.textContent = items
    .map((x) => {
      const date = new Date(x.ts).toLocaleTimeString();
      const hash = x.hash ? `\n  tx: ${x.hash}` : "";
      return `[${date}] ${x.type}\n  ${x.detail}${hash}`;
    })
    .join("\n\n");
}

async function refreshOverview(address: string, rpcEndpoint: string): Promise<void> {
  const balance = await rpcCall<{ balance: string; nonce: number }>(
    rpcEndpoint,
    "qtx_getBalance",
    [address],
  );
  const rawBalance = String(balance.balance ?? "0");
  setText("qtx-balance", rawBalance);
  setText("qtx-balance-display", formatQtx(rawBalance));
  setText("qtx-nonce", String(balance.nonce ?? "0"));
}

async function refreshTokenData(activeAddress: string, rpcEndpoint: string): Promise<void> {
  const contractAddress = getInputValue("token-contract");
  if (!contractAddress) {
    throw new Error("Token contract harus diisi.");
  }

  const ownerInput = getInputValue("token-owner");
  const owner = ownerInput || activeAddress;
  const spender = getInputValue("token-spender");

  const totalSupply = await rpcCall<{ value: string | null }>(
    rpcEndpoint,
    "qtx_getStorage",
    [contractAddress, "token:totalSupply"],
  );
  const ownerBalance = await rpcCall<{ value: string | null }>(
    rpcEndpoint,
    "qtx_getStorage",
    [contractAddress, `token:bal:${owner}`],
  );

  let allowanceValue = "(spender not set)";
  if (spender) {
    const allowance = await rpcCall<{ value: string | null }>(
      rpcEndpoint,
      "qtx_getStorage",
      [contractAddress, `token:allow:${owner}:${spender}`],
    );
    allowanceValue = allowance.value ?? "0";
  }

  setText("token-total-supply", totalSupply.value ?? "0");
  setText("token-balance-owner", ownerBalance.value ?? "0");
  setText("token-allowance", allowanceValue);

  await appendActivity({
    ts: Date.now(),
    type: "read",
    detail: `Read token storage from ${contractAddress.slice(0, 18)}...`,
  });
}

async function sendQtx(activeAddress: string, rpcEndpoint: string): Promise<void> {
  const to = getInputValue("send-to");
  if (!to.startsWith("qtx1")) {
    throw new Error("Recipient address tidak valid.");
  }

  const amount = parseQtxToBaseUnits(getInputValue("send-amount"));
  const fee = parseQtxToBaseUnits(getInputValue("send-fee") || "0");
  const signer = await loadSigner(activeAddress);
  const nonce = await getNextNonce(rpcEndpoint, activeAddress);

  const unsigned: Omit<SignedTx, "signature"> = {
    chainId: DEFAULT_CHAIN_ID,
    type: "transfer",
    from: activeAddress,
    nonce,
    timestamp: Date.now(),
    amount,
    fee,
    signerPublicKey: signer.publicKey,
    to,
  };

  const tx = signTx(unsigned, signer.privateKey);
  const result = await rpcCall<{ txHash: string }>(
    rpcEndpoint,
    "qtx_submitTransaction",
    [serializeSignedTx(tx)],
  );

  await appendActivity({
    ts: Date.now(),
    type: "transfer",
    hash: result.txHash,
    detail: `Send ${getInputValue("send-amount")} QTX to ${to.slice(0, 14)}...`,
  });
}

async function sendToken(activeAddress: string, rpcEndpoint: string): Promise<void> {
  const contractAddress = getInputValue("token-contract");
  if (!contractAddress) throw new Error("Token contract harus diisi.");

  const to = getInputValue("token-to");
  if (!to.startsWith("qtx1")) throw new Error("Token recipient address tidak valid.");

  const amountBase = parseTokenToBaseUnits(
    getInputValue("token-send-amount"),
    getInputValue("token-decimals") || "18",
  );

  const signer = await loadSigner(activeAddress);
  const nonce = await getNextNonce(rpcEndpoint, activeAddress);

  const unsigned: Omit<SignedTx, "signature"> = {
    chainId: DEFAULT_CHAIN_ID,
    type: "contract_call",
    from: activeAddress,
    nonce,
    timestamp: Date.now(),
    amount: 0n,
    fee: 0n,
    signerPublicKey: signer.publicKey,
    contractAddress,
    method: "token_transfer",
    args: [to, amountBase.toString()],
    gasLimit: 300_000,
    maxFeePerGas: 0n,
    value: 0n,
  };

  const tx = signTx(unsigned, signer.privateKey);
  const result = await rpcCall<{ txHash: string }>(
    rpcEndpoint,
    "qtx_submitTransaction",
    [serializeSignedTx(tx)],
  );

  await appendActivity({
    ts: Date.now(),
    type: "token_transfer",
    hash: result.txHash,
    detail: `Send ${getInputValue("token-send-amount")} token to ${to.slice(0, 14)}...`,
  });
}

async function run(): Promise<void> {
  const openOptions = document.getElementById("open-options") as HTMLButtonElement | null;
  const refresh = document.getElementById("refresh") as HTMLButtonElement | null;
  const copyAddress = document.getElementById("copy-address") as HTMLButtonElement | null;
  const readToken = document.getElementById("read-token") as HTMLButtonElement | null;
  const sendQtxBtn = document.getElementById("send-qtx") as HTMLButtonElement | null;
  const sendTokenBtn = document.getElementById("send-token") as HTMLButtonElement | null;

  const values = await chrome.storage.local.get([ACTIVE_ADDRESS_KEY, RPC_ENDPOINT_KEY, ACTIVITY_KEY]);
  const activeAddress = (values[ACTIVE_ADDRESS_KEY] as string | undefined) ?? "Not configured";
  const rpcEndpoint = (values[RPC_ENDPOINT_KEY] as string | undefined) ?? DEFAULT_RPC_ENDPOINT;
  const existingActivity = (values[ACTIVITY_KEY] as ActivityItem[] | undefined) ?? [];

  setText("active-address", activeAddress);
  setText("rpc-endpoint", rpcEndpoint);
  renderActivity(existingActivity);

  const tokenValues = await chrome.storage.local.get([
    "quantix_popup_token_contract_v1",
    "quantix_popup_token_owner_v1",
    "quantix_popup_token_spender_v1",
  ]);

  const tokenContractInput = document.getElementById("token-contract") as HTMLInputElement | null;
  const tokenOwnerInput = document.getElementById("token-owner") as HTMLInputElement | null;
  const tokenSpenderInput = document.getElementById("token-spender") as HTMLInputElement | null;

  if (tokenContractInput && typeof tokenValues.quantix_popup_token_contract_v1 === "string") {
    tokenContractInput.value = tokenValues.quantix_popup_token_contract_v1 as string;
  }
  if (tokenOwnerInput && typeof tokenValues.quantix_popup_token_owner_v1 === "string") {
    tokenOwnerInput.value = tokenValues.quantix_popup_token_owner_v1 as string;
  }
  if (tokenSpenderInput && typeof tokenValues.quantix_popup_token_spender_v1 === "string") {
    tokenSpenderInput.value = tokenValues.quantix_popup_token_spender_v1 as string;
  }

  if (activeAddress.startsWith("qtx1")) {
    try {
      await refreshOverview(activeAddress, rpcEndpoint);
      setStatus(true, "Wallet ready.");
    } catch (err) {
      setStatus(false, err instanceof Error ? err.message : String(err));
    }
  } else {
    setStatus(false, "Active address belum dikonfigurasi. Buka Settings.");
  }

  openOptions?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  copyAddress?.addEventListener("click", async () => {
    try {
      if (!activeAddress.startsWith("qtx1")) throw new Error("No active address.");
      await navigator.clipboard.writeText(activeAddress);
      setStatus(true, "Address copied.");
    } catch (err) {
      setStatus(false, err instanceof Error ? err.message : String(err));
    }
  });

  refresh?.addEventListener("click", async () => {
    try {
      if (!activeAddress.startsWith("qtx1")) throw new Error("Active address belum valid.");
      await refreshOverview(activeAddress, rpcEndpoint);
      setStatus(true, "Balance refreshed.");
    } catch (err) {
      setStatus(false, err instanceof Error ? err.message : String(err));
    }
  });

  readToken?.addEventListener("click", async () => {
    try {
      if (!activeAddress.startsWith("qtx1")) throw new Error("Active address belum valid.");
      await chrome.storage.local.set({
        quantix_popup_token_contract_v1: getInputValue("token-contract"),
        quantix_popup_token_owner_v1: getInputValue("token-owner"),
        quantix_popup_token_spender_v1: getInputValue("token-spender"),
      });
      await refreshTokenData(activeAddress, rpcEndpoint);
      setStatus(true, "Token data updated.");
    } catch (err) {
      setStatus(false, err instanceof Error ? err.message : String(err));
    }
  });

  sendQtxBtn?.addEventListener("click", async () => {
    try {
      if (!activeAddress.startsWith("qtx1")) throw new Error("Active address belum valid.");
      await sendQtx(activeAddress, rpcEndpoint);
      await refreshOverview(activeAddress, rpcEndpoint);
      setStatus(true, "QTX transaction submitted.");
    } catch (err) {
      setStatus(false, err instanceof Error ? err.message : String(err));
    }
  });

  sendTokenBtn?.addEventListener("click", async () => {
    try {
      if (!activeAddress.startsWith("qtx1")) throw new Error("Active address belum valid.");
      await sendToken(activeAddress, rpcEndpoint);
      await refreshTokenData(activeAddress, rpcEndpoint);
      setStatus(true, "Token transfer submitted.");
    } catch (err) {
      setStatus(false, err instanceof Error ? err.message : String(err));
    }
  });
}

void run();

export {};
