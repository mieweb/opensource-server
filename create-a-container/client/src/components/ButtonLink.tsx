import { forwardRef, isValidElement, type ComponentPropsWithoutRef, type ComponentPropsWithRef, type ElementType, type ReactElement, type ReactNode } from 'react';
import { buttonVariants, cn } from '@mieweb/ui';

/**
 * Temporary local copy of @mieweb/ui's ButtonLink, pending release of
 * https://github.com/mieweb/ui/pull/307 — the implementation and API are
 * identical. Once the library ships it, replace this file's contents with:
 *
 *   export { ButtonLink, type ButtonLinkProps } from '@mieweb/ui';
 *
 * No call sites need to change.
 */

type ButtonVariantProps = NonNullable<Parameters<typeof buttonVariants>[0]>;

type ButtonLinkOwnProps = ButtonVariantProps & {
  /**
   * Element or component to render. Defaults to a plain anchor; pass a
   * client-side router's link component (react-router `Link`) to keep SPA
   * navigation.
   */
  as?: ElementType;
  /** Optional icon element to render before the link text */
  leftIcon?: ReactElement | null;
  /** Optional icon element to render after the link text */
  rightIcon?: ReactElement | null;
};

export type ButtonLinkProps<T extends ElementType = 'a'> = ButtonLinkOwnProps & {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof ButtonLinkOwnProps>;

type ButtonLinkComponent = (<T extends ElementType = 'a'>(
  props: ButtonLinkProps<T> & { ref?: ComponentPropsWithRef<T>['ref'] },
) => ReactNode) & { displayName?: string };

/**
 * A navigation link styled exactly like Button. Renders a real link element,
 * so it keeps native link affordances — middle-click / Ctrl+click to open in
 * a new tab, copy link address, correct semantics for assistive technology.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink(
    { as, className, variant, size, fullWidth, leftIcon, rightIcon, children, ...props },
    ref,
  ) {
    const Comp: ElementType = as ?? 'a';
    const resolvedSize = size ?? 'md';
    return (
      <Comp
        data-slot="button"
        data-size={resolvedSize}
        className={cn(buttonVariants({ variant, size: resolvedSize, fullWidth }), className)}
        ref={ref}
        {...props}
      >
        {isValidElement(leftIcon) && <span className="shrink-0">{leftIcon}</span>}
        {children}
        {isValidElement(rightIcon) && <span className="shrink-0">{rightIcon}</span>}
      </Comp>
    );
  },
) as unknown as ButtonLinkComponent;

ButtonLink.displayName = 'ButtonLink';
