import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Database, FileJson, LoaderCircle, Pencil, Plus, Shield, Trash2, Upload } from 'lucide-react';
import { CalculatorMappingInput, CalculatorMappingRecord, MarketMetadata, TenantRecord, createEmptyBreakdown, formatKeys } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import {
  createCalculatorMapping,
  deleteCalculatorMapping,
  fetchCalculatorMappings,
  fetchTenants,
  importCalculatorMappings,
  updateCalculatorMapping,
} from '../services/adminApi';

type MappingAdminScreenProps = {
  onBack: () => void;
};

function emptyForm(): CalculatorMappingInput {
  return {
    market: '',
    asset: '',
    label: '',
    state: '',
    quantities: createEmptyBreakdown(),
  };
}

function parseImportedMarkets(raw: unknown): MarketMetadata[] {
  if (!Array.isArray(raw)) {
    throw new Error('The JSON file must contain an array of markets');
  }
  return raw as MarketMetadata[];
}

export function MappingAdminScreen({ onBack }: MappingAdminScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(session?.user.tenantId ?? null);
  const [mappings, setMappings] = useState<CalculatorMappingRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CalculatorMappingInput>(emptyForm);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSwitchTenant = session?.user.role === 'super_admin';
  const effectiveTenantId = canSwitchTenant ? selectedTenantId ?? undefined : session?.user.tenantId ?? undefined;

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
      setMappings([]);
      setLoading(false);
      return;
    }

    async function loadMappings() {
      try {
        setLoading(true);
        setError('');
        const response = await fetchCalculatorMappings(effectiveTenantId);
        if (!active) return;
        setMappings(response.mappings);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load mappings');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadMappings();
    return () => {
      active = false;
    };
  }, [effectiveTenantId]);

  const groupedMappings = useMemo(() => {
    const grouped = new Map<string, CalculatorMappingRecord[]>();
    for (const mapping of mappings) {
      const current = grouped.get(mapping.market) ?? [];
      current.push(mapping);
      grouped.set(mapping.market, current);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [mappings]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function updateQuantity(key: (typeof formatKeys)[number], value: string) {
    setForm((current) => ({
      ...current,
      quantities: {
        ...current.quantities,
        [key]: Math.max(0, Number(value) || 0),
      },
    }));
  }

  async function handleSubmit() {
    if (!effectiveTenantId) {
      setError('Select a tenant before managing mappings');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      if (editingId) {
        const response = await updateCalculatorMapping(editingId, form, effectiveTenantId);
        setMappings((current) => current.map((item) => (item.id === editingId ? response.mapping : item)));
        setNotice(`Updated mapping ${response.mapping.label}.`);
      } else {
        const response = await createCalculatorMapping(form, effectiveTenantId);
        setMappings((current) => [...current, response.mapping].sort((left, right) => left.market.localeCompare(right.market) || left.label.localeCompare(right.label)));
        setNotice(`Added mapping ${response.mapping.label}.`);
      }
      resetForm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save mapping');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(mapping: CalculatorMappingRecord) {
    if (!effectiveTenantId) return;

    setError('');
    setNotice('');
    try {
      await deleteCalculatorMapping(mapping.id, effectiveTenantId);
      setMappings((current) => current.filter((item) => item.id !== mapping.id));
      if (editingId === mapping.id) {
        resetForm();
      }
      setNotice(`Removed mapping ${mapping.label}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to remove mapping');
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !effectiveTenantId) {
      return;
    }

    setImporting(true);
    setError('');
    setNotice('');

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const markets = parseImportedMarkets(parsed);
      const response = await importCalculatorMappings(markets, effectiveTenantId);
      const nextMappings = await fetchCalculatorMappings(effectiveTenantId);
      setMappings(nextMappings.mappings);
      resetForm();
      setNotice(response.message);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Unable to import mapping JSON');
    } finally {
      setImporting(false);
    }
  }

  if (session?.user.role === 'user') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-amber-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>Only admin and super admin users can manage quantity mappings.</CardDescription>
            <Button onClick={onBack} variant="secondary">Back</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
            <Database className="h-3.5 w-3.5" />
            Mapping Admin
          </Badge>
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tight text-white">Quantity mappings</h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-400">
              Manage the market and asset quantity template in the database. Import a JSON file to load starter data, or maintain individual mappings directly here.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onBack} variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button disabled={importing || !effectiveTenantId} onClick={() => fileInputRef.current?.click()} variant="outline">
            {importing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? 'Importing...' : 'Import JSON'}
          </Button>
          <input ref={fileInputRef} accept="application/json" className="hidden" onChange={handleImport} type="file" />
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

      {canSwitchTenant ? (
        <Card>
          <CardHeader className="p-5 pb-0">
            <CardTitle>Tenant scope</CardTitle>
            <CardDescription>Choose which tenant owns the mapping set you want to manage.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                className={[
                  'rounded-full border px-4 py-2 text-sm font-semibold transition',
                  selectedTenantId === tenant.id
                    ? 'border-violet-400 bg-violet-500 text-white shadow-[0_10px_25px_-12px_rgba(139,92,246,0.9)]'
                    : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500 hover:bg-slate-700',
                ].join(' ')}
                onClick={() => setSelectedTenantId(tenant.id)}
                type="button"
              >
                {tenant.name}
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="p-5 pb-0">
            <CardTitle>{editingId ? 'Edit mapping' : 'Add mapping'}</CardTitle>
            <CardDescription>These values drive the schedule quantity calculator for the selected tenant.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-2">
                <Label htmlFor="mapping-market">Market</Label>
                <Input id="mapping-market" onChange={(event) => setForm((current) => ({ ...current, market: event.target.value }))} value={form.market} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mapping-asset">Asset</Label>
                <Input id="mapping-asset" onChange={(event) => setForm((current) => ({ ...current, asset: event.target.value }))} value={form.asset} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mapping-label">Label</Label>
                <Input id="mapping-label" onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} value={form.label} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mapping-state">State</Label>
                <Input id="mapping-state" onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))} value={form.state} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {formatKeys.map((key) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`qty-${key}`}>{key}</Label>
                  <Input
                    id={`qty-${key}`}
                    inputMode="numeric"
                    onChange={(event) => updateQuantity(key, event.target.value)}
                    value={String(form.quantities[key])}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button disabled={saving || !effectiveTenantId} onClick={() => void handleSubmit()}>
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {saving ? 'Saving...' : editingId ? 'Update Mapping' : 'Add Mapping'}
              </Button>
              <Button onClick={resetForm} type="button" variant="ghost">Clear</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-5 pb-0">
            <CardTitle>Current mappings</CardTitle>
            <CardDescription>
              {mappings.length > 0
                ? `${mappings.length} mapping${mappings.length === 1 ? '' : 's'} loaded${effectiveTenantId ? ' for this tenant' : ''}.`
                : 'No mappings loaded yet. Import a JSON file to start.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <div className="flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/60 px-6 py-14">
                <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
              </div>
            ) : groupedMappings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
                <FileJson className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-4 text-base font-semibold text-white">No mapping data yet</p>
                <p className="mt-2 text-sm text-slate-400">Import the checked-in JSON template or add records one by one.</p>
              </div>
            ) : (
              groupedMappings.map(([market, marketMappings]) => (
                <section key={market} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-black text-white">{market}</h2>
                    <Badge variant="secondary">{marketMappings.length} assets</Badge>
                  </div>
                  <div className="space-y-3">
                    {marketMappings.map((mapping) => (
                      <div key={mapping.id} className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="text-base font-bold text-white">{mapping.label}</p>
                            <p className="text-sm text-slate-400">
                              {mapping.asset}
                              {mapping.state ? ` • ${mapping.state}` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                setEditingId(mapping.id);
                                setForm({
                                  market: mapping.market,
                                  asset: mapping.asset,
                                  label: mapping.label,
                                  state: mapping.state,
                                  quantities: { ...mapping.quantities },
                                });
                              }}
                              size="sm"
                              variant="secondary"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Button>
                            <Button onClick={() => void handleDelete(mapping)} size="sm" variant="destructive">
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </Button>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {formatKeys.map((key) => (
                            <div key={key} className="rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-2">
                              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{key}</p>
                              <p className="mt-1 text-lg font-black text-white">{mapping.quantities[key]}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
