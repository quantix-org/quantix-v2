#!/usr/bin/env tsx
/**
 * spam-tx — send N transactions to a random selection of addresses
 *
 * Usage:
 *   tsx tools/wallet/spam-tx.ts [options]
 *
 * Options:
 *   --key    <file>  Wallet keyfile       (default: ./wallet.key.json)
 *   --rpc    <url>   Node RPC endpoint    (default: http://localhost:7331/rpc)
 *   --count  <n>     Number of txs        (default: 10)
 *   --min    <qtx>   Min amount per tx    (default: 0.1)
 *   --max    <qtx>   Max amount per tx    (default: 1)
 *   --fee    <qtx>   Fee per tx           (default: 0)
 *   --delay  <ms>    Delay between txs    (default: 0)
 *   --addr   <a,b,…> Comma-separated target addresses (overrides built-in list)
 */

import { readFileSync, existsSync } from "node:fs";
import {
  getNextNonce,
  buildTransferTx,
  submitTx,
} from "@quantix/sdk";

// ─── ANSI ────────────────────────────────────────────────────────────────────
const c = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  gray:    "\x1b[90m",
  magenta: "\x1b[35m",
};
const bold    = (s: string) => `${c.bold}${s}${c.reset}`;
const dim     = (s: string) => `${c.dim}${s}${c.reset}`;
const cyan    = (s: string) => `${c.cyan}${s}${c.reset}`;
const green   = (s: string) => `${c.green}${s}${c.reset}`;
const yellow  = (s: string) => `${c.yellow}${s}${c.reset}`;
const red     = (s: string) => `${c.red}${s}${c.reset}`;
const gray    = (s: string) => `${c.gray}${s}${c.reset}`;
const magenta = (s: string) => `${c.magenta}${s}${c.reset}`;

// ─── Amounts ─────────────────────────────────────────────────────────────────
const ONE_QTX = 10n ** 18n;

function parseQtx(input: string): bigint {
  input = input.trim();
  const parts = input.split(".");
  const whole = BigInt(parts[0] ?? "0");
  if (parts.length === 1) return whole * ONE_QTX;
  const fracRaw = (parts[1] ?? "").slice(0, 18).padEnd(18, "0");
  return whole * ONE_QTX + BigInt(fracRaw);
}

function formatQtx(amount: bigint): string {
  const whole = amount / ONE_QTX;
  const frac  = amount % ONE_QTX;
  if (frac === 0n) return `${whole} QTX`;
  return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")} QTX`;
}

/** Random bigint in [min, max] inclusive */
function randBig(min: bigint, max: bigint): bigint {
  if (min >= max) return min;
  const range = max - min + 1n;
  // Use JS random for simplicity (good enough for test spam)
  const r = BigInt(Math.floor(Math.random() * Number(range)));
  return min + r;
}

// ─── Args ─────────────────────────────────────────────────────────────────────
interface Keyfile {
  address: string;
  publicKey: string;
  privateKey: string;
}

function loadKey(path: string): Keyfile {
  if (!existsSync(path)) {
    console.error(red(`✗ Keyfile not found: ${path}`));
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Keyfile;
}

function parseArgv(argv: string[]) {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      raw[argv[i].slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return {
    key:   raw["key"]   ?? "./my-wallet.key.json",
    rpc:   raw["rpc"]   ?? "http://localhost:7331/rpc",
    count: parseInt(raw["count"] ?? "500", 10),
    min:   parseQtx(raw["min"]   ?? "5"),
    max:   parseQtx(raw["max"]   ?? "25"),
    fee:   parseQtx(raw["fee"]   ?? "0.4942"),
    delay: parseInt(raw["delay"] ?? "500", 10),
    extraAddrs: raw["addr"] ? raw["addr"].split(",").map(a => a.trim()).filter(Boolean) : [],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Built-in target addresses — add or remove as needed
const BUILTIN_TARGETS = [
  "qtx15e5baf49a6e135feab84703edae9a72b993ea3",
  "qtx133b75517903403a21b1a14a18f84d89b6041eb",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args    = parseArgv(process.argv.slice(2));
  const targets = args.extraAddrs.length > 0 ? args.extraAddrs : BUILTIN_TARGETS;
  const kf      = loadKey(args.key);

  console.log(`\n${cyan("─".repeat(60))}`);
  console.log(`  ${bold(cyan("⬡"))} ${bold("Quantix TX Spammer")}`);
  console.log(`${cyan("─".repeat(60))}\n`);
  console.log(`  ${dim("Sender")}    ${cyan(kf.address)}`);
  console.log(`  ${dim("Targets")}   ${targets.map(a => cyan(a.slice(0, 16) + "…")).join(", ")}`);
  console.log(`  ${dim("Count")}     ${args.count}`);
  console.log(`  ${dim("Amount")}    ${formatQtx(args.min)} – ${formatQtx(args.max)}`);
  console.log(`  ${dim("Fee")}       ${formatQtx(args.fee)}`);
  console.log(`  ${dim("RPC")}       ${gray(args.rpc)}`);
  console.log(`  ${dim("Delay")}     ${args.delay}ms`);
  console.log(`\n${cyan("─".repeat(60))}\n`);

  // Fetch starting nonce once, then increment manually
  let nonce = await getNextNonce(args.rpc, kf.address);
  console.log(`  ${dim("Starting nonce:")} ${nonce}\n`);

  const col = { n: 6, to: 18, amt: 14, hash: 18, status: 8 };
  const hdr = [
    bold("#").padEnd(col.n),
    bold("To").padEnd(col.to),
    bold("Amount").padEnd(col.amt),
    bold("Tx Hash").padEnd(col.hash + 10),
    bold("Status"),
  ].join("  ");
  console.log("  " + hdr);
  console.log("  " + dim("─".repeat(80)));

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < args.count; i++) {
    const to     = pick(targets);
    const amount = randBig(args.min, args.max);
    const num    = String(i + 1).padEnd(col.n);

    try {
      const tx = buildTransferTx({
        from:            kf.address,
        to,
        nonce,
        amount,
        fee:             args.fee,
        signerPublicKey: kf.publicKey,
        privateKey:      kf.privateKey,
      });

      const { txHash } = await submitTx(args.rpc, tx);
      const shortTo   = (to.slice(0, 14) + "…").padEnd(col.to);
      const shortAmt  = formatQtx(amount).padEnd(col.amt);
      const shortHash = (txHash.slice(0, 16) + "…").padEnd(col.hash + 10);

      console.log(`  ${num}  ${cyan(shortTo)}  ${green(shortAmt)}  ${yellow(shortHash)}  ${green("✓ ok")}`);
      nonce++;
      ok++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const shortTo = (to.slice(0, 14) + "…").padEnd(col.to);
      console.log(`  ${num}  ${cyan(shortTo)}  ${red("error".padEnd(col.amt))}  ${gray("─".padEnd(col.hash + 10))}  ${red("✗ " + msg.slice(0, 100))}`);
      fail++;
      // Don't increment nonce on failure — retry same nonce next iteration
    }

    if (args.delay > 0 && i < args.count - 1) {
      await sleep(args.delay);
    }
  }

  console.log(`\n${cyan("─".repeat(60))}`);
  console.log(`  ${bold("Done")}  —  ${green(`${ok} sent`)}  ${fail > 0 ? red(`${fail} failed`) : dim("0 failed")}`);
  console.log(`${cyan("─".repeat(60))}\n`);
}

main().catch((e) => {
  console.error(red(`\n✗ Fatal: ${e instanceof Error ? e.message : String(e)}\n`));
  process.exit(1);
});
