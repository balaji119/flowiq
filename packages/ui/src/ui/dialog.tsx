import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;
let openDialogOverlayCount = 0;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => {
  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    openDialogOverlayCount += 1;
    document.body.classList.add('flowiq-dialog-open');
    return () => {
      openDialogOverlayCount = Math.max(0, openDialogOverlayCount - 1);
      if (openDialogOverlayCount === 0) {
        document.body.classList.remove('flowiq-dialog-open');
      }
    };
  }, []);

  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-[2147483646] backdrop-blur-2xl', className)}
      style={{
        backgroundColor: 'rgba(2, 6, 23, 0.55)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        ...style,
      }}
      {...props}
    />
  );
});
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-[2147483647] grid gap-3 overflow-y-auto rounded-md border border-slate-700 bg-slate-950 p-5 shadow-2xl shadow-slate-950/60',
        className,
      )}
      style={{
        position: 'fixed',
        left: '50%',
        top: '50%',
        width: 'min(calc(100vw - 2rem), 32rem)',
        maxHeight: '85vh',
        transform: 'translate(-50%, -50%)',
        ...style,
      }}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="rounded-full p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
        style={{ position: 'absolute', top: '1rem', right: '1rem' }}
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-xl font-black text-white', className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-slate-400', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose };
