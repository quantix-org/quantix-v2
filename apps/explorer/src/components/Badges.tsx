export function statusBadge(ok?: boolean) {
  return <span className={`badge ${ok ? "b-green" : "b-gray"}`}>{ok ? "committed" : "pending"}</span>;
}

export function validatorBadge(v: { active: boolean; slashed?: boolean }) {
  if (v.slashed) return <span className="badge b-red">slashed</span>;
  if (v.active) return <span className="badge b-green">active</span>;
  return <span className="badge b-gray">pending</span>;
}

export function txTypeBadge(type: string) {
  const cls: Record<string, string> = {
    transfer: "b-blue",
    stake: "b-orange",
    unstake: "b-yellow",
    validator_register: "b-purple",
    validator_unregister: "b-gray",
    contract_deploy: "b-green",
    contract_call: "b-purple",
  };
  return <span className={`badge ${cls[type] ?? "b-gray"}`}>{type}</span>;
}
