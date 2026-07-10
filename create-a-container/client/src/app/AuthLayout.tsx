import { Outlet } from 'react-router';
import { Boxes, ShieldCheck, Zap, Activity } from 'lucide-react';

const features = [
  {
    icon: Boxes,
    title: 'Provision on demand',
    body: 'Spin up isolated containers across your fleet in seconds.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure by default',
    body: 'Push-approved sign-ins, scoped API keys, audited every step.',
  },
  {
    icon: Activity,
    title: 'Live visibility',
    body: 'Monitor nodes, jobs, and services from a single console.',
  },
];

export function AuthLayout() {
  const year = new Date().getFullYear();
  return (
    <div className="grid min-h-full bg-[var(--mieweb-background,#ffffff)] lg:grid-cols-2">
      {/* Brand / marketing panel */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-[var(--mieweb-primary-700,#1786b3)] text-white lg:flex lg:flex-col lg:items-start lg:justify-center lg:p-12"
      >
        {/* Decorative gradient blobs */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.18), transparent 45%),' +
              'radial-gradient(circle at 85% 15%, rgba(39,170,225,0.55), transparent 50%),' +
              'radial-gradient(circle at 70% 90%, rgba(8,98,133,0.6), transparent 55%)',
          }}
        />

        <div className="absolute left-12 top-12 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
            <Zap className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Container Manager</span>
        </div>

        <div className="relative max-w-md space-y-8">
          <div>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Run containers the way modern teams ship software.
            </h2>
            <p className="mt-4 text-base text-white/80">
              A unified control plane for provisioning, securing, and operating containerized
              workloads across your infrastructure.
            </p>
          </div>

          <ul className="space-y-5">
            {features.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
                  <Icon className="size-4.5" />
                </span>
                <div>
                  <p className="font-medium text-white">{title}</p>
                  <p className="text-sm text-white/75">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="absolute bottom-12 left-12 text-xs text-white/60">
          &copy; {year} MIE, Inc. &middot; All rights reserved.
        </p>
      </aside>

      {/* Form panel */}
      <main className="relative flex items-center justify-center px-6 py-10 sm:px-10">
        {/* Mobile brand header */}
        <div className="absolute left-1/2 top-8 flex -translate-x-1/2 items-center gap-2 text-[var(--mieweb-primary-700,#1786b3)] lg:hidden">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--mieweb-primary-50,#e6f7fc)] ring-1 ring-[var(--mieweb-primary-200,#80d5f0)]">
            <Zap className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">Container Manager</span>
        </div>

        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
