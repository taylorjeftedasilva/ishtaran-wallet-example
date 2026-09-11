import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: keyof typeof GAP;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: boolean;
  children: ReactNode;
}

const GAP = {
  0: '0',
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
};

/** Vertical flex layout -- the default composition primitive for this design system. */
export function Stack({ gap = 3, align, justify, wrap, style, children, ...rest }: StackProps) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: GAP[gap], alignItems: align, justifyContent: justify, flexWrap: wrap ? 'wrap' : undefined, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Horizontal flex layout -- same gap scale as Stack. */
export function Row({ gap = 3, align = 'center', justify, wrap, style, children, ...rest }: StackProps) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'row', gap: GAP[gap], alignItems: align, justifyContent: justify, flexWrap: wrap ? 'wrap' : undefined, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
