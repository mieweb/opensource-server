import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

export interface FormPageHeaderProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  description?: ReactNode;
  backTo?: { label: string; to: string };
}

export function FormPageHeader({ icon, title, subtitle, description, backTo }: FormPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      {backTo && (
        <Link
          to={backTo.to}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backTo.label}
        </Link>
      )}
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {icon && (
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
              aria-hidden="true"
            >
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </header>
    </div>
  );
}
