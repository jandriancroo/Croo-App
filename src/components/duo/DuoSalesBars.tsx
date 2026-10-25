import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

export interface DuoBarPoint { label: string; sales?: number; projected?: number }

/** Quiet bar chart under the Duo sales amount: hourly (Today), daily (Week) or weekly (Month). */
export function DuoSalesBars({ data }: { data: DuoBarPoint[] }) {
  if (!data.length) return null;
  const fmt = (v: number) => `$${Math.round(v).toLocaleString()}`;
  return <div className="duo-bars" aria-hidden>
    <ResponsiveContainer width="100%" height={132}>
      <BarChart data={data} margin={{ top: 6, right: 2, left: 2, bottom: 0 }} barCategoryGap="22%">
        <XAxis dataKey="label" tick={{ fill: 'var(--duo-muted)', fontSize: 10 }} interval="preserveStartEnd" axisLine={false} tickLine={false} minTickGap={14} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,.06)' }} formatter={(v: number, n: string) => [fmt(v), n]}
          contentStyle={{ background: 'var(--duo-page)', border: '1px solid var(--duo-line)', borderRadius: 10, fontSize: 12, color: 'var(--duo-ink)' }} />
        <Bar dataKey="projected" name="Projected" fill="var(--duo-line)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="sales" name="Actual" fill="var(--duo-sage)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
