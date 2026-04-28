import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-violet-500 text-white shadow-[0_8px_20px_-12px_rgba(139,92,246,0.75)] hover:bg-violet-400',
        secondary: 'border border-slate-600 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800',
        outline: 'border border-slate-600 bg-transparent text-slate-100 hover:bg-slate-900/60',
        ghost: 'text-slate-200 hover:bg-slate-900/60',
        destructive: 'bg-rose-500 text-white hover:bg-rose-400',
      },
      size: {
        default: 'h-9 px-4 py-1.5',
        sm: 'h-8 px-2.5 text-sm',
        lg: 'h-9 px-5 text-sm',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
));
Button.displayName = 'Button';

export { Button, buttonVariants };
