import { MutableRefObject, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@flowiq/ui';

export type CostNavigationGuard = MutableRefObject<((action: () => void) => void) | null>;

export function useCostSettingsSave({ dirty, saving, loading, save, discard, navigationGuard, name, error }: {
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
  navigationGuard: CostNavigationGuard;
  name: string;
  error: string;
}) {
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  function confirmNavigation(action: () => void) {
    if (saving) return;
    if (!dirty) return action();
    setPendingAction(() => action);
  }
  useEffect(() => {
    navigationGuard.current = confirmNavigation;
    return () => { navigationGuard.current = null; };
  });
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const controls = <>
    <div className="flex justify-end">
      <Button className="h-10 min-w-[110px] btn-theme-primary" disabled={!dirty || saving || loading} onClick={() => void save()} type="button">
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
    <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open && !saving) setPendingAction(null); }}>
      <DialogContent>
        <DialogHeader className="pb-1">
          <DialogTitle>Unsaved Changes</DialogTitle>
          <DialogDescription>You have unsaved changes in {name}. Leaving now will discard them.</DialogDescription>
        </DialogHeader>
        {error ? <div role="alert" className="text-sm text-rose-200">{error}</div> : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button disabled={saving} onClick={() => setPendingAction(null)} type="button" variant="ghost">Stay</Button>
          <Button disabled={saving} onClick={() => { const action = pendingAction; setPendingAction(null); discard(); action?.(); }} type="button" variant="secondary">Discard</Button>
          <Button disabled={saving || loading} onClick={() => void (async () => {
            const action = pendingAction;
            if (!await save()) return;
            setPendingAction(null);
            action?.();
          })()} type="button">{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
  return { controls, confirmNavigation };
}
