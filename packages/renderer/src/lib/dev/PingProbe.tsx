import { useState } from "react";
import { call } from "../ipc/client.js";

export function PingProbe() {
  const [result, setResult] = useState<{ value: string; ts: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePing = async () => {
    setLoading(true);
    try {
      const res = await call("app:ping", { value: "hi" });
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", bottom: "10px", right: "10px", background: "#333", padding: "8px", borderRadius: "4px", zIndex: 9999 }}>
      <button onClick={handlePing} disabled={loading}>
        {loading ? "Pinging..." : "🏓 Ping Main"}
      </button>
      {result && (
        <div style={{ marginTop: "4px", fontSize: "12px" }}>
          {result.value} @ {new Date(result.ts).toISOString()}
        </div>
      )}
    </div>
  );
}
