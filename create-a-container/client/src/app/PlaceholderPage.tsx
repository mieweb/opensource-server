import { useLocation } from 'react-router';

export function PlaceholderPage({ title }: { title: string }) {
  const { pathname } = useLocation();
  return (
    <section className="space-y-2">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-sm opacity-70">Route: <code>{pathname}</code></p>
      <p className="text-sm opacity-70">Phase 1 scaffolding placeholder. Implementation lands in Phase 4.</p>
    </section>
  );
}
