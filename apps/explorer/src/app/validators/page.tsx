import Link from "next/link";
import { Cell } from "@/components/Cell";
import PageChrome from "@/components/PageChrome";
import { validatorBadge } from "@/components/Badges";
import { formatQtx, shortAddress } from "@/lib/format";
import { getValidators } from "@/lib/rpc";

export const dynamic = "force-dynamic";

export default async function ValidatorsPage() {
  try {
    const validators = await getValidators();
    return (
      <PageChrome active="validators">
        <div className="breadcrumb"><Link href="/">Home</Link><span className="sep">›</span><span>Validators</span></div>
        <div className="page-head">
          <div>
            <h1 className="page-title">Validators</h1>
            <p className="page-sub">Registered validators and their reward status.</p>
          </div>
        </div>

        <section className="card">
          <div className="card-head">All Validators ({validators.length})</div>
          <table className="tbl">
            <thead><tr><th>Address</th><th>Owner</th><th>Stake</th><th>Cumulative Rewards</th><th>Status</th><th>Missed Blocks</th></tr></thead>
            <tbody>
              {validators.length === 0 ? (
                <tr><td className="empty" colSpan={6}>No validators registered</td></tr>
              ) : validators.map((v) => (
                <tr key={v.id}>
                  <Cell label="Address"><Link href={`/address/${v.id}`}>{v.id}</Link></Cell>
                  <Cell label="Owner">{v.owner ? <Link href={`/address/${v.owner}`}>{shortAddress(v.owner)}</Link> : "—"}</Cell>
                  <Cell label="Stake">{formatQtx(v.stake)} QTX</Cell>
                  <Cell label="Cumulative Rewards">{formatQtx(v.cumulativeRewards ?? "0")} QTX</Cell>
                  <Cell label="Status">{validatorBadge(v)}</Cell>
                  <Cell label="Missed Blocks">{v.missedBlocks}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </PageChrome>
    );
  } catch (e) {
    return (
      <PageChrome active="validators">
        <div className="err">Failed to load validators: {e instanceof Error ? e.message : "unknown error"}</div>
      </PageChrome>
    );
  }
}
