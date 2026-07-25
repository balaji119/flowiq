import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Save, Shield, Trash2 } from 'lucide-react';
import { MaterialRecord, TenantRecord } from '@flowiq/shared';
import { Button, Card, CardContent, CardDescription, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from '@flowiq/ui';
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
import { useAuth } from '../context/AuthContext';
import { fetchMaterials, fetchTenants, replaceMaterials } from '../services/adminApi';

type MaterialsSettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
} & Omit<AdminWorkspaceHandlers, 'onBack' | 'onOpenMaterials'>;

type MaterialDraft = { id: string; name: string; isDefault: boolean };

function newMaterial(isDefault: boolean): MaterialDraft {
  return { id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: '', isDefault };
}

function toDrafts(records: MaterialRecord[]): MaterialDraft[] {
  return records.map(({ id, name, isDefault }) => ({ id, name, isDefault }));
}

function snapshot(rows: MaterialDraft[]) {
  return JSON.stringify(rows.map((row) => [row.id, row.name.trim(), row.isDefault]));
}

export function MaterialsSettingsScreen({
  onBack,
  onOpenMappings,
  onOpenMaterialMapping,
  onOpenPrintingCosts,
  onOpenSettings,
  onOpenSheetSizeSettings,
  onOpenShippingCosts,
  onOpenShippingSettings,
  onOpenTenants,
  onOpenUsers,
  tenantId,
}: MaterialsSettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('[]');
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<(() => void) | null>(null);

  const canAccessManagement = session?.user.role === 'admin' || session?.user.role === 'super_admin';
  const canSwitchTenant = session?.user.role === 'super_admin';
  const effectiveTenantId = canSwitchTenant ? selectedTenantId ?? tenantId ?? undefined : session?.user.tenantId ?? undefined;
  const hasUnsavedChanges = useMemo(() => snapshot(materials) !== savedSnapshot, [materials, savedSnapshot]);

  useEffect(() => {
    if (!canSwitchTenant) return;
    let active = true;
    void fetchTenants().then((response) => {
      if (!active) return;
      setTenants(response.tenants);
      setSelectedTenantId((current) => current && response.tenants.some((tenant) => tenant.id === current) ? current : response.tenants[0]?.id ?? null);
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load tenants');
    });
    return () => { active = false; };
  }, [canSwitchTenant]);

  useEffect(() => {
    let active = true;
    if (!effectiveTenantId) {
      setMaterials([]);
      setSavedSnapshot('[]');
      setLoading(false);
      return;
    }
    async function loadMaterials() {
      try {
        setLoading(true);
        setError('');
        setNotice('');
        const response = await fetchMaterials(effectiveTenantId);
        if (!active) return;
        const next = toDrafts(response.materials);
        setMaterials(next);
        setSavedSnapshot(snapshot(next));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load materials');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadMaterials();
    return () => { active = false; };
  }, [effectiveTenantId]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function confirmDiscardChanges(action: () => void) {
    if (!hasUnsavedChanges) return action();
    setPendingNavigationAction(() => action);
    setDiscardDialogOpen(true);
  }

  async function handleSave() {
    if (!effectiveTenantId) {
      setError('Select a tenant before saving materials');
      return false;
    }
    const normalized = materials.map((row) => ({ ...row, name: row.name.trim() }));
    if (normalized.some((row) => !row.name)) {
      setError('Material name is required');
      return false;
    }
    if (new Set(normalized.map((row) => row.name.toLocaleLowerCase())).size !== normalized.length) {
      setError('Material names must be unique');
      return false;
    }
    if (normalized.length > 0 && normalized.filter((row) => row.isDefault).length !== 1) {
      setError('Select one default material');
      return false;
    }
    try {
      setSaving(true);
      setError('');
      setNotice('');
      const response = await replaceMaterials({ materials: normalized.map((row) => ({ id: row.id.startsWith('new-') ? undefined : row.id, name: row.name, isDefault: row.isDefault })) }, effectiveTenantId);
      const next = toDrafts(response.materials);
      setMaterials(next);
      setSavedSnapshot(snapshot(next));
      setNotice('Materials saved.');
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save materials');
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!canAccessManagement) {
    return <main className="dense-main mx-auto flex min-h-0 w-full max-w-3xl items-center px-6 py-8"><Card className="w-full"><CardContent className="space-y-4 p-8 text-center"><Shield className="mx-auto h-8 w-8 text-violet-300" /><CardTitle>Access restricted</CardTitle><CardDescription>Only admin and super admin users can manage materials.</CardDescription><Button onClick={onBack} variant="secondary">Back</Button></CardContent></Card></main>;
  }

  return (
    <AdminWorkspaceShell
      activeSection="materials"
      canAccessManagement
      canAccessShippingCosts={session?.user.role === 'super_admin'}
      canAccessPrintingCosts={session?.user.role === 'super_admin'}
      pageTitle="Materials"
      onBack={() => confirmDiscardChanges(onBack)}
      onOpenLanding={() => confirmDiscardChanges(onBack)}
      onOpenMappings={onOpenMappings ? () => confirmDiscardChanges(onOpenMappings) : undefined}
      onOpenMaterialMapping={onOpenMaterialMapping ? () => confirmDiscardChanges(onOpenMaterialMapping) : undefined}
      onOpenMaterials={() => {}}
      onOpenPrintingCosts={onOpenPrintingCosts ? () => confirmDiscardChanges(onOpenPrintingCosts) : undefined}
      onOpenSettings={onOpenSettings ? () => confirmDiscardChanges(onOpenSettings) : undefined}
      onOpenSheetSizeSettings={onOpenSheetSizeSettings ? () => confirmDiscardChanges(onOpenSheetSizeSettings) : undefined}
      onOpenShippingCosts={onOpenShippingCosts ? () => confirmDiscardChanges(onOpenShippingCosts) : undefined}
      onOpenShippingSettings={onOpenShippingSettings ? () => confirmDiscardChanges(onOpenShippingSettings) : undefined}
      onOpenTenants={onOpenTenants ? () => confirmDiscardChanges(onOpenTenants) : undefined}
      onOpenUsers={onOpenUsers ? () => confirmDiscardChanges(onOpenUsers) : undefined}
    >
      <main className="dense-main flex min-h-0 w-full flex-col gap-6">
        {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
        {notice ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}
        {canSwitchTenant ? <section className="flex flex-wrap gap-4"><div className="w-full sm:w-[320px]"><div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800"><span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Tenant</span><select id="materials-tenant" className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70" value={selectedTenantId ?? ''} onChange={(event) => confirmDiscardChanges(() => setSelectedTenantId(event.target.value || null))}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></div></div></section> : null}
        <section className="w-full max-w-4xl space-y-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
              <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
                <Label className="text-sm font-semibold text-slate-100">Materials</Label>
                <Button className="h-8 px-3" onClick={() => setMaterials((current) => [...current, newMaterial(current.length === 0)])} size="sm" type="button" variant="secondary">
                  <Plus className="h-4 w-4" />Add Material
                </Button>
              </div>
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup><col /><col className="w-[120px]" /><col className="w-[110px]" /></colgroup>
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-4 py-2 text-left">Material Name</th>
                    <th className="border border-slate-700 px-4 py-2 text-center">Default</th>
                    <th className="border border-slate-700 px-4 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.length === 0 ? (
                    <tr><td className="border border-slate-700 px-4 py-8 text-center text-slate-400" colSpan={3}>No materials added yet.</td></tr>
                  ) : materials.map((row) => (
                    <tr key={row.id} className="bg-slate-900/35">
                      <td className="border border-slate-700 px-3 py-2">
                        <Input aria-label="Material Name" maxLength={200} onChange={(event) => setMaterials((current) => current.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))} placeholder="Enter material name" value={row.name} />
                      </td>
                      <td className="border border-slate-700 px-3 py-2 text-center">
                        <input
                          aria-label={`Set ${row.name || 'material'} as default`}
                          checked={row.isDefault}
                          className="h-4 w-4 cursor-pointer accent-violet-500"
                          name="default-material"
                          onChange={() => setMaterials((current) => current.map((item) => ({ ...item, isDefault: item.id === row.id })))}
                          type="radio"
                        />
                      </td>
                      <td className="border border-slate-700 px-3 py-2 text-center">
                        <Button
                          aria-label={`Delete ${row.name || 'material'}`}
                          className="h-8 w-8 rounded-md border-0 p-0 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                          onClick={() => setMaterials((current) => {
                            const remaining = current.filter((item) => item.id !== row.id);
                            if (row.isDefault && remaining.length > 0) remaining[0] = { ...remaining[0], isDefault: true };
                            return remaining;
                          })}
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading ? <div className="flex justify-end"><Button className="h-9 min-w-[132px] rounded-md px-3 text-sm font-semibold btn-theme-primary" disabled={!effectiveTenantId || saving} onClick={() => void handleSave()} type="button">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Saving...' : 'Save Changes'}</Button></div> : null}
        </section>
      </main>
      <Dialog open={discardDialogOpen} onOpenChange={(open) => { setDiscardDialogOpen(open); if (!open) setPendingNavigationAction(null); }}><DialogContent><DialogHeader className="pb-1"><DialogTitle>Unsaved Changes</DialogTitle><DialogDescription>You have unsaved changes in Materials. Leaving now will discard them.</DialogDescription></DialogHeader><div className="flex justify-end gap-3 pt-2"><Button onClick={() => { setDiscardDialogOpen(false); setPendingNavigationAction(null); }} type="button" variant="ghost">Stay</Button><Button onClick={() => { const action = pendingNavigationAction; setDiscardDialogOpen(false); setPendingNavigationAction(null); action?.(); }} type="button" variant="secondary">Discard</Button><Button disabled={saving || loading} onClick={() => void (async () => { const action = pendingNavigationAction; if (!await handleSave()) return; setDiscardDialogOpen(false); setPendingNavigationAction(null); action?.(); })()} type="button">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{saving ? 'Saving...' : 'Save'}</Button></div></DialogContent></Dialog>
    </AdminWorkspaceShell>
  );
}
