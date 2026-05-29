#!/usr/bin/env tsx
/**
 * qtx — Quantix Wallet CLI
 *
 * Usage:
 *   tsx tools/wallet/qtx.ts <command> [options]
 *
 * Commands:
 *   new        [<output-file>] [--output <file>]     Generate a new wallet
 *   import     <seed-hex> [<output-file>]             Import wallet from 64-char seed
 *   address    [--key <file>]                       Show address from keyfile
 *   balance    <address> [--rpc <url>]              Query account balance & nonce
 *   send       <to> <amount> --key <f> [options]    Transfer QTX
 *   stake      <amount>     --key <f> [options]     Stake QTX
 *   unstake    <amount>     --key <f> [options]     Unstake QTX
 *   validator  register <id> <amount> --key <f>     Register as validator
 *   block      <height|latest> [--rpc <url>]        Look up a block
 *   tx         <hash>         [--rpc <url>]         Look up a transaction
 *   chain      [--rpc <url>]                        Show chain info
 *   mempool    [--rpc <url>]                        Show pending transactions
 *   validators [--rpc <url>]                        Show all validators
 *
 * Options (global):
 *   --key      <file>   Path to wallet keyfile  (default: ./wallet.key.json)
 *   --rpc      <url>    Node RPC endpoint       (default: http://localhost:7331/rpc)
 *   --fee      <qtx>    Fee per transaction     (default: 0)
 *   --output   <file>   Where to write new key  (default: ./wallet.key.json)
 *   --chain-id <id>     Chain ID for replay protection (default: quantix-devnet)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

import {
  generateKeyPair,
  deriveAddress,
  getBalance,
  getLatestBlock,
  getBlock,
  getValidators,
  getMempool,
  getPeers,
  getNextNonce,
  submitTx,
  buildTransferTx,
  buildStakeTx,
  buildUnstakeTx,
  buildValidatorRegisterTx,
  RpcError,
} from "@quantix/sdk";

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
  magenta:"\x1b[35m",
};

function bold(s: string)    { return `${c.bold}${s}${c.reset}`; }
function dim(s: string)     { return `${c.dim}${s}${c.reset}`; }
function cyan(s: string)    { return `${c.cyan}${s}${c.reset}`; }
function green(s: string)   { return `${c.green}${s}${c.reset}`; }
function yellow(s: string)  { return `${c.yellow}${s}${c.reset}`; }
function red(s: string)     { return `${c.red}${s}${c.reset}`; }
function gray(s: string)    { return `${c.gray}${s}${c.reset}`; }
function magenta(s: string) { return `${c.magenta}${s}${c.reset}`; }

function header(title: string) {
  const line = "─".repeat(50);
  console.log(`\n${cyan(line)}`);
  console.log(`  ${bold(cyan("⬡"))} ${bold(title)}`);
  console.log(`${cyan(line)}\n`);
}

function row(key: string, value: string, width = 16) {
  console.log(`  ${gray(key.padEnd(width))} ${value}`);
}

function separator() {
  console.log(`  ${gray("─".repeat(48))}`);
}

function success(msg: string) {
  console.log(`\n  ${green("✓")} ${msg}\n`);
}

function warn(msg: string) {
  console.log(`  ${yellow("⚠")}  ${msg}`);
}

function die(msg: string): never {
  console.error(`\n  ${red("✗")} ${bold(msg)}\n`);
  process.exit(1);
}

// ─── QTX amount math (18 decimals) ───────────────────────────────────────────

const DECIMALS = 18n;
const ONE_QTX = 10n ** DECIMALS;

function parseQtx(input: string): bigint {
  input = input.trim().replace(/_/g, "").replace(/,/g, "");
  const parts = input.split(".");
  if (parts.length > 2) die(`Invalid amount: ${input}`);
  const whole = BigInt(parts[0] || "0");
  if (parts.length === 1) return whole * ONE_QTX;
  const fracRaw = (parts[1] ?? "").slice(0, 18).padEnd(18, "0");
  return whole * ONE_QTX + BigInt(fracRaw);
}

function formatQtx(amount: bigint): string {
  const whole = amount / ONE_QTX;
  const frac  = amount % ONE_QTX;
  if (frac === 0n) return `${whole.toLocaleString()} QTX`;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fracStr} QTX`;
}

function formatQtxFull(amount: bigint): string {
  return `${formatQtx(amount)} ${gray(`(${amount.toLocaleString()} base)`)}`;
}

// ─── Argument parser ─────────────────────────────────────────────────────────

interface Args {
  command: string;
  positional: string[];
  rpc: string;
  key: string;
  output: string;
  fee: bigint;
  chainId: string;
  raw: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const DEFAULT_RPC = "http://localhost:7331/rpc";
  const DEFAULT_KEY = "./wallet.key.json";

  const positional: string[] = [];
  const raw: Record<string, string> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = argv[i + 1] ?? "";
      raw[key] = val;
      i += 2;
    } else {
      positional.push(arg);
      i++;
    }
  }

  const [command = "help", ...rest] = positional;
  return {
    command,
    positional: rest,
    rpc:     raw["rpc"]      ?? DEFAULT_RPC,
    key:     raw["key"]      ?? DEFAULT_KEY,
    output:  raw["output"]   ?? raw["key"] ?? DEFAULT_KEY,
    fee:     parseQtx(raw["fee"] ?? "0"),
    chainId: raw["chain-id"] ?? "quantix-devnet",
    raw,
  };
}

// ─── Keyfile ─────────────────────────────────────────────────────────────────

interface Keyfile {
  version: string;
  address: string;
  publicKey: string;
  privateKey: string;
  seed: string;
  createdAt: string;
}

function loadKey(path: string): Keyfile {
  if (!existsSync(path)) die(`Keyfile not found: ${path}\nRun "qtx new" to generate a wallet.`);
  try {
    const kf = JSON.parse(readFileSync(path, "utf8")) as Keyfile;
    if (!kf.privateKey || !kf.publicKey || !kf.address) {
      die(`Invalid keyfile (missing fields): ${path}`);
    }
    return kf;
  } catch {
    die(`Could not read keyfile: ${path}`);
  }
}

function saveKey(path: string, kf: Keyfile): void {
  if (existsSync(path)) {
    warn(`Overwriting existing keyfile: ${path}`);
  }
  writeFileSync(path, JSON.stringify(kf, null, 2) + "\n", "utf8");
}

function makeKeyfile(seed: string): Keyfile {
  const kp = generateKeyPair(seed);
  return {
    version:   "quantix-key/v1",
    address:   deriveAddress(kp.publicKey),
    publicKey:  kp.publicKey,
    privateKey: kp.privateKey,
    seed,
    createdAt: new Date().toISOString(),
  };
}

// ─── Commands ────────────────────────────────────────────────────────────────

// qtx new [<output-file>] [--output <file>]
function cmdNew(args: Args) {
  header("Generate New Wallet");
  const seed = randomBytes(32).toString("hex");
  const kf   = makeKeyfile(seed);
  // Accept output path as first positional OR via --output flag.
  // This handles both: `qtx new ./mywallet.key.json`
  // and the npm-flag-safe form: `npm run qtx -- new --output ./mywallet.key.json`
  const out  = args.positional[0] ?? args.output;
  saveKey(out, kf);

  row("Address",  cyan(kf.address));
  separator();
  row("Seed",     yellow(kf.seed));
  row("Public Key", dim(kf.publicKey.slice(0, 32) + "…"));
  row("Keyfile",  kf.address.slice(0, 12) + "…");
  separator();
  console.log();
  warn("Back up your seed! It's the only way to recover your wallet.");
  warn(`Keyfile saved to: ${bold(out)}`);
  console.log();
}

// qtx import <seed-hex> [<output-file>] [--output <file>]
function cmdImport(args: Args) {
  const seed = args.positional[0];
  if (!seed) die("Usage: qtx import <seed-hex> [output-file]");
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    die("Seed must be exactly 64 hex characters (32 bytes).");
  }

  header("Import Wallet");
  const kf  = makeKeyfile(seed.toLowerCase());
  // Accept output path as second positional OR via --output flag.
  const out = args.positional[1] ?? args.output;
  saveKey(out, kf);

  row("Address",  cyan(kf.address));
  row("Public Key", dim(kf.publicKey.slice(0, 32) + "…"));
  row("Keyfile",  out);
  success(`Wallet imported and saved to ${bold(out)}`);
}

// qtx address [--key <file>]
function cmdAddress(args: Args) {
  const kf = loadKey(args.key);
  console.log(`\n  ${cyan(kf.address)}\n`);
}

// qtx balance <address|--key> [--rpc <url>]
async function cmdBalance(args: Args) {
  // address can be positional OR read from keyfile
  const addr = args.positional[0] ?? (existsSync(args.key) ? loadKey(args.key).address : undefined);
  if (!addr) die("Usage: qtx balance <address>  or  qtx balance --key <file>");

  header(`Account: ${trunc(addr, 24)}`);
  try {
    const acc = await getBalance(args.rpc, addr);
    row("Address",  cyan(acc.address));
    row("Balance",  green(formatQtx(acc.balance)));
    row("Staked",   yellow(formatQtx(acc.staked)));
    row("Nonce",    acc.nonce.toString());
    row("RPC",      gray(args.rpc));
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx send <to> <amount> --key <file> [--fee <qtx>] [--rpc <url>]
async function cmdSend(args: Args) {
  const to     = args.positional[0];
  const amount = args.positional[1];
  if (!to || !amount) die("Usage: qtx send <to-address> <amount> --key <file>");

  const kf     = loadKey(args.key);
  const amtBig = parseQtx(amount);

  header("Transfer");
  row("From",   cyan(kf.address));
  row("To",     cyan(to));
  row("Amount", green(formatQtxFull(amtBig)));
  row("Fee",    formatQtx(args.fee));
  row("RPC",    gray(args.rpc));
  separator();

  try {
    const nonce = await getNextNonce(args.rpc, kf.address);
    const tx = buildTransferTx({
      chainId:         args.chainId,
      from:            kf.address,
      to,
      nonce,
      amount:          amtBig,
      fee:             args.fee,
      signerPublicKey: kf.publicKey,
      privateKey:      kf.privateKey,
    });
    const { txHash } = await submitTx(args.rpc, tx);
    success(`Transaction submitted!`);
    row("Tx Hash", yellow(txHash));
    row("Nonce",   nonce.toString());
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx stake <amount> --key <file> [--fee <qtx>] [--rpc <url>]
async function cmdStake(args: Args) {
  const amount = args.positional[0];
  if (!amount) die("Usage: qtx stake <amount> --key <file>");

  const kf     = loadKey(args.key);
  const amtBig = parseQtx(amount);

  header("Stake");
  row("From",   cyan(kf.address));
  row("Amount", green(formatQtxFull(amtBig)));
  row("Fee",    formatQtx(args.fee));
  separator();

  try {
    const nonce = await getNextNonce(args.rpc, kf.address);
    const tx = buildStakeTx({
      chainId:         args.chainId,
      from:            kf.address,
      nonce,
      amount:          amtBig,
      fee:             args.fee,
      signerPublicKey: kf.publicKey,
      privateKey:      kf.privateKey,
    });
    const { txHash } = await submitTx(args.rpc, tx);
    success("Stake submitted!");
    row("Tx Hash", yellow(txHash));
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx unstake <amount> --key <file> [--fee <qtx>] [--rpc <url>]
async function cmdUnstake(args: Args) {
  const amount = args.positional[0];
  if (!amount) die("Usage: qtx unstake <amount> --key <file>");

  const kf     = loadKey(args.key);
  const amtBig = parseQtx(amount);

  header("Unstake");
  row("From",   cyan(kf.address));
  row("Amount", green(formatQtxFull(amtBig)));
  row("Fee",    formatQtx(args.fee));
  separator();

  try {
    const nonce = await getNextNonce(args.rpc, kf.address);
    const tx = buildUnstakeTx({
      chainId:         args.chainId,
      from:            kf.address,
      nonce,
      amount:          amtBig,
      fee:             args.fee,
      signerPublicKey: kf.publicKey,
      privateKey:      kf.privateKey,
    });
    const { txHash } = await submitTx(args.rpc, tx);
    success("Unstake submitted!");
    row("Tx Hash", yellow(txHash));
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx validator register <amount> --key <file> [--fee <qtx>] [--rpc <url>]
async function cmdValidator(args: Args) {
  const sub = args.positional[0];
  if (sub !== "register") die("Usage: qtx validator register <amount> --key <file>");

  const amount = args.positional[1];
  if (!amount) die("Usage: qtx validator register <amount> --key <file>");

  const kf     = loadKey(args.key);
  const amtBig = parseQtx(amount);

  header("Register Validator");
  row("From",         cyan(kf.address));
  row("Validator ID", magenta(kf.address));
  row("Stake",        green(formatQtxFull(amtBig)));
  row("Fee",          formatQtx(args.fee));
  separator();

  try {
    // Read on-chain staked balance to determine how much more to stake.
    // validator_register is rejected by the protocol if sender.staked < minValidatorStake,
    // so we must submit a stake tx first when the account hasn't staked yet.
    const { staked, nonce: chainNonce } = await getBalance(args.rpc, kf.address);
    const additionalStake = amtBig > staked ? amtBig - staked : 0n;
    let nonce = chainNonce + 1;

    if (additionalStake > 0n) {
      // Submit stake tx so that when validator_register is applied in the same block,
      // sender.staked will satisfy minValidatorStake.
      const stakeTx = buildStakeTx({
        chainId:         args.chainId,
        from:            kf.address,
        nonce,
        amount:          additionalStake,
        fee:             args.fee,
        signerPublicKey: kf.publicKey,
        privateKey:      kf.privateKey,
      });
      const { txHash: stakeHash } = await submitTx(args.rpc, stakeTx);
      row("Stake Tx",    yellow(stakeHash));
      nonce++;
    } else {
      row("Already staked", green(formatQtxFull(staked) + " — skipping stake tx"));
    }

    const registerTx = buildValidatorRegisterTx({
      chainId:         args.chainId,
      from:            kf.address,
      validatorId:     kf.address,
      nonce,
      amount:          1n,
      fee:             args.fee,
      signerPublicKey: kf.publicKey,
      privateKey:      kf.privateKey,
    });
    const { txHash } = await submitTx(args.rpc, registerTx);
    success("Validator registration submitted!");
    row("Register Tx", yellow(txHash));
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx block <height|latest> [--rpc <url>]
async function cmdBlock(args: Args) {
  let heightArg = args.positional[0];
  if (!heightArg) die("Usage: qtx block <height|latest>");

  try {
    let height: number;
    if (heightArg === "latest") {
      const latest = await getLatestBlock(args.rpc);
      height = latest.height;
    } else {
      height = parseInt(heightArg, 10);
      if (isNaN(height) || height < 0) die("Invalid block height");
    }

    const b = await getBlock(args.rpc, height);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bFull = b as any;

    header(`Block #${height}`);
    row("Height",      bold(`#${bFull.height}`));
    row("Hash",        cyan(bFull.hash ?? "—"));
    row("Parent Hash", gray(bFull.parentHash ?? "—"));
    row("Proposer",    magenta(bFull.proposer ?? "—"));
    row("Tx Count",    bFull.txCount?.toString() ?? "0");
    row("Status",      bFull.committed ? green("committed") : yellow("pending"));
    row("Timestamp",   bFull.timestamp ? new Date(bFull.timestamp).toISOString() : gray("—"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txs = bFull.txs as any[];
    if (txs && txs.length > 0) {
      separator();
      console.log(`\n  ${bold("Transactions")}  ${gray(`(${txs.length})`)}\n`);
      for (const tx of txs) {
        console.log(`  ${yellow("•")} ${gray(trunc(tx.hash, 20))} ${dim(tx.type.padEnd(20))} ${formatQtx(BigInt(tx.amount))}`);
        console.log(`    ${gray("from:")} ${cyan(trunc(tx.from, 28))}  ${gray("nonce:")} ${tx.nonce}`);
        if (tx.timestamp) console.log(`    ${gray("time: ")} ${gray(new Date(tx.timestamp).toISOString())}`);
        if (tx.to)          console.log(`    ${gray("to:  ")} ${cyan(trunc(tx.to, 28))}`);
        if (tx.validatorId) console.log(`    ${gray("vid: ")} ${magenta(tx.validatorId)}`);
      }
    } else {
      separator();
      console.log(`  ${gray("No transactions in this block.")}`);
    }
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx tx <hash> [--rpc <url>]
async function cmdTx(args: Args) {
  const hash = args.positional[0];
  if (!hash) die("Usage: qtx tx <tx-hash>");

  header(`Transaction`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = await (await rpcRaw(args.rpc, "qtx_getTransaction", [hash])) as any;
    row("Hash",         yellow(t.hash));
    row("Status",       t.status === "committed" ? green("committed") : yellow("pending"));
    row("Block",        t.blockHeight !== null ? `#${t.blockHeight}` : gray("—"));
    row("Block Hash",   t.blockHash ? gray(trunc(t.blockHash, 32)) : gray("—"));
    separator();
    row("Type",         bold(t.type));
    row("From",         cyan(t.from));
    if (t.to)          row("To",           cyan(t.to));
    if (t.validatorId) row("Validator",     magenta(t.validatorId));
    row("Amount",       green(formatQtxFull(BigInt(t.amount))));
    row("Fee",          formatQtx(BigInt(t.fee)));
    row("Nonce",        t.nonce.toString());
    if (t.timestamp) row("Timestamp", new Date(t.timestamp).toISOString());
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx chain [--rpc <url>]
async function cmdChain(args: Args) {
  header("Chain Info");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = await (await rpcRaw(args.rpc, "qtx_getChainInfo", [])) as any;
    row("Chain ID",      bold(info.chainId));
    row("Name",         info.name);
    row("Consensus",    magenta(info.consensus));
    row("Block Interval", `${info.blockIntervalMs}ms`);
    row("Denom",        cyan(info.nativeDenom));
    row("Decimals",     String(info.decimals));
    separator();
    row("Height",       bold(`#${info.height}`));
    row("Active Validators", `${info.activeValidators} / ${info.totalValidators}`);
    row("Mempool",      `${info.mempoolSize} pending`);
    row("Node ID",      gray(info.nodeId));
    row("RPC",          gray(args.rpc));
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx mempool [--rpc <url>]
async function cmdMempool(args: Args) {
  header("Mempool");
  try {
    const txs = await getMempool(args.rpc);
    if (!txs.length) {
      console.log(`  ${gray("Empty — no pending transactions.")}\n`);
      return;
    }
    console.log(`  ${bold("Pending Transactions")}  ${gray(`(${txs.length})`)}\n`);
    for (const tx of txs) {
      console.log(`  ${yellow("•")} ${gray(trunc(tx.hash, 20))} ${dim(tx.type.padEnd(20))} ${cyan(trunc(tx.from, 22))}  ${gray("nonce:")} ${tx.nonce}`);
    }
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// qtx validators [--rpc <url>]
async function cmdValidators(args: Args) {
  header("Validators");
  try {
    const vs = await getValidators(args.rpc);
    if (!vs.length) {
      console.log(`  ${gray("No validators registered.")}\n`);
      return;
    }

    const active  = vs.filter(v =>  v.active && !v.slashed);
    const pending = vs.filter(v => !v.active && !v.slashed);
    const slashed = vs.filter(v =>  v.slashed);

    row("Active",  green(String(active.length)));
    row("Pending", yellow(String(pending.length)));
    row("Slashed", slashed.length ? red(String(slashed.length)) : gray("0"));
    separator();

    for (const v of vs) {
      const status = v.slashed ? red("SLASHED") : v.active ? green("active") : yellow("pending");
      console.log(`  ${magenta(v.id.padEnd(20))} ${status.padEnd(20)}  stake: ${cyan(formatQtx(v.stake))}  missed: ${v.missedBlocks}`);
      console.log(`    ${gray("owner:")} ${cyan(trunc(v.owner, 34))}`);
    }
    console.log();
  } catch (e) {
    handleRpcError(e);
  }
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
${bold(cyan("  ⬡  Quantix Wallet CLI"))}  ${gray("— post-quantum blockchain toolkit")}

  ${bold("Wallet management")}
    ${cyan("qtx new")}           ${gray("[--output <file>]")}              Generate new wallet
    ${cyan("qtx import")}        ${cyan("<seed-hex>")} ${gray("[--output <file>]")}     Import from 64-char seed
    ${cyan("qtx address")}       ${gray("[--key <file>]")}                 Show address

  ${bold("Account queries")}
    ${cyan("qtx balance")}       ${cyan("<address>")} ${gray("[--rpc <url>]")}          Balance, staked, nonce

  ${bold("Transactions")}
    ${cyan("qtx send")}          ${cyan("<to> <amount>")} ${gray("--key <f> [options]")} Transfer QTX
    ${cyan("qtx stake")}         ${cyan("<amount>")}     ${gray("--key <f> [options]")} Stake QTX
    ${cyan("qtx unstake")}       ${cyan("<amount>")}     ${gray("--key <f> [options]")} Unstake QTX
    ${cyan("qtx validator")}     ${cyan("register <amount>")}       ${gray("--key <f>")}  Register validator

  ${bold("Chain queries")}
    ${cyan("qtx block")}         ${cyan("<height|latest>")} ${gray("[--rpc <url>]")}    Block details + txs
    ${cyan("qtx tx")}            ${cyan("<hash>")}         ${gray("[--rpc <url>]")}    Transaction lookup
    ${cyan("qtx chain")}         ${gray("[--rpc <url>]")}                 Chain info & stats
    ${cyan("qtx mempool")}       ${gray("[--rpc <url>]")}                 Pending transactions
    ${cyan("qtx validators")}    ${gray("[--rpc <url>]")}                 Validator set

  ${bold("Options")}
    ${yellow("--key")}   ${gray("<file>")}   Wallet keyfile           ${dim("(default: ./wallet.key.json)")}
    ${yellow("--rpc")}   ${gray("<url>")}    Node RPC endpoint        ${dim("(default: http://localhost:7331/rpc)")}
    ${yellow("--fee")}   ${gray("<qtx>")}    Transaction fee in QTX   ${dim("(default: 0)")}
    ${yellow("--output")} ${gray("<file>")}  Output path for new key  ${dim("(default: ./wallet.key.json)")}

  ${bold("Examples")}
    ${dim("# Generate wallet and save to my-wallet.key.json")}
    tsx tools/wallet/qtx.ts new --output my-wallet.key.json

    ${dim("# Import from seed")}
    tsx tools/wallet/qtx.ts import aaaa...64hex --output my-wallet.key.json

    ${dim("# Check balance on devnet")}
    tsx tools/wallet/qtx.ts balance qtx1abc... --rpc http://localhost:7331/rpc

    ${dim("# Send 10 QTX")}
    tsx tools/wallet/qtx.ts send qtx1dest... 10 --key my-wallet.key.json

    ${dim("# Stake 50 QTX with 0.001 QTX fee")}
    tsx tools/wallet/qtx.ts stake 50 --key my-wallet.key.json --fee 0.001

    ${dim("# Register as validator (minimum stake: 32 QTX)")}
    tsx tools/wallet/qtx.ts validator register 32 --key my-wallet.key.json
`);
}

// ─── Generic RPC helper (for methods not in SDK yet) ─────────────────────────

async function rpcRaw(endpoint: string, method: string, params: unknown[]): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (cause) {
    throw new Error(`Network error connecting to ${endpoint}: ${String(cause)}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = (await response.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (json.error) throw new RpcError(json.error.message, json.error.code);
  return json.result;
}

// ─── Error handler ────────────────────────────────────────────────────────────

function handleRpcError(e: unknown): never {
  if (e instanceof RpcError) {
    die(`RPC error (${e.code}): ${e.message}`);
  }
  die(String(e));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function trunc(s: string, max: number): string {
  return s && s.length > max ? s.slice(0, max - 1) + "…" : (s || "—");
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "new":        cmdNew(args);            break;
    case "import":     cmdImport(args);         break;
    case "address":    cmdAddress(args);        break;
    case "balance":    await cmdBalance(args);  break;
    case "send":       await cmdSend(args);     break;
    case "stake":      await cmdStake(args);    break;
    case "unstake":    await cmdUnstake(args);  break;
    case "validator":  await cmdValidator(args);break;
    case "block":      await cmdBlock(args);    break;
    case "tx":         await cmdTx(args);       break;
    case "chain":      await cmdChain(args);    break;
    case "mempool":    await cmdMempool(args);  break;
    case "validators": await cmdValidators(args);break;
    case "help":
    case "--help":
    case "-h":
    default:
      cmdHelp();
  }
}

main().catch((e) => {
  die(String(e));
});
