import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Database, FileJson, LoaderCircle, Pencil, Plus, Shield, Trash2, Upload } from 'lucide-react';
import { CalculatorMappingInput, CalculatorMappingRecord, MarketDeliveryAddressRecord, MarketMetadata, MarketShippingRateRecord, TenantRecord, createEmptyBreakdown, formatKeys } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import {
  createCalculatorMapping,
  deleteCalculatorMapping,
  fetchMarketDeliveryAddresses,
  fetchMarketShippingRates,
  fetchCalculatorMappings,
  fetchTenants,
  importCalculatorMappings,
  upsertMarketDeliveryAddress,
  upsertMarketShippingRate,
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

function formatSheetHeader(key: (typeof formatKeys)[number]) {
  return key.includes('-sheet') ? key.replace('-', ' ') : key;
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
  const [marketAddresses, setMarketAddresses] = useState<MarketDeliveryAddressRecord[]>([]);
  const [marketShippingRates, setMarketShippingRates] = useState<MarketShippingRateRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CalculatorMappingInput>(emptyForm);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [selectedMarketFilter, setSelectedMarketFilter] = useState('');
  const [deliveryAddressDraft, setDeliveryAddressDraft] = useState('');
  const [savingDeliveryAddress, setSavingDeliveryAddress] = useState(false);
  const [shippingRateDraft, setShippingRateDraft] = useState('');
  const [savingShippingRate, setSavingShippingRate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSwitchTenant = session?.user.role === 'super_admin';
  const effectiveTenantId = canSwitchTenant ? selectedTenantId ?? undefined : session?.user.tenantId ?? undefined;
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
      setMappings([]);
      setMarketAddresses([]);
      setMarketShippingRates([]);
      setLoading(false);
      return;
    }

    async function loadMappings() {
      try {
        setLoading(true);
        setError('');
        const [mappingResponse, addressResponse, shippingRateResponse] = await Promise.all([
          fetchCalculatorMappings(effectiveTenantId),
          fetchMarketDeliveryAddresses(effectiveTenantId),
          canSwitchTenant ? fetchMarketShippingRates(effectiveTenantId) : Promise.resolve({ rates: [] }),
        ]);
        if (!active) return;
        setMappings(mappingResponse.mappings);
        setMarketAddresses(addressResponse.addresses);
        setMarketShippingRates(shippingRateResponse.rates);
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
  }, [canSwitchTenant, effectiveTenantId]);

  const marketOptions = useMemo(() => [...new Set(mappings.map((mapping) => mapping.market))].sort((left, right) => left.localeCompare(right)), [mappings]);

  const filteredMappings = useMemo(() => {
    if (!selectedMarketFilter) return [];
    return mappings
      .filter((mapping) => mapping.market === selectedMarketFilter)
      .sort((left, right) => left.asset.localeCompare(right.asset) || left.label.localeCompare(right.label));
  }, [mappings, selectedMarketFilter]);

  useEffect(() => {
    if (marketOptions.length === 0) {
      setSelectedMarketFilter('');
      return;
    }
    if (!selectedMarketFilter || !marketOptions.includes(selectedMarketFilter)) {
      setSelectedMarketFilter(marketOptions[0]);
    }
  }, [marketOptions, selectedMarketFilter]);

  const selectedMarketAddress = useMemo(
    () => marketAddresses.find((address) => address.market === selectedMarketFilter)?.deliveryAddress ?? '',
    [marketAddresses, selectedMarketFilter],
  );
  const selectedMarketShippingRate = useMemo(
    () => marketShippingRates.find((rate) => rate.market === selectedMarketFilter)?.shippingRate,
    [marketShippingRates, selectedMarketFilter],
  );

  useEffect(() => {
    setDeliveryAddressDraft(selectedMarketAddress);
  }, [selectedMarketAddress]);

  useEffect(() => {
    setShippingRateDraft(selectedMarketShippingRate !== undefined ? String(selectedMarketShippingRate) : '');
  }, [selectedMarketShippingRate]);

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
      setMappingDialogOpen(false);
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
      const [nextMappings, nextAddresses, nextShippingRates] = await Promise.all([
        fetchCalculatorMappings(effectiveTenantId),
        fetchMarketDeliveryAddresses(effectiveTenantId),
        canSwitchTenant ? fetchMarketShippingRates(effectiveTenantId) : Promise.resolve({ rates: [] }),
      ]);
      setMappings(nextMappings.mappings);
      setMarketAddresses(nextAddresses.addresses);
      setMarketShippingRates(nextShippingRates.rates);
      resetForm();
      setNotice(response.message);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Unable to import mapping JSON');
    } finally {
      setImporting(false);
    }
  }

  function openAddMappingDialog() {
    setEditingId(null);
    setForm({
      ...emptyForm(),
      market: selectedMarketFilter || '',
    });
    setMappingDialogOpen(true);
  }

  function openEditMappingDialog(mapping: CalculatorMappingRecord) {
    setEditingId(mapping.id);
    setForm({
      market: mapping.market,
      asset: mapping.asset,
      label: mapping.label,
      state: mapping.state,
      quantities: { ...mapping.quantities },
    });
    setMappingDialogOpen(true);
  }

  async function handleSaveDeliveryAddress() {
    if (!effectiveTenantId || !selectedMarketFilter) return;

    setSavingDeliveryAddress(true);
    setError('');
    setNotice('');
    try {
      const response = await upsertMarketDeliveryAddress(
        {
          market: selectedMarketFilter,
          deliveryAddress: deliveryAddressDraft,
        },
        effectiveTenantId,
      );
      setMarketAddresses((current) => {
        const existing = current.some((item) => item.market === response.address.market);
        if (existing) {
          return current.map((item) => (item.market === response.address.market ? response.address : item));
        }
        return [...current, response.address].sort((left, right) => left.market.localeCompare(right.market));
      });
      setNotice(`Saved delivery address for ${response.address.market}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save delivery address');
    } finally {
      setSavingDeliveryAddress(false);
    }
  }

  async function handleSaveShippingRate() {
    if (!effectiveTenantId || !selectedMarketFilter) return;

    const parsedShippingRate = Number(shippingRateDraft);
    if (!Number.isFinite(parsedShippingRate) || parsedShippingRate < 0) {
      setError('Shipping rate must be a valid number greater than or equal to 0.');
      return;
    }

    setSavingShippingRate(true);
    setError('');
    setNotice('');
    try {
      const response = await upsertMarketShippingRate(
        {
          market: selectedMarketFilter,
          shippingRate: parsedShippingRate,
        },
        effectiveTenantId,
      );
      setMarketShippingRates((current) => {
        const existing = current.some((item) => item.market === response.rate.market);
        if (existing) {
          return current.map((item) => (item.market === response.rate.market ? response.rate : item));
        }
        return [...current, response.rate].sort((left, right) => left.market.localeCompare(right.market));
      });
      setNotice(`Saved shipping rate for ${response.rate.market}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save shipping rate');
    } finally {
      setSavingShippingRate(false);
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
            <CardDescription>Super admins must choose a tenant before they can add or import quantity mappings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
              <p className="text-sm font-semibold text-white">
                {selectedTenant ? `Managing mappings for ${selectedTenant.name}` : 'No tenant selected'}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {selectedTenant ? selectedTenant.id : 'Select a tenant below. Mapping records are always owned by a tenant and cannot be global.'}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {tenants.map((tenant) => {
                const active = selectedTenantId === tenant.id;
                return (
                  <button
                    key={tenant.id}
                    className={active
                      ? 'rounded-2xl border border-violet-400 bg-violet-500/10 p-4 text-left shadow-[0_10px_25px_-12px_rgba(139,92,246,0.9)] transition'
                      : 'rounded-2xl border border-slate-700 bg-slate-800/80 p-4 text-left transition hover:border-slate-500 hover:bg-slate-800'}
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
                    {tenant.createdAt ? <p className="mt-3 text-xs text-slate-500">Created {new Date(tenant.createdAt).toLocaleString()}</p> : null}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-sm space-y-2">
              <Label htmlFor="market-filter">Market</Label>
              <select
                id="market-filter"
                className="h-11 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
                onChange={(event) => setSelectedMarketFilter(event.target.value)}
                value={selectedMarketFilter}
              >
                {marketOptions.length === 0 ? <option value="">No markets available</option> : null}
                {marketOptions.map((market) => (
                  <option key={`market-filter-${market}`} value={market}>
                    {market}
                  </option>
                ))}
              </select>
            </div>
            <Button disabled={!effectiveTenantId || !selectedMarketFilter} onClick={openAddMappingDialog} type="button">
              <Plus className="h-4 w-4" />
              Add Mapping
            </Button>
          </div>

          {selectedMarketFilter ? (
            <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="delivery-address">Delivery Address ({selectedMarketFilter})</Label>
                  <Input
                    id="delivery-address"
                    onChange={(event) => setDeliveryAddressDraft(event.target.value)}
                    placeholder="Enter delivery address for this market"
                    value={deliveryAddressDraft}
                  />
                  <div className="flex justify-end">
                    <Button disabled={savingDeliveryAddress || !deliveryAddressDraft.trim()} onClick={() => void handleSaveDeliveryAddress()} type="button" variant="outline">
                      {savingDeliveryAddress ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      {savingDeliveryAddress ? 'Saving...' : 'Save Address'}
                    </Button>
                  </div>
                </div>

                {canSwitchTenant ? (
                  <div className="space-y-2">
                    <Label htmlFor="shipping-rate">Shipping Rate ({selectedMarketFilter})</Label>
                    <Input
                      id="shipping-rate"
                      inputMode="decimal"
                      onChange={(event) => setShippingRateDraft(event.target.value)}
                      placeholder="Enter shipping rate (e.g. 45.50)"
                      value={shippingRateDraft}
                    />
                    <div className="flex justify-end">
                      <Button
                        disabled={savingShippingRate || !shippingRateDraft.trim()}
                        onClick={() => void handleSaveShippingRate()}
                        type="button"
                        variant="outline"
                      >
                        {savingShippingRate ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                        {savingShippingRate ? 'Saving...' : 'Save Shipping Rate'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : marketOptions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
              <FileJson className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-4 text-base font-semibold text-white">No mapping data yet</p>
              <p className="mt-2 text-sm text-slate-400">Import the checked-in JSON template or add records one by one.</p>
            </div>
          ) : filteredMappings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
              <p className="text-base font-semibold text-white">No assets for this market yet</p>
              <p className="mt-2 text-sm text-slate-400">Choose Add Mapping to create the first asset mapping for {selectedMarketFilter}.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[24px] border border-slate-700 bg-slate-900/70">
              <table className="min-w-[1180px] w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-4 py-3 text-left">Asset</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">Label</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">State</th>
                    {formatKeys.map((key) => (
                      <th key={`mapping-head-${key}`} className="border border-slate-700 px-4 py-3 text-center">{formatSheetHeader(key)}</th>
                    ))}
                    <th className="sticky right-0 z-20 border border-slate-700 bg-slate-950 px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMappings.map((mapping) => (
                    <tr key={`mapping-row-${mapping.id}`} className="bg-slate-800/70 border-t border-slate-700/70">
                      <td className="border border-slate-700 px-4 py-3 font-semibold text-white">{mapping.asset}</td>
                      <td className="border border-slate-700 px-4 py-3 text-slate-200">{mapping.label}</td>
                      <td className="border border-slate-700 px-4 py-3 text-slate-300">{mapping.state || '-'}</td>
                      {formatKeys.map((key) => (
                        <td key={`mapping-cell-${mapping.id}-${key}`} className="border border-slate-700 px-4 py-3 text-center font-semibold text-white">
                          {mapping.quantities[key]}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 border border-slate-700 bg-slate-800/95 px-3 py-3">
                        <div className="flex justify-center gap-2">
                          <Button
                            aria-label="Edit mapping"
                            className="h-7 w-7 rounded-md border-0 p-0 hover:bg-slate-700/70"
                            onClick={() => openEditMappingDialog(mapping)}
                            type="button"
                            variant="ghost"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label="Delete mapping"
                            className="h-7 w-7 rounded-md border-0 p-0 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                            onClick={() => void handleDelete(mapping)}
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={mappingDialogOpen}
        onOpenChange={(open) => {
          setMappingDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit mapping' : 'Add mapping'}</DialogTitle>
            <DialogDescription>
              {canSwitchTenant
                ? selectedTenant
                  ? `These values will be saved for ${selectedTenant.name}.`
                  : 'Select a tenant before adding or importing quantity mappings.'
                : 'These values drive the schedule quantity calculator for your tenant.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
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

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                onClick={() => {
                  setMappingDialogOpen(false);
                  resetForm();
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={saving || !effectiveTenantId} onClick={() => void handleSubmit()}>
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {saving ? 'Saving...' : editingId ? 'Update Mapping' : 'Add Mapping'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
