import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Save, Shield, Trash2 } from 'lucide-react';
import { SheetNameOverrides, TenantRecord } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@flowiq/ui';
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
import { useAuth } from '../context/AuthContext';
import { fetchAdminSheetNameOverrides, fetchTenants, upsertAdminSheetNameOverrides } from '../services/adminApi';
import { defaultSheetNamePresetOverrides, sanitizeSheetNameOverrides, sheetNamePresetEntries, toCanonicalSheetNameKey } from '../services/sheetNameOverrides';

type SettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
} & Omit<AdminWorkspaceHandlers, 'onBack' | 'onOpenSettings'>;

type CustomOverrideRow = {
  id: string;
  source: string;
  name: string;
};

function createCustomRow(source = '', name = ''): CustomOverrideRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source,
    name,
  };
}

export function SettingsScreen({
  onBack,
  onOpenMappings,
  onOpenPrintingCosts,
  onOpenShippingCosts,
  onOpenShippingSettings,
  onOpenUsers,
  tenantId,
}: SettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(session?.user.tenantId ?? null);
  const [presetOverrides, setPresetOverrides] = useState<Record<string, string>>({});
  const [customOverrides, setCustomOverrides] = useState<CustomOverrideRow[]>([]);

  const canSwitchTenant = session?.user.role === 'super_admin' && !tenantId;
  const effectiveTenantId = tenantId ?? (canSwitchTenant ? selectedTenantId ?? undefined : session?.user.tenantId ?? undefined);
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null, [selectedTenantId, tenants]);

  useEffect(() => {
    let active = true;
    async function loadBaseData() {
      try {
        setLoading(true);
        setError('');
        if (canSwitchTenant) {
          const tenantResponse = await fetchTenants();
          if (!active) return;
          setTenants(tenantResponse.tenants);
          if (!selectedTenantId && tenantResponse.tenants[0]) {
            setSelectedTenantId(tenantResponse.tenants[0].id);
          }
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load tenants');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadBaseData();
    return () => {
      active = false;
    };
  }, [canSwitchTenant, selectedTenantId]);

  useEffect(() => {
    let active = true;
    if (!effectiveTenantId) {
      setPresetOverrides({});
      setCustomOverrides([]);
      setLoading(false);
      return;
    }

    async function loadSettings() {
      try {
        setLoading(true);
        setError('');
        const response = await fetchAdminSheetNameOverrides(effectiveTenantId);
        if (!active) return;
        const normalized = sanitizeSheetNameOverrides(response.settings.overrides);
        const nextPreset: Record<string, string> = {};
        sheetNamePresetEntries.forEach((entry) => {
          nextPreset[entry.key] = normalized[entry.key] || defaultSheetNamePresetOverrides[entry.key] || '';
        });
        setPresetOverrides(nextPreset);

        const presetKeys = new Set(sheetNamePresetEntries.map((entry) => entry.key));
        const nextCustom = Object.entries(normalized)
          .filter(([key]) => !presetKeys.has(key))
          .map(([key, value]) => createCustomRow(key, value))
          .sort((left, right) => left.source.localeCompare(right.source));
        setCustomOverrides(nextCustom);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load settings');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSettings();
    return () => {
      active = false;
    };
  }, [effectiveTenantId]);

  async function handleSave() {
    if (!effectiveTenantId) {
      setError('Select a tenant before saving settings');
      return;
    }

    const merged: SheetNameOverrides = {};
    sheetNamePresetEntries.forEach((entry) => {
      const nextValue = (presetOverrides[entry.key] || '').trim();
      if (nextValue) {
        merged[entry.key] = nextValue;
      }
    });
    customOverrides.forEach((row) => {
      const sourceKey = toCanonicalSheetNameKey(row.source);
      const nextValue = row.name.trim();
      if (!sourceKey || !nextValue) return;
      merged[sourceKey] = nextValue;
    });

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await upsertAdminSheetNameOverrides({ overrides: merged }, effectiveTenantId);
      const normalized = sanitizeSheetNameOverrides(response.settings.overrides);

      const nextPreset: Record<string, string> = {};
      sheetNamePresetEntries.forEach((entry) => {
        nextPreset[entry.key] = normalized[entry.key] || defaultSheetNamePresetOverrides[entry.key] || '';
      });
      setPresetOverrides(nextPreset);

      const presetKeys = new Set(sheetNamePresetEntries.map((entry) => entry.key));
      const nextCustom = Object.entries(normalized)
        .filter(([key]) => !presetKeys.has(key))
        .map(([key, value]) => createCustomRow(key, value))
        .sort((left, right) => left.source.localeCompare(right.source));
      setCustomOverrides(nextCustom);
      setNotice('Sheet name overrides saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (session?.user.role === 'user') {
    return (
      <main className="dense-main mx-auto flex min-h-0 w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-amber-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>Only admin and super admin users can manage sheet name settings.</CardDescription>
            <Button onClick={onBack} variant="secondary">Back</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <AdminWorkspaceShell
      activeSection="settings"
      canAccessManagement
      canAccessShippingCosts={session?.user.role === 'super_admin'}
      canAccessPrintingCosts={session?.user.role === 'super_admin'}
      pageTitle="Settings"
      topBarActions={
        <Button className="h-9 min-w-[132px] rounded-md px-3 text-sm font-semibold" disabled={!effectiveTenantId || saving || loading} onClick={() => void handleSave()} type="button">
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-orange-300" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      }
      onBack={onBack}
      onOpenLanding={onBack}
      onOpenMappings={onOpenMappings}
      onOpenPrintingCosts={onOpenPrintingCosts}
      onOpenSettings={() => {}}
      onOpenShippingCosts={onOpenShippingCosts}
      onOpenShippingSettings={onOpenShippingSettings}
      onOpenUsers={onOpenUsers}
    >
      <main className="dense-main flex min-h-0 w-full flex-col gap-6">
        {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
        {notice ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

        {canSwitchTenant ? (
          <Card>
            <CardHeader className="p-5 pb-0">
              <CardTitle>Tenant scope</CardTitle>
              <CardDescription>Super admins can maintain sheet names for any tenant.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-slate-700 bg-slate-800/70 p-4">
                <p className="text-sm font-semibold text-white">
                  {selectedTenant ? `Managing settings for ${selectedTenant.name}` : 'No tenant selected'}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {selectedTenant ? selectedTenant.id : 'Select a tenant below. Settings are tenant-specific.'}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {tenants.map((tenant) => {
                  const active = selectedTenantId === tenant.id;
                  return (
                    <button
                      key={tenant.id}
                      className={active
                        ? 'rounded-md border border-orange-400 bg-orange-500/10 p-4 text-left shadow-[0_10px_25px_-12px_rgba(249,115,22,0.85)] transition'
                        : 'rounded-md border border-slate-700 bg-slate-800/80 p-4 text-left transition hover:border-slate-500 hover:bg-slate-800'}
                      onClick={() => setSelectedTenantId(tenant.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-bold text-white">{tenant.name}</p>
                          <p className="mt-2 break-all text-xs text-slate-400">{tenant.id}</p>
                        </div>
                        {active ? <Badge>Selected</Badge> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <section className="max-w-5xl space-y-5">
          <h2 className="text-lg font-semibold tracking-tight text-slate-100">Sheet Name Overrides</h2>
          {loading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-orange-300" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-slate-700 bg-slate-900/70">
                <table className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[260px]" />
                    <col className="w-[420px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                      <th className="border border-slate-700 px-4 py-3 text-left">Current Name</th>
                      <th className="border border-slate-700 px-4 py-3 text-left">Override Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetNamePresetEntries.map((entry) => (
                      <tr key={entry.key} className="border-t border-slate-700/70 bg-slate-800/70">
                        <td className="border border-slate-700 px-4 py-3 font-semibold text-white">{entry.label}</td>
                        <td className="border border-slate-700 px-4 py-3">
                          <Input
                            className="h-9 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-orange-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                            onChange={(event) =>
                              setPresetOverrides((current) => ({
                                ...current,
                                [entry.key]: event.target.value,
                              }))
                            }
                            placeholder={`Override for ${entry.label}`}
                            value={presetOverrides[entry.key] || ''}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold text-slate-100">Additional custom sizes</Label>
                  <Button
                    className="h-8 px-3"
                    onClick={() => setCustomOverrides((current) => [...current, createCustomRow()])}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <Plus className="h-4 w-4" />
                    Add Custom
                  </Button>
                </div>
                {customOverrides.length === 0 ? (
                  <p className="text-sm text-slate-400">No additional custom size mappings added.</p>
                ) : (
                  <div className="space-y-2">
                    {customOverrides.map((row) => (
                      <div key={row.id} className="grid gap-2 rounded-md border border-slate-700 bg-slate-800/60 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <Input
                          className="h-9 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-orange-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                          onChange={(event) =>
                            setCustomOverrides((current) => current.map((item) => (item.id === row.id ? { ...item, source: event.target.value } : item)))
                          }
                          placeholder="Current name (for example 3 Sheet)"
                          value={row.source}
                        />
                        <Input
                          className="h-9 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-orange-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                          onChange={(event) =>
                            setCustomOverrides((current) => current.map((item) => (item.id === row.id ? { ...item, name: event.target.value } : item)))
                          }
                          placeholder="Override name"
                          value={row.name}
                        />
                        <Button
                          className="h-9 px-3"
                          onClick={() => setCustomOverrides((current) => current.filter((item) => item.id !== row.id))}
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </AdminWorkspaceShell>
  );
}
