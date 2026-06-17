import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { TokenUsageEvent } from "@app/core";
import { call } from "../../lib/ipc/client.js";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

type Bucket = "hour" | "day" | "week";
const STEP_MS: Record<Bucket, number> = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 };
const SPAN: Record<Bucket, number> = { hour: 48 * 3_600_000, day: 30 * 86_400_000, week: 26 * 7 * 86_400_000 };

const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`);

function label(t: number, bucket: Bucket): string {
  const d = new Date(t);
  if (bucket === "hour") return `${String(d.getHours()).padStart(2, "0")}:00`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AnalyticsView({ onClose }: { onClose: () => void }) {
  const [bucket, setBucket] = useState<Bucket>("day");
  const [events, setEvents] = useState<TokenUsageEvent[]>([]);
  const [windowEnd, setWindowEnd] = useState(0); // set when data is fetched (keeps render pure)

  useEffect(() => {
    const end = Date.now();
    setWindowEnd(end);
    call("analytics:tokens", { sinceMs: end - SPAN[bucket] }).then((e) => setEvents(e ?? [])).catch(() => {});
  }, [bucket]);

  const { data, totalSession, totalApp } = useMemo(() => {
    const step = STEP_MS[bucket];
    const now = windowEnd;
    const start = now - SPAN[bucket];
    const buckets = new Map<number, { session: number; app: number }>();
    for (let t = Math.floor(start / step) * step; t <= now; t += step) buckets.set(t, { session: 0, app: 0 });
    let ts = 0, ta = 0;
    for (const e of events) {
      if (e.source === "session") ts += e.tokens; else ta += e.tokens;
      const b = buckets.get(Math.floor(e.ts / step) * step);
      if (!b) continue;
      if (e.source === "session") b.session += e.tokens; else b.app += e.tokens;
    }
    const data = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ label: label(t, bucket), sessions: v.session, app: v.app }));
    return { data, totalSession: ts, totalApp: ta };
  }, [events, bucket, windowEnd]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-3 py-3">
        <button onClick={onClose} className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Home
        </button>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-[13.5px] text-foreground">Token usage</span>
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
          {(["hour", "day", "week"] as Bucket[]).map((b) => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={`rounded px-2 py-1 font-mono text-[10.5px] ${bucket === b ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              per {b}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-5 flex gap-8">
          <Stat label="Session tokens" value={totalSession} color="#7ec699" />
          <Stat label="App tokens" value={totalApp} color="#d4a574" />
          <Stat label="Total" value={totalSession + totalApp} color="#9aa0a6" />
        </div>

        <div className="h-[380px] rounded-lg border border-border bg-card p-4">
          {events.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
              No token usage recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9aa0a6" }} interval="preserveStartEnd" stroke="#3a3a3e" />
                <YAxis tick={{ fontSize: 10, fill: "#9aa0a6" }} tickFormatter={compact} stroke="#3a3a3e" width={44} />
                <Tooltip
                  formatter={(v: number, n) => [`${v.toLocaleString()} tokens`, n]}
                  contentStyle={{ background: "#16171b", border: "1px solid #2a2a2e", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#cfcfcf" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar name="Sessions" dataKey="sessions" stackId="a" fill="#7ec699" radius={[0, 0, 0, 0]} />
                <Bar name="App" dataKey="app" stackId="a" fill="#d4a574" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Session tokens are consumed by agent runs; app tokens by background operations (titles, branch names, project synthesis, suggestions).
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} /> {label}
      </div>
      <div className="mt-1 font-display text-[24px] text-foreground">{value.toLocaleString()}</div>
    </div>
  );
}
