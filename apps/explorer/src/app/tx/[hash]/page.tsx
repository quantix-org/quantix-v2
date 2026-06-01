import Link from "next/link";
import PageChrome from "@/components/PageChrome";
import KvRow from "@/components/KvRow";
import CopyButton from "@/components/CopyButton";
import { statusBadge, txTypeBadge } from "@/components/Badges";
import { formatQtx, formatTime } from "@/lib/format";
import { getReceipt, getTransaction } from "@/lib/rpc";

export const dynamic = "force-dynamic";

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  try {
    const tx = await getTransaction(hash);
    const needReceipt = tx.type === "contract_deploy" || tx.type === "contract_call";
    const receipt = needReceipt ? await getReceipt(hash).catch(() => null) : null;

    return (
      <PageChrome>
        <div className="breadcrumb"><Link href="/">Home</Link><span className="sep">›</span><span>Transaction</span></div>
        <section className="card">
          <div className="card-head">Transaction Detail {tx.status === "committed" ? statusBadge(true) : statusBadge(false)}</div>
          <KvRow label="Tx Hash" value={<span>{tx.hash} <CopyButton value={tx.hash} /></span>} />
          <KvRow label="Status" value={tx.status === "committed" ? statusBadge(true) : statusBadge(false)} />
          <KvRow label="Block" value={tx.blockHeight != null ? <Link href={`/block/${tx.blockHeight}`}>#{tx.blockHeight}</Link> : "—"} />
          <KvRow label="Block Hash" value={tx.blockHash ? <span>{tx.blockHash} <CopyButton value={tx.blockHash} /></span> : "—"} />
          <KvRow label="Type" value={txTypeBadge(tx.type)} />
          <KvRow label="From" value={<span><Link href={`/address/${tx.from}`}>{tx.from}</Link> <CopyButton value={tx.from} /></span>} />
          {tx.to ? <KvRow label="To" value={<span><Link href={`/address/${tx.to}`}>{tx.to}</Link> <CopyButton value={tx.to} /></span>} /> : null}
          {tx.validatorId ? <KvRow label="Validator ID" value={<span><Link href={`/address/${tx.validatorId}`}>{tx.validatorId}</Link> <CopyButton value={tx.validatorId} /></span>} /> : null}
          {tx.contractAddress ? <KvRow label="Contract" value={<span><Link href={`/address/${tx.contractAddress}`}>{tx.contractAddress}</Link> <CopyButton value={tx.contractAddress} /></span>} /> : null}
          {tx.method ? <KvRow label="Method" value={tx.method} /> : null}
          <KvRow label="Timestamp" value={formatTime(tx.timestamp)} />
          <KvRow label="Amount" value={`${formatQtx(tx.amount)} QTX`} />
          <KvRow label="Fee" value={`${formatQtx(tx.fee)} QTX`} />
          <KvRow label="Nonce" value={String(tx.nonce)} />
          {receipt ? <KvRow label="Receipt Status" value={receipt.success ? <span className="badge b-green">success</span> : <span className="badge b-red">failed</span>} /> : null}
          {receipt ? <KvRow label="Gas Used" value={String(receipt.gasUsed)} /> : null}
          {receipt?.error ? <KvRow label="Execution Error" value={<span style={{ color: "var(--red)" }}>{receipt.error}</span>} /> : null}
        </section>
      </PageChrome>
    );
  } catch (e) {
    return (
      <PageChrome>
        <div className="err">Failed to load transaction {hash}: {e instanceof Error ? e.message : "unknown error"}</div>
      </PageChrome>
    );
  }
}
