import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LoaderCircle, Pencil, Plus, Shield, Trash2, Truck } from 'lucide-react';
import { MarketDeliveryAddressRecord, MarketShippingRateRecord, TenantRecord } from '@flowiq/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import {
  deleteMarketDeliveryAddress,
  fetchCalculatorMappings,
  fetchMarketDeliveryAddresses,
  fetchMarketShippingRates,
  fetchTenants,
  upsertMarketDeliveryAddress,
  upsertMarketShippingRate,
} from '../services/adminApi';

type ShippingSettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
};

export function ShippingSettingsScreen({ onBack, tenantId }: ShippingSettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(session?.user.tenantId ?? null);
  const [marketOptions, setMarketOptions] = useState<string[]>([]);
  const [selectedMarketFilter, setSelectedMarketFilter] = useState('');
  const [marketAddresses, setMarketAddresses] = useState<MarketDeliveryAddressRecord[]>([]);
  const [marketShippingRates, setMarketShippingRates] = useState<MarketShippingRateRecord[]>([]);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [editingDeliveryAddress, setEditingDeliveryAddress] = useState<string | null>(null);
  const [savingDeliveryAddress, setSavingDeliveryAddress] = useState(false);
  const [deletingAddress, setDeletingAddress] = useState<string | null>(null);
  const [shippingRateDraft, setShippingRateDraft] = useState('');
  const [savingShippingRate, setSavingShippingRate] = useState(false);

  const canSwitchTenant = session?.user.role === 'super_admin' && !tenantId;
  const canEditShippingRate = session?.user.role === 'super_admin';
  const effectiveTenantId = tenantId ?? (canSwitchTenant ? selectedTenantId ?? undefined : session?.user.tenantId ?? undefined);
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null, [selectedTenantId, tenants]);
  const selectedMarketAddresses = useMemo(
    () =>
      [...new Set(marketAddresses.filter((address) => address.market === selectedMarketFilter).map((address) => address.deliveryAddress))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [marketAddresses, selectedMarketFilter],
  );
  const selectedMarketShippingRate = useMemo(
    () => marketShippingRates.find((rate) => rate.market === selectedMarketFilter)?.shippingRate,
    [marketShippingRates, selectedMarketFilter],
  );

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
      setMarketOptions([]);
      setMarketAddresses([]);
      setMarketShippingRates([]);
      setLoading(false);
      return;
    }

    async function loadShippingData() {
      try {
        setLoading(true);
        setError('');
        const [mappingResponse, addressResponse, shippingRateResponse] = await Promise.all([
          fetchCalculatorMappings(effectiveTenantId),
          fetchMarketDeliveryAddresses(effectiveTenantId),
          fetchMarketShippingRates(effectiveTenantId),
        ]);
        if (!active) return;

        const nextMarketOptions = [
          ...new Set([
            ...mappingResponse.mappings.map((mapping) => mapping.market),
            ...addressResponse.addresses.map((address) => address.market),
            ...shippingRateResponse.rates.map((rate) => rate.market),
          ]),
        ].sort((left, right) => left.localeCompare(right));

        setMarketOptions(nextMarketOptions);
        setMarketAddresses(addressResponse.addresses);
        setMarketShippingRates(shippingRateResponse.rates);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load shipping settings');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadShippingData();
    return () => {
      active = false;
    };
  }, [canSwitchTenant, effectiveTenantId]);

  useEffect(() => {
    if (marketOptions.length === 0) {
      setSelectedMarketFilter('');
      return;
    }
    if (!selectedMarketFilter || !marketOptions.includes(selectedMarketFilter)) {
      setSelectedMarketFilter(marketOptions[0]);
    }
  }, [marketOptions, selectedMarketFilter]);

  useEffect(() => {
    setShippingRateDraft(selectedMarketShippingRate !== undefined ? String(selectedMarketShippingRate) : '');
  }, [selectedMarketShippingRate]);

  function openAddAddressDialog() {
    setEditingDeliveryAddress(null);
    setAddressDraft('');
    setAddressDialogOpen(true);
  }

  function openEditAddressDialog(address: string) {
    setEditingDeliveryAddress(address);
    setAddressDraft(address);
    setAddressDialogOpen(true);
  }

  async function handleSaveDeliveryAddress() {
    if (!effectiveTenantId || !selectedMarketFilter) return;

    const nextAddress = addressDraft.trim();
    if (!nextAddress) {
      setError('Delivery address is required.');
      return;
    }

    setSavingDeliveryAddress(true);
    setError('');
    setNotice('');
    try {
      const response = await upsertMarketDeliveryAddress({ market: selectedMarketFilter, deliveryAddress: nextAddress }, effectiveTenantId);

      if (editingDeliveryAddress && editingDeliveryAddress !== nextAddress) {
        await deleteMarketDeliveryAddress({ market: selectedMarketFilter, deliveryAddress: editingDeliveryAddress }, effectiveTenantId);
      }

      setMarketAddresses((current) => {
        const withoutEdited =
          editingDeliveryAddress && editingDeliveryAddress !== nextAddress
            ? current.filter((item) => !(item.market === selectedMarketFilter && item.deliveryAddress === editingDeliveryAddress))
            : current;
        const exists = withoutEdited.some((item) => item.market === response.address.market && item.deliveryAddress === response.address.deliveryAddress);
        if (exists) {
          return withoutEdited.map((item) =>
            item.market === response.address.market && item.deliveryAddress === response.address.deliveryAddress ? response.address : item,
          );
        }
        return [...withoutEdited, response.address].sort((left, right) => left.market.localeCompare(right.market) || left.deliveryAddress.localeCompare(right.deliveryAddress));
      });

      setAddressDialogOpen(false);
      setAddressDraft('');
      setEditingDeliveryAddress(null);
      setNotice(`${editingDeliveryAddress ? 'Updated' : 'Saved'} delivery address for ${selectedMarketFilter}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save delivery address');
    } finally {
      setSavingDeliveryAddress(false);
    }
  }

  async function handleDeleteAddress(address: string) {
    if (!effectiveTenantId || !selectedMarketFilter) return;
    const confirmed = window.confirm('Delete this delivery address?');
    if (!confirmed) return;

    setDeletingAddress(address);
    setError('');
    setNotice('');
    try {
      await deleteMarketDeliveryAddress({ market: selectedMarketFilter, deliveryAddress: address }, effectiveTenantId);
      setMarketAddresses((current) => current.filter((item) => !(item.market === selectedMarketFilter && item.deliveryAddress === address)));
      if (editingDeliveryAddress === address) {
        setEditingDeliveryAddress(null);
        setAddressDraft('');
      }
      setNotice(`Deleted delivery address for ${selectedMarketFilter}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete delivery address');
    } finally {
      setDeletingAddress(null);
    }
  }

  async function handleSaveShippingRate() {
    if (!canEditShippingRate || !effectiveTenantId || !selectedMarketFilter) return;

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
        const exists = current.some((item) => item.market === response.rate.market);
        if (exists) {
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
            <CardDescription>Only admin and super admin users can manage shipping settings.</CardDescription>
            <Button onClick={onBack} variant="secondary">
              Back
            </Button>
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
            <Truck className="h-3.5 w-3.5" />
            Shipping Admin
          </Badge>
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tight text-white">Shipping settings</h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-400">
              Manage delivery addresses and market shipping rates in one place, separate from quantity mappings.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onBack} variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

      {canSwitchTenant ? (
        <Card>
          <CardHeader className="p-5 pb-0">
            <CardTitle>Tenant scope</CardTitle>
            <CardDescription>Super admins must choose a tenant before they can manage shipping data.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
              <p className="text-sm font-semibold text-white">
                {selectedTenant ? `Managing shipping settings for ${selectedTenant.name}` : 'No tenant selected'}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {selectedTenant ? selectedTenant.id : 'Select a tenant below. Shipping settings are always owned by a tenant.'}
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
          <CardTitle>Market shipping data</CardTitle>
          <CardDescription>
            {marketOptions.length > 0
              ? `Configure settings for ${marketOptions.length} market${marketOptions.length === 1 ? '' : 's'}.`
              : 'No markets available yet. Add quantity mappings first to define markets.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-sm space-y-2">
              <Label htmlFor="shipping-market-filter">Market</Label>
              <select
                id="shipping-market-filter"
                className="h-11 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
                onChange={(event) => setSelectedMarketFilter(event.target.value)}
                value={selectedMarketFilter}
              >
                {marketOptions.length === 0 ? <option value="">No markets available</option> : null}
                {marketOptions.map((market) => (
                  <option key={`shipping-market-filter-${market}`} value={market}>
                    {market}
                  </option>
                ))}
              </select>
            </div>
            <Button disabled={!effectiveTenantId || !selectedMarketFilter} onClick={openAddAddressDialog} type="button">
              <Plus className="h-4 w-4" />
              Add Address
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : selectedMarketFilter ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
                <p className="text-sm font-semibold text-white">Delivery addresses ({selectedMarketFilter})</p>
                {selectedMarketAddresses.length > 0 ? (
                  <div className="space-y-2">
                    {selectedMarketAddresses.map((address) => (
                      <div key={`${selectedMarketFilter}-${address}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2">
                        <p className="text-sm whitespace-pre-wrap text-slate-200">{address}</p>
                        <div className="flex items-center gap-1">
                          <Button
                            aria-label="Edit address"
                            className="h-7 w-7 rounded-md border-0 p-0 hover:bg-slate-700/70"
                            onClick={() => openEditAddressDialog(address)}
                            type="button"
                            variant="ghost"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label="Delete address"
                            className="h-7 w-7 rounded-md border-0 p-0 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                            disabled={deletingAddress === address}
                            onClick={() => void handleDeleteAddress(address)}
                            type="button"
                            variant="ghost"
                          >
                            {deletingAddress === address ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No addresses saved for this market yet.</p>
                )}
              </div>

              <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
                <Label htmlFor="shipping-rate">Shipping Rate ({selectedMarketFilter})</Label>
                <Input
                  id="shipping-rate"
                  inputMode="decimal"
                  onChange={(event) => setShippingRateDraft(event.target.value)}
                  placeholder="Enter shipping rate (e.g. 45.50)"
                  value={shippingRateDraft}
                />
                <p className="text-xs text-slate-400">Review cost formula: (number of posters / 60) * shipping rate.</p>
                {canEditShippingRate ? (
                  <div className="flex justify-end">
                    <Button disabled={savingShippingRate || !shippingRateDraft.trim()} onClick={() => void handleSaveShippingRate()} type="button" variant="outline">
                      {savingShippingRate ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      {savingShippingRate ? 'Saving...' : 'Save Shipping Rate'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Only super admins can edit shipping rates.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
              <p className="text-base font-semibold text-white">No market selected</p>
              <p className="mt-2 text-sm text-slate-400">Choose a market to manage addresses and rates.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={addressDialogOpen}
        onOpenChange={(open) => {
          setAddressDialogOpen(open);
          if (!open) {
            setAddressDraft('');
            setEditingDeliveryAddress(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDeliveryAddress ? 'Edit delivery address' : 'Add delivery address'}</DialogTitle>
            <DialogDescription>
              {selectedMarketFilter
                ? `This address will be available for ${selectedMarketFilter} assets during campaign scheduling.`
                : 'Select a market first.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address-dialog-input">Delivery address</Label>
              <Textarea
                id="address-dialog-input"
                onChange={(event) => setAddressDraft(event.target.value)}
                placeholder="Company name, street, suburb, state, postcode"
                rows={5}
                value={addressDraft}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => {
                  setAddressDialogOpen(false);
                  setAddressDraft('');
                  setEditingDeliveryAddress(null);
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={savingDeliveryAddress || !addressDraft.trim() || !selectedMarketFilter} onClick={() => void handleSaveDeliveryAddress()}>
                {savingDeliveryAddress ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {savingDeliveryAddress ? 'Saving...' : editingDeliveryAddress ? 'Save Changes' : 'Add Address'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
