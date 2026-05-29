/**
 * Browser-safe ML-DSA-87 crypto — mirrors @quantix/crypto without Node.js APIs.
 * Uses @noble/post-quantum (browser-compatible) and @noble/hashes/sha256
 * instead of node:crypto.
 */

import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

// ─── Internal helpers ────────────────────────────────────────────────────────

function textToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function sha256HexOf(input: string): string {
  return bytesToHex(sha256(textToBytes(input)));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface KeyPair {
  privateKey: string; // hex
  publicKey: string;  // hex
}

export interface WalletFile {
  version: "quantix-key/v1";
  address: string;
  publicKey: string;
  privateKey: string;
}

/** Derive a Quantix address from a hex-encoded ML-DSA-87 public key. */
export function deriveAddress(publicKey: string): string {
  return `qtx1${sha256HexOf(publicKey).slice(0, 38)}`;
}

/** Generate a fresh ML-DSA-87 keypair using WebCrypto randomness. */
export function generateKeyPair(): KeyPair {
  const { secretKey, publicKey } = ml_dsa87.keygen();
  return {
    privateKey: bytesToHex(secretKey),
    publicKey: bytesToHex(publicKey),
  };
}

/** Sign a UTF-8 payload string with an ML-DSA-87 private key (hex). */
export function signPayload(privateKey: string, payload: string): string {
  const sk = hexToBytes(privateKey);
  const msg = textToBytes(payload);
  return bytesToHex(ml_dsa87.sign(msg, sk));
}

/** Serialize a WalletFile to a downloadable JSON blob. */
export function walletToJson(kp: KeyPair): WalletFile {
  return {
    version: "quantix-key/v1",
    address: deriveAddress(kp.publicKey),
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
  };
}

/** Parse a WalletFile from JSON. Throws if the structure is invalid. */
export function parseWalletFile(json: unknown): WalletFile {
  if (
    typeof json !== "object" ||
    json === null ||
    (json as Record<string, unknown>)["version"] !== "quantix-key/v1" ||
    typeof (json as Record<string, unknown>)["address"] !== "string" ||
    typeof (json as Record<string, unknown>)["publicKey"] !== "string" ||
    typeof (json as Record<string, unknown>)["privateKey"] !== "string"
  ) {
    throw new Error("Invalid wallet file: expected quantix-key/v1 format");
  }
  return json as WalletFile;
}
