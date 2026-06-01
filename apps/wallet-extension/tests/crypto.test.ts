import test from "node:test";
import assert from "node:assert/strict";
import { encryptVault, decryptVault } from "../src/shared/crypto";

const sampleVault = {
  version: 1,
  accounts: {
    qtx1abc: {
      address: "qtx1abc",
      publicKey: "a".repeat(64),
      privateKey: "b".repeat(64),
      name: "Account 1",
      createdAt: 1
    }
  },
  activeAddress: "qtx1abc",
  createdAt: 1,
  updatedAt: 1
};

test("encrypt/decrypt roundtrip", async () => {
  const password = "correct-horse-battery-staple";
  const encrypted = await encryptVault(sampleVault, password);
  const decrypted = await decryptVault(encrypted, password);
  assert.deepEqual(decrypted, sampleVault);
});
