import type { ReactNode } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@mieweb/ui';
import { FormPageHeader, type FormPageHeaderProps } from './FormPageHeader';

interface FormPageLayoutProps extends FormPageHeaderProps {
  /** Optional supplementary content (tips, docs links) shown beneath the card. */
  aside?: ReactNode;
  /** Card heading shown above the form fields. */
  cardTitle?: string;
  /** Constrain the inner content width. Defaults to 2xl. */
  maxWidth?: 'xl' | '2xl' | '3xl' | '4xl';
  /** Form body (fields). */
  children: ReactNode;
  /** Action row rendered in the card footer (typically Cancel + Submit buttons). */
  actions: ReactNode;
}

const MAX_WIDTH_CLASS = {
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
} as const;

/**
 * Centered single-column form scaffold for create/edit pages.
 * Renders a polished hero, a flush-footer card, and optional supporting content beneath.
 */
export function FormPageLayout({
  icon,
  title,
  subtitle,
  description,
  aside,
  backTo,
  cardTitle,
  maxWidth = '2xl',
  children,
  actions,
}: FormPageLayoutProps) {
  return (
    <div className={`mx-auto flex w-full flex-col gap-6 ${MAX_WIDTH_CLASS[maxWidth]}`}>
      <FormPageHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        description={description}
        backTo={backTo}
      />

      <Card padding="none" className="overflow-hidden shadow-sm">
        {cardTitle && (
          <CardHeader className="border-b border-border bg-muted/30 px-6 py-4">
            <CardTitle className="text-base">{cardTitle}</CardTitle>
          </CardHeader>
        )}
        <CardContent className="grid gap-4 px-6 py-6">{children}</CardContent>
        <CardFooter className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3">
          {actions}
        </CardFooter>
      </Card>

      {aside && <div>{aside}</div>}
    </div>
  );
}
