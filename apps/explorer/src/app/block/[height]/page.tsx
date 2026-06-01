import Link from "next/link";
import { Cell } from "@/components/Cell";
import { statusBadge, txTypeBadge } from "@/components/Badges";
import PageChrome from "@/components/PageChrome";
import KvRow from "@/components/KvRow";
import CopyButton from "@/components/CopyButton";
import { formatQtx, formatTime, shortAddress, shortHash } from "@/lib/format";
import { getBlock, getLatestBlock, getRewardHistory } from "@/lib/rpc";

export const dynamic = "force-dynamic";

export default async function BlockPage({ params }: { params: Promise<{ height: string }> }) {
  const { height } = await params;
  const h = Number(height);
  if (!Number.isFinite(h) || h < 0) {
    return (
      <PageChrome>
        <div className="err">Invalid block height.</div>
      </PageChrome>
    );
  }

  try {
    const [latest, block, rewardRows] = await Promise.all([
      getLatestBlock(),
      getBlock(h),
      getRewardHistory(h, h).catch(() => []),
    ]);
    const reward = rewardRows[0] ?? null;

    return (
      <PageChrome>
        <div className="breadcrumb">
          <Link href="/">Home</Link><span className="sep">›</span><span>Block #{h}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {h > 0 ? <Link href={`/block/${h - 1}`}>← Prev</Link> : null}
            {h < latest.height ? <Link href={`/block/${h + 1}`}>Next →</Link> : null}
          </span>
        </div>

        <section className="card">
          <div className="card-head">Block #{h} {statusBadge(block.committed)}</div>
          <KvRow label="Height" value={String(block.height)} />
          <KvRow label="Hash" value={<span>{block.hash} <CopyButton value={block.hash} /></span>} />
          <KvRow label="Parent Hash" value={block.height > 0 ? <Link href={`/block/${block.height - 1}`}>{block.parentHash ?? "—"}</Link> : "genesis"} />
          <KvRow label="Proposer" value={<span><Link href={`/address/${block.proposer}`}>{block.proposer}</Link> <CopyButton value={block.proposer} /></span>} />
          <KvRow label="Timestamp" value={formatTime(block.timestamp)} />
          <KvRow label="Transactions" value={String(block.txCount)} />
          {reward ? <KvRow label="Reward Proposer" value={<Link href={`/address/${reward.proposerId}`}>{shortAddress(reward.proposerId)}</Link>} /> : null}
          {reward ? <KvRow label="Total Fees" value={`${formatQtx(reward.totalFees)} QTX`} /> : null}
          {reward ? <KvRow label="Validator Fee Pool" value={`${formatQtx(reward.validatorFeePool)} QTX`} /> : null}
          {reward ? <KvRow label="Burned Fees" value={`${formatQtx(reward.burnedFees)} QTX`} /> : null}
          {reward ? <KvRow label="Fixed Block Reward" value={`${formatQtx(reward.blockReward)} QTX`} /> : null}
        </section>

        <section className="card">
          <div className="card-head">Transactions ({block.txCount})</div>
          <table className="tbl">
            <thead><tr><th>Tx Hash</th><th>Time</th><th>Type</th><th>From</th><th>To / Validator</th><th>Amount</th><th>Fee</th><th>Nonce</th></tr></thead>
            <tbody>
              {!block.txs || block.txs.length === 0 ? (
                <tr><td className="empty" colSpan={8}>No transactions in this block</td></tr>
              ) : block.txs.map((t) => (
                <tr key={t.hash}>
                  <Cell label="Tx Hash"><Link href={`/tx/${t.hash}`}>{shortHash(t.hash)}</Link></Cell>
                  <Cell label="Time"><span className="small-muted">{formatTime(t.timestamp)}</span></Cell>
                  <Cell label="Type">{txTypeBadge(t.type)}</Cell>
                  <Cell label="From"><Link href={`/address/${t.from}`}>{shortAddress(t.from)}</Link></Cell>
                  <Cell label="To / Validator">{t.to ? <Link href={`/address/${t.to}`}>{shortAddress(t.to)}</Link> : t.validatorId ? <Link href={`/address/${t.validatorId}`}>{shortAddress(t.validatorId)}</Link> : t.contractAddress ? <Link href={`/address/${t.contractAddress}`}>{shortAddress(t.contractAddress)}</Link> : "—"}</Cell>
                  <Cell label="Amount">{formatQtx(t.amount)} QTX</Cell>
                  <Cell label="Fee">{formatQtx(t.fee)} QTX</Cell>
                  <Cell label="Nonce">{t.nonce}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </PageChrome>
    );
  } catch (e) {
    return (
      <PageChrome>
        <div className="err">Failed to load block #{h}: {e instanceof Error ? e.message : "unknown error"}</div>
      </PageChrome>
    );
  }
}
