import { useEffect, useState } from "react";
import type { Health } from "../shared/api";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth, () => setError(true));
  }, []);

  return (
    <header className="app-header">
      <strong>akapen</strong>
      <span>
        {error
          ? "Cannot reach the akapen server."
          : (health?.root ?? "Connecting…")}
      </span>
    </header>
  );
}
