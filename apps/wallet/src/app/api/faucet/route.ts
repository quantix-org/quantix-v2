import { NextResponse } from "next/server";
import { type WalletFile, parseWalletFile, signPayload, walletFileToKeyPair } from "@/lib/crypto";

const CHAIN_ID = process.env.QTX_CHAIN_ID ?? "quantix-devnet";
const FAUCET_AMOUNT = 10n * 10n ** 18n; // 10 QTX in base units
const BASE_FEE = 1n;

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: JsonRpcError;
}

function transactionSigningPayload(tx: {
  chainId: string;
  type: string;
  from: string;
  nonce: number;
  timestamp: number;
  amount: bigint;
  fee: bigint;
  to?: string;
}): string {
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
  });
}

function getFunderWalletFromEnv(): WalletFile {
  const raw = process.env.FAUCET_FUNDER_WALLET_JSON?.trim();
  if (!raw) {
    throw new Error("Missing FAUCET_FUNDER_WALLET_JSON environment variable.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);

    // Support values stored as an escaped JSON string in env providers.
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
  } catch {
    throw new Error(
      "FAUCET_FUNDER_WALLET_JSON is not valid JSON. Provide a JSON object or an escaped JSON string.",
    );
  }

  return parseWalletFile(parsed);
}

async function rpcCall<T>(nodeUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(nodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!res.ok) {
    throw new Error(`Upstream RPC HTTP ${res.status}`);
  }

  const json = (await res.json()) as JsonRpcResponse<T>;
  if (json.error) {
    throw new Error(json.error.message);
  }

  return json.result as T;
}

export async function POST(req: Request) {
  const nodeUrl =
    process.env.NODE_RPC_URL ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    "http://localhost:7330/rpc";

  try {
    const body = (await req.json()) as { address?: string };
    const to = String(body?.address ?? "").trim();

    if (!to.startsWith("qtx1") || to.length !== 42) {
      return NextResponse.json(
        { error: { message: "Invalid recipient wallet address" } },
        { status: 400 },
      );
    }

    const recipient = await rpcCall<{ balance: string; staked: string; nonce: number }>(
      nodeUrl,
      "qtx_getBalance",
      [to],
    );

    // Enforce one-time faucet funding per wallet by requiring untouched account state.
    if (
      BigInt(recipient.balance) > 0n ||
      BigInt(recipient.staked) > 0n ||
      recipient.nonce > 0
    ) {
      return NextResponse.json(
        { error: { message: "This wallet has already been funded or used. Faucet is one-time (10 QTX)." } },
        { status: 409 },
      );
    }

    const funderWallet = getFunderWalletFromEnv();
    const funderKeys = walletFileToKeyPair(funderWallet);

    const funderBalance = await rpcCall<{ balance: string; nonce: number }>(
      nodeUrl,
      "qtx_getBalance",
      [funderWallet.address],
    );

    const totalDebit = FAUCET_AMOUNT + BASE_FEE;
    if (BigInt(funderBalance.balance) < totalDebit) {
      return NextResponse.json(
        { error: { message: "Funder wallet has insufficient balance for faucet transfer." } },
        { status: 409 },
      );
    }

    const nonce = funderBalance.nonce + 1;
    const timestamp = Date.now();
    const fee = 0n;

    const unsignedTx = {
      type: "transfer",
      chainId: CHAIN_ID,
      from: funderWallet.address,
      nonce,
      timestamp,
      amount: FAUCET_AMOUNT,
      fee,
      to,
    };

    const payload = transactionSigningPayload(unsignedTx);
    const signature = signPayload(funderKeys.privateKey, payload);

    const wireTx = {
      ...unsignedTx,
      amount: FAUCET_AMOUNT.toString(),
      fee: fee.toString(),
      signerPublicKey: funderWallet.publicKey,
      signature,
    };

    const submit = await rpcCall<{ txHash: string }>(
      nodeUrl,
      "qtx_submitTransaction",
      [wireTx],
    );

    return NextResponse.json({
      txHash: submit.txHash,
      amount: FAUCET_AMOUNT.toString(),
      to,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Faucet request failed";
    return NextResponse.json({ error: { message: msg } }, { status: 500 });
  }
}
