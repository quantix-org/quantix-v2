import Link from "next/link";
import { Cell } from "@/components/Cell";
import PageChrome from "@/components/PageChrome";
import { formatQtx, formatQtxCompact, formatTime, shortAddress } from "@/lib/format";
import { getChainInfo, getLatestBlock, getRewardHistory } from "@/lib/rpc";

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  try {
    const [info, latest] = await Promise.all([getChainInfo(), getLatestBlock()]);
    const start = Math.max(0, latest.height - 199);
    const history = await getRewardHistory(start, latest.height);
    const ordered = [...history].sort((a, b) => b.height - a.height);

    return (
      <PageChrome active="rewards">
        <div className="breadcrumb"><Link href="/">Home</Link><span className="sep">›</span><span>Rewards</span></div>
        <div className="page-head">
          <div>
            <h1 className="page-title">Rewards</h1>
            <p className="page-sub">Block reward and fee split distribution from recent history.</p>
          </div>
          <div className="small-muted">Mode: {info.rewards?.enabled ? info.rewards.mode ?? "enabled" : "off"}</div>
        </div>

        <section className="stats">
          <div className="stat"><div className="lbl">Reward Enabled</div><div className="val">{info.rewards?.enabled ? "yes" : "no"}</div><div className="sub">from chain config</div></div>
          <div className="stat"><div className="lbl">Block Reward</div><div className="val">{formatQtxCompact(info.rewards?.blockReward ?? "0")}</div><div className="sub">QTX per block</div></div>
          <div className="stat"><div className="lbl">Fee Share</div><div className="val">{info.rewards?.validatorFeeSharePercent ?? 0}%</div><div className="sub">to validators</div></div>
          <div className="stat"><div className="lbl">Proposer Bonus</div><div className="val">{info.rewards?.proposerBonusPercent ?? 0}%</div><div className="sub">inside validator share</div></div>
        </section>

        <section className="card">
          <div className="card-head">Recent Reward History ({ordered.length})</div>
          <table className="tbl">
            <thead><tr><th>Height</th><th>Proposer</th><th>Total Fees</th><th>Validator Pool</th><th>Burned Fees</th><th>Block Reward</th><th>Timestamp</th></tr></thead>
            <tbody>
              {ordered.length === 0 ? (
                <tr><td className="empty" colSpan={7}>No reward history available</td></tr>
              ) : ordered.map((r) => (
                <tr key={r.height}>
                  <Cell label="Height"><Link href={`/block/${r.height}`}>#{r.height}</Link></Cell>
                  <Cell label="Proposer"><Link href={`/address/${r.proposerId}`}>{shortAddress(r.proposerId)}</Link></Cell>
                  <Cell label="Total Fees">{formatQtx(r.totalFees)} QTX</Cell>
                  <Cell label="Validator Pool">{formatQtx(r.validatorFeePool)} QTX</Cell>
                  <Cell label="Burned Fees">{formatQtx(r.burnedFees)} QTX</Cell>
                  <Cell label="Block Reward">{formatQtx(r.blockReward)} QTX</Cell>
                  <Cell label="Timestamp">{r.timestamp ? formatTime(r.timestamp) : "—"}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </PageChrome>
    );
  } catch (e) {
    return (
      <PageChrome active="rewards">
        <div className="err">Failed to load rewards: {e instanceof Error ? e.message : "unknown error"}</div>
      </PageChrome>
    );
  }
}
