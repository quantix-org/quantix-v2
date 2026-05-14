import { createHash } from "node:crypto";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";

export interface PqKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generatePqKeyPair(seedHex?: string): PqKeyPair {
  const seed = seedHex ? hexToBytes(seedHex) : undefined;
  const { secretKey, publicKey } = ml_dsa87.keygen(seed);
  return {
    privateKey: bytesToHex(secretKey),
    publicKey: bytesToHex(publicKey),
  };
}

export function signPqMessage(privateKey: string, payload: string): string {
  const secretKey = hexToBytes(privateKey);
  const msg = utf8ToBytes(payload);
  return bytesToHex(ml_dsa87.sign(msg, secretKey));
}

export function verifyPqSignature(publicKey: string, payload: string, signature: string): boolean {
  const pub = hexToBytes(publicKey);
  const msg = utf8ToBytes(payload);
  const sig = hexToBytes(signature);
  return ml_dsa87.verify(sig, msg, pub);
}

export function deriveAddressFromPublicKey(publicKey: string): string {
  return `qtx1${sha256Hex(publicKey).slice(0, 38)}`;
}

function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
