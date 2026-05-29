"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { type WalletFile, parseWalletFile } from "@/lib/crypto";
import { getBalance, getLatestBlock, type RpcBalance, type RpcBlock } from "@/lib/rpc";

// ── Types ────────────────────────────────────────────────────────────────────

interface WalletState {
  wallet: WalletFile | null;
  balance: RpcBalance | null;
  latestBlock: RpcBlock | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  nodeUrl: string;
  setNodeUrl: (url: string) => void;
  loadWallet: (wf: WalletFile) => void;
  clearWallet: () => void;
  refresh: () => Promise<void>;
}

const WalletCtx = createContext<WalletState | null>(null);

const STORAGE_KEY = "qtx_wallet_v1";
const NODE_URL_KEY = "qtx_node_url";
const DEFAULT_NODE = "http://localhost:7330/rpc";

// ── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletFile | null>(null);
  const [balance, setBalance] = useState<RpcBalance | null>(null);
  const [latestBlock, setLatestBlock] = useState<RpcBlock | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodeUrl, setNodeUrlState] = useState(DEFAULT_NODE);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Hydrate from sessionStorage (private key NOT in localStorage) ──────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = parseWalletFile(JSON.parse(raw));
        setWallet(parsed);
      }
    } catch {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      setError("Stored wallet is incompatible or corrupted. Please import a valid ML-DSA-87 wallet file.");
    }

    try {
      const saved = localStorage.getItem(NODE_URL_KEY);
      if (saved) setNodeUrlState(saved);
    } catch { /* ignore */ }
  }, []);

  // ── Refresh balance + latest block ────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [block, bal] = await Promise.all([
        getLatestBlock(),
        wallet ? getBalance(wallet.address) : Promise.resolve(null),
      ]);
      setLatestBlock(block);
      if (bal) setBalance(bal);
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  // ── Start / stop polling when wallet or nodeUrl changes ───────────────────
  useEffect(() => {
    refresh();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(refresh, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh, nodeUrl]); // nodeUrl triggers re-render → new fetch via /api/rpc

  // ── Actions ───────────────────────────────────────────────────────────────
  const loadWallet = useCallback((wf: WalletFile) => {
    const parsed = parseWalletFile(wf);
    setWallet(parsed);
    setError(null);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); } catch { /* ignore */ }
  }, []);

  const clearWallet = useCallback(() => {
    setWallet(null);
    setBalance(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const setNodeUrl = useCallback((url: string) => {
    setNodeUrlState(url);
    try { localStorage.setItem(NODE_URL_KEY, url); } catch { /* ignore */ }
  }, []);

  return (
    <WalletCtx.Provider value={{
      wallet, balance, latestBlock, connected, loading, error,
      nodeUrl, setNodeUrl, loadWallet, clearWallet, refresh,
    }}>
      {children}
    </WalletCtx.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWallet(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
