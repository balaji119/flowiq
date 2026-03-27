import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide',
  {
    variants: {
      variant: {
        default: 'border-violet-400/40 bg-violet-500/15 text-violet-200',
        secondary: 'border-slate-600 bg-slate-800 text-slate-200',
        success: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
        destructive: 'border-rose-400/40 bg-rose-500/15 text-rose-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
