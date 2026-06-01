import type { StoredAccount } from "@quantix/wallet-core";

export type AccountRecord = StoredAccount & { name: string };

export type VaultData = {
  version: 1;
  accounts: Record<string, AccountRecord>;
  activeAddress: string | null;
  createdAt: number;
  updatedAt: number;
};

export type EncryptedVault = {
  version: 1;
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};
