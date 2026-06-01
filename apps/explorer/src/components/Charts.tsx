type Point = {
  label: string;
  value: number;
};

function clampNum(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return n;
}

function buildPath(values: number[], width: number, height: number, pad: number): string {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  return values
    .map((v, i) => {
      const x = pad + (values.length === 1 ? innerW / 2 : (i * innerW) / (values.length - 1));
      const yNorm = span === 0 ? 0.5 : (v - min) / span;
      const y = pad + innerH - yNorm * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function ChartFrame({ children }: { children: React.ReactNode }) {
  return <div className="chart-card">{children}</div>;
}

export function SparklineChart({
  title,
  subtitle,
  points,
  colorClass = "spark-a",
}: {
  title: string;
  subtitle: string;
  points: Point[];
  colorClass?: "spark-a" | "spark-b";
}) {
  const width = 520;
  const height = 180;
  const pad = 16;
  const values = points.map((p) => clampNum(p.value));
  const path = buildPath(values, width, height, pad);
  const latest = values.length ? values[values.length - 1] : 0;

  return (
    <ChartFrame>
      <div className="chart-head">
        <div>
          <div className="chart-title">{title}</div>
          <div className="chart-sub">{subtitle}</div>
        </div>
        <div className="chart-kpi">{latest.toLocaleString()}</div>
      </div>
      <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <path className="spark-grid" d={`M${pad} ${height - pad} L${width - pad} ${height - pad}`} />
        {path ? <path className={`spark-line ${colorClass}`} d={path} /> : null}
      </svg>
      <div className="chart-foot">
        <span>{points[0]?.label ?? "-"}</span>
        <span>{points[points.length - 1]?.label ?? "-"}</span>
      </div>
    </ChartFrame>
  );
}

export function DualSparklineChart({
  title,
  subtitle,
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  title: string;
  subtitle: string;
  left: Point[];
  right: Point[];
  leftLabel: string;
  rightLabel: string;
}) {
  const width = 520;
  const height = 180;
  const pad = 16;
  const leftVals = left.map((p) => clampNum(p.value));
  const rightVals = right.map((p) => clampNum(p.value));
  const merged = [...leftVals, ...rightVals];
  const min = merged.length ? Math.min(...merged) : 0;
  const max = merged.length ? Math.max(...merged) : 1;
  const span = max - min;

  const buildScaled = (vals: number[]) => {
    if (!vals.length) return "";
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    return vals
      .map((v, i) => {
        const x = pad + (vals.length === 1 ? innerW / 2 : (i * innerW) / (vals.length - 1));
        const yNorm = span === 0 ? 0.5 : (v - min) / span;
        const y = pad + innerH - yNorm * innerH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const leftPath = buildScaled(leftVals);
  const rightPath = buildScaled(rightVals);

  return (
    <ChartFrame>
      <div className="chart-head">
        <div>
          <div className="chart-title">{title}</div>
          <div className="chart-sub">{subtitle}</div>
        </div>
      </div>
      <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <path className="spark-grid" d={`M${pad} ${height - pad} L${width - pad} ${height - pad}`} />
        {leftPath ? <path className="spark-line spark-a" d={leftPath} /> : null}
        {rightPath ? <path className="spark-line spark-b" d={rightPath} /> : null}
      </svg>
      <div className="legend-row">
        <span><i className="legend-dot spark-a-bg" />{leftLabel}</span>
        <span><i className="legend-dot spark-b-bg" />{rightLabel}</span>
      </div>
    </ChartFrame>
  );
}

export function HorizontalBars({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: Point[];
}) {
  const max = items.length ? Math.max(...items.map((i) => clampNum(i.value))) : 1;

  return (
    <ChartFrame>
      <div className="chart-head">
        <div>
          <div className="chart-title">{title}</div>
          <div className="chart-sub">{subtitle}</div>
        </div>
      </div>
      <div className="bar-list">
        {items.length === 0 ? <div className="small-muted">No data</div> : null}
        {items.map((item) => {
          const val = clampNum(item.value);
          const pct = max === 0 ? 0 : (val / max) * 100;
          return (
            <div className="bar-item" key={item.label}>
              <div className="bar-label">{item.label}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${pct.toFixed(2)}%` }} />
              </div>
              <div className="bar-val">{val.toLocaleString()}</div>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}
