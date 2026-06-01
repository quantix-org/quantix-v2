import Link from "next/link";
import { Cell } from "@/components/Cell";
import PageChrome from "@/components/PageChrome";
import NumberTicker from "@/components/NumberTicker";
import { statusBadge, txTypeBadge, validatorBadge } from "@/components/Badges";
import { DualSparklineChart, HorizontalBars, SparklineChart } from "@/components/Charts";
import { formatQtx, formatQtxCompact, formatTime, shortAddress, shortHash } from "@/lib/format";
import {
  getBlock,
  getChainInfo,
  getLatestBlock,
  getMempool,
  getPeers,
  getRewardHistory,
  getValidators,
} from "@/lib/rpc";

export const dynamic = "force-dynamic";

function toMilliQtx(raw: string | number | bigint | null | undefined): number {
  if (typeof raw === "bigint") return Number(raw / 1000000000000000n);
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    try {
      return Number(BigInt(trimmed) / 1000000000000000n);
    } catch {
      const n = Number(trimmed);
      return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    }
  }
  return 0;
}

export default async function HomePage() {
  try {
    const [info, latest, validators, mempool, peers, rewardHistory] = await Promise.all([
      getChainInfo(),
      getLatestBlock(),
      getValidators(),
      getMempool(),
      getPeers(),
      getRewardHistory(0, 999999999).catch(() => []),
    ]);

    const h = latest.height;
    const heights = Array.from({ length: Math.min(10, h + 1) }, (_, i) => h - i).filter((x) => x >= 0);
    const blocks = (await Promise.all(heights.map((height) => getBlock(height).catch(() => null)))).filter(Boolean);

    const activeValidators = validators.filter((v) => v.active && !v.slashed).length;
    const recentTxs = blocks.flatMap((b) => (b?.txs ?? []).map((tx) => ({ tx, height: b!.height }))).slice(0, 10);

    const rewardByHeight = new Map<number, (typeof rewardHistory)[number]>();
    for (const r of rewardHistory) rewardByHeight.set(r.height, r);

    const latestReward = rewardByHeight.get(h);
    const blocksAsc = [...blocks].reverse();
    const txPerBlockPoints = blocksAsc.map((b) => ({ label: `#${b!.height}`, value: b!.txCount }));

    const intervalPoints = blocksAsc.map((b, i) => {
      if (i === 0) return { label: `#${b!.height}`, value: info.blockIntervalMs };
      const prev = blocksAsc[i - 1]!;
      const delta = Math.max(0, b!.timestamp - prev.timestamp);
      return { label: `#${b!.height}`, value: delta };
    });

    const rewardAsc = [...rewardHistory].sort((a, b) => a.height - b.height).slice(-20);
    const rewardPoolPoints = rewardAsc.map((r) => ({
      label: `#${r.height}`,
      value: toMilliQtx(r.validatorFeePool),
    }));
    const burnPoints = rewardAsc.map((r) => ({
      label: `#${r.height}`,
      value: toMilliQtx(r.burnedFees),
    }));

    const stakeBars = [...validators]
      .sort((a, b) => toMilliQtx(b.stake) - toMilliQtx(a.stake))
      .slice(0, 8)
      .map((v) => ({ label: shortAddress(v.id, 8), value: toMilliQtx(v.stake) }));

    return (
      <PageChrome active="home">
        <div className="page-head">
          <div>
            <h1 className="page-title">Quantix Explorer</h1>
            <p className="page-sub">Standalone explorer for blocks, validators, rewards, and network state.</p>
          </div>
          <div className="small-muted">Chain: {info.chainId}</div>
        </div>

        <section className="stats">
          <div className="stat"><div className="lbl">Block Height</div><div className="val"><NumberTicker value={h} /></div><div className="sub">latest committed</div></div>
          <div className="stat"><div className="lbl">Active Validators</div><div className="val">{activeValidators}</div><div className="sub">of {validators.length} registered</div></div>
          <div className="stat"><div className="lbl">Mempool</div><div className="val">{mempool.length}</div><div className="sub">pending txs</div></div>
          <div className="stat"><div className="lbl">Block Interval</div><div className="val">{info.blockIntervalMs}ms</div><div className="sub">{info.name}</div></div>
          <div className="stat"><div className="lbl">Peers</div><div className="val">{peers.length}</div><div className="sub">connected nodes</div></div>
          <div className="stat"><div className="lbl">Reward Mode</div><div className="val">{info.rewards?.enabled ? info.rewards.mode ?? "enabled" : "off"}</div><div className="sub">block {formatQtxCompact(info.rewards?.blockReward ?? "0")} QTX</div></div>
          <div className="stat"><div className="lbl">Latest Fee Pool</div><div className="val">{latestReward ? formatQtxCompact(latestReward.validatorFeePool) : "—"}</div><div className="sub">burned {latestReward ? formatQtxCompact(latestReward.burnedFees) : "—"} QTX</div></div>
        </section>

        <div className="grid-three pb-5">
          <SparklineChart
            title="Tx Throughput"
            subtitle="Transactions per committed block"
            points={txPerBlockPoints}
            colorClass="spark-a"
          />
          <SparklineChart
            title="Block Interval"
            subtitle="Observed block spacing (ms)"
            points={intervalPoints}
            colorClass="spark-b"
          />
          <HorizontalBars
            title="Stake Distribution"
            subtitle="Top validator stake (milli-QTX)"
            items={stakeBars}
          />
        </div>

        <div className="grid-two pb-5">
          <DualSparklineChart
            title="Reward vs Burn Trend"
            subtitle="Recent reward history, scaled in milli-QTX"
            left={rewardPoolPoints}
            right={burnPoints}
            leftLabel="Validator fee pool"
            rightLabel="Burned fees"
          />
          <HorizontalBars
            title="Mempool Composition"
            subtitle="Pending transaction type distribution"
            items={Object.entries(
              mempool.reduce<Record<string, number>>((acc, tx) => {
                acc[tx.type] = (acc[tx.type] ?? 0) + 1;
                return acc;
              }, {})
            ).map(([label, value]) => ({ label, value }))}
          />
        </div>

        <div className="grid-two pb-5">
          <section className="card">
            <div className="card-head">Recent Blocks</div>
            <table className="tbl">
              <thead><tr><th>Height</th><th>Time</th><th>Proposer</th><th>Txs</th><th>Status</th><th>Reward Pool</th><th>Burned Fees</th><th>Hash</th></tr></thead>
              <tbody>
                {blocks.length === 0 ? (
                  <tr><td className="empty" colSpan={8}>No blocks yet</td></tr>
                ) : blocks.map((b) => {
                  const r = rewardByHeight.get(b!.height);
                  return (
                    <tr key={b!.height}>
                      <Cell label="Height"><Link href={`/block/${b!.height}`}>#{b!.height}</Link></Cell>
                      <Cell label="Time"><span className="small-muted">{formatTime(b!.timestamp)}</span></Cell>
                      <Cell label="Proposer"><Link href={`/address/${b!.proposer}`}>{shortAddress(b!.proposer)}</Link></Cell>
                      <Cell label="Txs">{b!.txCount}</Cell>
                      <Cell label="Status">{statusBadge(b!.committed)}</Cell>
                      <Cell label="Reward Pool">{r ? `${formatQtxCompact(r.validatorFeePool)} QTX` : "—"}</Cell>
                      <Cell label="Burned Fees">{r ? `${formatQtxCompact(r.burnedFees)} QTX` : "—"}</Cell>
                      <Cell label="Hash">{shortHash(b!.hash, 10)}</Cell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="card">
            <div className="card-head">Recent Transactions</div>
            <table className="tbl">
              <thead><tr><th>Tx Hash</th><th>Time</th><th>Type</th><th>From</th><th>To</th><th>Amount</th></tr></thead>
              <tbody>
                {recentTxs.length === 0 ? (
                  <tr><td className="empty" colSpan={6}>No transactions yet</td></tr>
                ) : recentTxs.map(({ tx }, idx) => (
                  <tr key={`${tx.hash}-${idx}`}>
                    <Cell label="Tx Hash"><Link href={`/tx/${tx.hash}`}>{shortHash(tx.hash)}</Link></Cell>
                    <Cell label="Time"><span className="small-muted">{formatTime(tx.timestamp)}</span></Cell>
                    <Cell label="Type">{txTypeBadge(tx.type)}</Cell>
                    <Cell label="From"><Link href={`/address/${tx.from}`}>{shortAddress(tx.from)}</Link></Cell>
                    <Cell label="To">{tx.to ? <Link href={`/address/${tx.to}`}>{shortAddress(tx.to)}</Link> : tx.validatorId ? <Link href={`/address/${tx.validatorId}`}>{shortAddress(tx.validatorId)}</Link> : tx.contractAddress ? <Link href={`/address/${tx.contractAddress}`}>{shortAddress(tx.contractAddress)}</Link> : "—"}</Cell>
                    <Cell label="Amount">{formatQtx(tx.amount)} QTX</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <section className="card">
          <div className="card-head">Validators <Link href="/validators">View all ↗</Link></div>
          <table className="tbl">
            <thead><tr><th>Address</th><th>Stake</th><th>Cumulative Rewards</th><th>Status</th><th>Missed Blocks</th></tr></thead>
            <tbody>
              {validators.length === 0 ? (
                <tr><td className="empty" colSpan={5}>No validators registered</td></tr>
              ) : validators.slice(0, 12).map((v) => (
                <tr key={v.id}>
                  <Cell label="Address"><Link href={`/address/${v.id}`}>{shortAddress(v.id)}</Link></Cell>
                  <Cell label="Stake">{formatQtx(v.stake)} QTX</Cell>
                  <Cell label="Cumulative Rewards">{formatQtx(v.cumulativeRewards ?? "0")} QTX</Cell>
                  <Cell label="Status">{validatorBadge(v)}</Cell>
                  <Cell label="Missed Blocks">{v.missedBlocks}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="grid-two">
          <section className="card">
            <div className="card-head">Mempool</div>
            <table className="tbl">
              <thead><tr><th>Tx Hash</th><th>Type</th><th>From</th><th>Amount</th><th>Nonce</th></tr></thead>
              <tbody>
                {mempool.length === 0 ? (
                  <tr><td className="empty" colSpan={5}>Empty — no pending transactions</td></tr>
                ) : mempool.slice(0, 8).map((tx, idx) => (
                  <tr key={`${tx.hash}-${idx}`}>
                    <Cell label="Tx Hash"><Link href={`/tx/${tx.hash}`}>{shortHash(tx.hash)}</Link></Cell>
                    <Cell label="Type">{txTypeBadge(tx.type)}</Cell>
                    <Cell label="From"><Link href={`/address/${tx.from}`}>{shortAddress(tx.from)}</Link></Cell>
                    <Cell label="Amount">{formatQtx(tx.amount)} QTX</Cell>
                    <Cell label="Nonce">{tx.nonce}</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <div className="card-head">Peers</div>
            <table className="tbl">
              <thead><tr><th>Node ID</th><th>Endpoint</th></tr></thead>
              <tbody>
                {peers.length === 0 ? (
                  <tr><td className="empty" colSpan={2}>No peers connected</td></tr>
                ) : peers.map((p) => (
                  <tr key={`${p.id}-${p.endpoint}`}>
                    <Cell label="Node ID">{shortAddress(p.id, 8)}</Cell>
                    <Cell label="Endpoint">{p.endpoint}</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </PageChrome>
    );
  } catch (e) {
    return (
      <PageChrome active="home">
        <div className="err">Failed to load explorer home: {e instanceof Error ? e.message : "unknown error"}</div>
      </PageChrome>
    );
  }
}
