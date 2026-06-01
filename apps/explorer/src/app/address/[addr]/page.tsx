import Link from "next/link";
import { Cell } from "@/components/Cell";
import PageChrome from "@/components/PageChrome";
import KvRow from "@/components/KvRow";
import CopyButton from "@/components/CopyButton";
import { txTypeBadge, validatorBadge } from "@/components/Badges";
import { formatQtx, formatTime, shortAddress, shortHash } from "@/lib/format";
import { getBalance, getBlock, getLatestBlock, getValidatorRewards, getValidators } from "@/lib/rpc";

export const dynamic = "force-dynamic";

export default async function AddressPage({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  try {
    const [balance, validators, latest] = await Promise.all([
      getBalance(addr),
      getValidators(),
      getLatestBlock(),
    ]);

    const validator = validators.find((v) => v.id === addr);
    const rewardSummary = validator ? await getValidatorRewards(addr).catch(() => null) : null;

    const from = Math.max(0, latest.height - 49);
    const blocks = (await Promise.all(
      Array.from({ length: latest.height - from + 1 }, (_, i) => getBlock(from + i).catch(() => null))
    )).filter(Boolean);

    const history = blocks
      .flatMap((b) => (b!.txs ?? []).map((tx) => ({ tx, height: b!.height })))
      .filter(({ tx }) => tx.from === addr || tx.to === addr || tx.validatorId === addr || tx.contractAddress === addr)
      .reverse();

    return (
      <PageChrome>
        <div className="breadcrumb"><Link href="/">Home</Link><span className="sep">›</span><span>Address</span></div>

        <section className="card">
          <div className="card-head">Address</div>
          <KvRow label="Address" value={<span>{addr} <CopyButton value={addr} /></span>} />
          <KvRow label="Balance" value={<strong>{formatQtx(balance.balance)} QTX</strong>} />
          <KvRow label="Staked" value={`${formatQtx(balance.staked)} QTX`} />
          <KvRow label="Nonce" value={String(balance.nonce)} />
          {validator ? <KvRow label="Validator" value={<span>{validatorBadge(validator)} missed: {validator.missedBlocks}</span>} /> : null}
          {rewardSummary ? <KvRow label="Cumulative Rewards" value={<strong>{formatQtx(rewardSummary.cumulativeRewards)} QTX</strong>} /> : null}
          {rewardSummary ? <KvRow label="Last Reward Height" value={String(rewardSummary.lastRewardHeight)} /> : null}
        </section>

        <section className="card">
          <div className="card-head">Transaction History <span className="small-muted">last 50 blocks</span></div>
          <table className="tbl">
            <thead><tr><th>Tx Hash</th><th>Block</th><th>Time</th><th>Type</th><th>Dir</th><th>Counterpart</th><th>Amount</th></tr></thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td className="empty" colSpan={7}>No transactions found in last 50 blocks</td></tr>
              ) : history.map(({ tx, height }, idx) => {
                const isOut = tx.from === addr;
                const counterpart = isOut
                  ? tx.to ?? tx.validatorId ?? tx.contractAddress ?? "—"
                  : tx.from;
                return (
                  <tr key={`${tx.hash}-${idx}`}>
                    <Cell label="Tx Hash"><Link href={`/tx/${tx.hash}`}>{shortHash(tx.hash)}</Link></Cell>
                    <Cell label="Block"><Link href={`/block/${height}`}>#{height}</Link></Cell>
                    <Cell label="Time"><span className="small-muted">{formatTime(tx.timestamp)}</span></Cell>
                    <Cell label="Type">{txTypeBadge(tx.type)}</Cell>
                    <Cell label="Dir">{isOut ? <span style={{ color: "var(--red)", fontWeight: 700 }}>OUT</span> : <span style={{ color: "var(--green)", fontWeight: 700 }}>IN</span>}</Cell>
                    <Cell label="Counterpart">{counterpart === "—" ? "—" : <Link href={`/address/${counterpart}`}>{shortAddress(counterpart)}</Link>}</Cell>
                    <Cell label="Amount">{formatQtx(tx.amount)} QTX</Cell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </PageChrome>
    );
  } catch (e) {
    return (
      <PageChrome>
        <div className="err">Failed to load address {addr}: {e instanceof Error ? e.message : "unknown error"}</div>
      </PageChrome>
    );
  }
}
