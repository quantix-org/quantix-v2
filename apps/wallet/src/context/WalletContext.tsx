/**
 * Global wallet state and context.
 * Private keys NEVER touch localStorage — session memory only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { WalletFile } from "../lib/crypto";
import {
  getBalance,
  getLatestBlock,
  testConnection,
} from "../lib/rpc";
import type { RpcBlock } from "../lib/rpc";

// ─── State types ──────────────────────────────────────────────────────────────

export interface AccountState {
  balance: bigint;
  staked: bigint;
  nonce: number;
}

export interface WalletState {
  wallet: WalletFile | null;
  endpoint: string;
  chainId: string;
  connected: boolean;
  connecting: boolean;
  account: AccountState | null;
  latestBlock: RpcBlock | null;
  error: string | null;
}

export interface WalletActions {
  setWallet: (w: WalletFile | null) => void;
  setEndpoint: (url: string) => void;
  refreshAccount: () => Promise<void>;
  refreshBlock: () => Promise<void>;
  connect: () => Promise<void>;
  clearError: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const WalletContext = createContext<(WalletState & WalletActions) | null>(null);

export function useWallet(): WalletState & WalletActions {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWalletState] = useState<WalletFile | null>(null);
  const [endpoint, setEndpointState] = useState(
    () => localStorage.getItem("qtx_endpoint") ?? "http://localhost:7330/rpc"
  );
  const [chainId] = useState("quantix-devnet");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [latestBlock, setLatestBlock] = useState<RpcBlock | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endpointRef = useRef(endpoint);
  useEffect(() => {
    endpointRef.current = endpoint;
  }, [endpoint]);

  const clearError = useCallback(() => setError(null), []);

  const setEndpoint = useCallback((url: string) => {
    setEndpointState(url);
    localStorage.setItem("qtx_endpoint", url);
    setConnected(false);
  }, []);

  const setWallet = useCallback((w: WalletFile | null) => {
    setWalletState(w);
    setAccount(null);
  }, []);

  const refreshBlock = useCallback(async () => {
    try {
      const block = await getLatestBlock(endpointRef.current);
      setLatestBlock(block);
    } catch {
      // non-fatal
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!wallet) return;
    try {
      const bal = await getBalance(endpointRef.current, wallet.address);
      setAccount({
        balance: BigInt(bal.balance),
        staked: BigInt(bal.staked),
        nonce: 0, // nonce fetched on-demand at send time
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [wallet]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      await testConnection(endpointRef.current);
      setConnected(true);
      await refreshBlock();
    } catch (e) {
      setConnected(false);
      setError(
        `Cannot reach node at ${endpointRef.current} — ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      setConnecting(false);
    }
  }, [refreshBlock]);

  // Auto-connect on mount and when endpoint changes
  useEffect(() => {
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  // Refresh account whenever wallet or connection state changes
  useEffect(() => {
    if (connected && wallet) {
      refreshAccount();
    }
  }, [connected, wallet, refreshAccount]);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        endpoint,
        chainId,
        connected,
        connecting,
        account,
        latestBlock,
        error,
        setWallet,
        setEndpoint,
        refreshAccount,
        refreshBlock,
        connect,
        clearError,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
