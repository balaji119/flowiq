import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, MapPin, Pencil, Shield, Trash2 } from 'lucide-react';
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
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
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
} & Omit<AdminWorkspaceHandlers, 'onBack' | 'onOpenShippingSettings'>;

type AddressFormState = {
  name: string;
  unitStreetNumber: string;
  suburb: string;
  state: string;
  postcode: string;
  phoneNumber: string;
  deliveryTime: string;
  deliveryPoint: string;
  deliveryNotes: string;
};

function emptyAddressForm(): AddressFormState {
  return {
    name: '',
    unitStreetNumber: '',
    suburb: '',
    state: '',
    postcode: '',
    phoneNumber: '',
    deliveryTime: '',
    deliveryPoint: '',
    deliveryNotes: '',
  };
}

function formatAddressLine(form: AddressFormState) {
  return form.unitStreetNumber.trim();
}

function formatDeliveryAddress(form: AddressFormState) {
  const lines = [
    form.name.trim(),
    formatAddressLine(form),
    [form.suburb.trim(), form.state.trim(), form.postcode.trim()].filter(Boolean).join(' '),
    `Phone: ${form.phoneNumber.trim()}`,
    `Delivery time: ${form.deliveryTime.trim()}`,
    `Delivery point: ${form.deliveryPoint.trim()}`,
    `Notes: ${form.deliveryNotes.trim().replaceAll('\n', ' ')}`,
    'Australia',
  ];
  return lines.join('\n');
}

function parseDeliveryAddress(rawAddress: string): AddressFormState {
  const lines = rawAddress
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return emptyAddressForm();
  }

  const name = lines[0] || '';
  const streetLine = lines[1] || '';
  const suburbStatePostcodeLine = lines[2] || '';
  const phoneLine = lines.find((line) => line.toLowerCase().startsWith('phone:')) || '';
  const deliveryTimeLine = lines.find((line) => line.toLowerCase().startsWith('delivery time:')) || '';
  const deliveryPointLine = lines.find((line) => line.toLowerCase().startsWith('delivery point:')) || '';
  const notesLine = lines.find((line) => line.toLowerCase().startsWith('notes:')) || '';

  const localityMatch = suburbStatePostcodeLine.match(/^(.+?)\s+([A-Za-z]{2,3})\s+(\d{4})$/);
  const suburb = localityMatch ? localityMatch[1] : suburbStatePostcodeLine;
  const state = localityMatch ? localityMatch[2] : '';
  const postcode = localityMatch ? localityMatch[3] : '';

  return {
    name,
    unitStreetNumber: streetLine,
    suburb,
    state,
    postcode,
    phoneNumber: phoneLine ? phoneLine.slice('phone:'.length).trim() : '',
    deliveryTime: deliveryTimeLine ? deliveryTimeLine.slice('delivery time:'.length).trim() : '',
    deliveryPoint: deliveryPointLine ? deliveryPointLine.slice('delivery point:'.length).trim() : '',
    deliveryNotes: notesLine ? notesLine.slice('notes:'.length).trim() : '',
  };
}

export function ShippingSettingsScreen({ onBack, onOpenMappings, onOpenPrintingCosts, onOpenShippingCosts, onOpenUsers, tenantId }: ShippingSettingsScreenProps) {
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
  const [addressForm, setAddressForm] = useState<AddressFormState>(() => emptyAddressForm());
  const [addressDialogError, setAddressDialogError] = useState('');
  const [addressIsDefault, setAddressIsDefault] = useState(false);
  const [editingDeliveryAddress, setEditingDeliveryAddress] = useState<string | null>(null);
  const [savingDeliveryAddress, setSavingDeliveryAddress] = useState(false);
  const [deletingAddress, setDeletingAddress] = useState<string | null>(null);
  const [shippingRateDraft, setShippingRateDraft] = useState('');
  const [postersPerBoxDraft, setPostersPerBoxDraft] = useState('60');
  const [savingShippingRate, setSavingShippingRate] = useState(false);

  const canSwitchTenant = session?.user.role === 'super_admin' && !tenantId;
  const canEditShippingRate = false;
  const effectiveTenantId = tenantId ?? (canSwitchTenant ? selectedTenantId ?? undefined : session?.user.tenantId ?? undefined);
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null, [selectedTenantId, tenants]);
  const selectedMarketAddresses = useMemo(
    () => marketAddresses.filter((address) => address.market === selectedMarketFilter),
    [marketAddresses, selectedMarketFilter],
  );
  const selectedMarketShippingRateConfig = useMemo(
    () => marketShippingRates.find((rate) => rate.market === selectedMarketFilter),
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
          canEditShippingRate ? fetchMarketShippingRates(effectiveTenantId) : Promise.resolve({ rates: [] }),
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
  }, [canEditShippingRate, canSwitchTenant, effectiveTenantId]);

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
    setShippingRateDraft(selectedMarketShippingRateConfig?.shippingRate !== undefined ? String(selectedMarketShippingRateConfig.shippingRate) : '');
    setPostersPerBoxDraft(String(selectedMarketShippingRateConfig?.postersPerBox ?? 60));
  }, [selectedMarketShippingRateConfig]);

  function openAddAddressDialog() {
    setEditingDeliveryAddress(null);
    setAddressForm(emptyAddressForm());
    setAddressDialogError('');
    setAddressIsDefault(false);
    setAddressDialogOpen(true);
  }

  function openEditAddressDialog(address: MarketDeliveryAddressRecord) {
    setEditingDeliveryAddress(address.deliveryAddress);
    setAddressForm(parseDeliveryAddress(address.deliveryAddress));
    setAddressDialogError('');
    setAddressIsDefault(address.isDefault);
    setAddressDialogOpen(true);
  }

  async function handleSaveDeliveryAddress() {
    if (!effectiveTenantId || !selectedMarketFilter) return;

    const requiredFields: Array<{ label: string; value: string }> = [
      { label: 'Name', value: addressForm.name },
      { label: 'Unit/Street Number', value: addressForm.unitStreetNumber },
      { label: 'Suburb', value: addressForm.suburb },
      { label: 'State', value: addressForm.state },
      { label: 'Postcode', value: addressForm.postcode },
      { label: 'Phone number', value: addressForm.phoneNumber },
      { label: 'Delivery time', value: addressForm.deliveryTime },
      { label: 'Delivery point', value: addressForm.deliveryPoint },
      { label: 'Delivery notes', value: addressForm.deliveryNotes },
    ];
    const missingField = requiredFields.find((field) => !field.value.trim());
    if (missingField) {
      setAddressDialogError(`${missingField.label} is required`);
      return;
    }

    const nextAddress = formatDeliveryAddress(addressForm);

    setSavingDeliveryAddress(true);
    setAddressDialogError('');
    setNotice('');
    try {
      const response = await upsertMarketDeliveryAddress(
        { market: selectedMarketFilter, deliveryAddress: nextAddress, isDefault: addressIsDefault },
        effectiveTenantId,
      );

      if (editingDeliveryAddress && editingDeliveryAddress !== nextAddress) {
        await deleteMarketDeliveryAddress({ market: selectedMarketFilter, deliveryAddress: editingDeliveryAddress }, effectiveTenantId);
      }

      setMarketAddresses((current) => {
        const normalizedCurrent = response.address.isDefault
          ? current.map((item) => (item.market === selectedMarketFilter ? { ...item, isDefault: false } : item))
          : current;

        if (editingDeliveryAddress) {
          const editedIndex = normalizedCurrent.findIndex(
            (item) => item.market === selectedMarketFilter && item.deliveryAddress === editingDeliveryAddress,
          );
          if (editedIndex >= 0) {
            return normalizedCurrent.map((item, index) => (index === editedIndex ? response.address : item));
          }
        }

        const existingIndex = normalizedCurrent.findIndex(
          (item) => item.market === response.address.market && item.deliveryAddress === response.address.deliveryAddress,
        );
        if (existingIndex >= 0) {
          return normalizedCurrent.map((item, index) => (index === existingIndex ? response.address : item));
        }
        return [...normalizedCurrent, response.address];
      });

      setAddressDialogOpen(false);
      setAddressForm(emptyAddressForm());
      setAddressDialogError('');
      setAddressIsDefault(false);
      setEditingDeliveryAddress(null);
      setNotice(`${editingDeliveryAddress ? 'Updated' : 'Saved'} delivery address for ${selectedMarketFilter}.`);
    } catch (saveError) {
      setAddressDialogError(saveError instanceof Error ? saveError.message : 'Unable to save delivery address');
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
        setAddressForm(emptyAddressForm());
      }
      setNotice(`Deleted delivery address for ${selectedMarketFilter}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete delivery address');
    } finally {
      setDeletingAddress(null);
    }
  }

  async function handleSaveShippingRate(options?: { silent?: boolean }) {
    if (!canEditShippingRate || !effectiveTenantId || !selectedMarketFilter) return;

    const parsedShippingRate = Number(shippingRateDraft);
    if (!Number.isFinite(parsedShippingRate) || parsedShippingRate < 0) {
      setError('Shipping rate must be a valid number greater than or equal to 0.');
      return;
    }
    const parsedPostersPerBox = Number(postersPerBoxDraft);
    const normalizedPostersPerBox = Math.floor(parsedPostersPerBox);
    if (!Number.isFinite(parsedPostersPerBox) || normalizedPostersPerBox <= 0) {
      setError('No of posters per box must be a whole number greater than 0.');
      return;
    }

    setSavingShippingRate(true);
    setError('');
    if (!options?.silent) {
      setNotice('');
    }
    try {
      const response = await upsertMarketShippingRate(
          {
            market: selectedMarketFilter,
            useFlatRate: selectedMarketShippingRateConfig?.useFlatRate ?? false,
            shippingRate: parsedShippingRate,
            postersPerBox: normalizedPostersPerBox,
            sheeterSetsPerBox: selectedMarketShippingRateConfig?.sheeterSetsPerBox ?? 15,
            twoSheeterSetsPerBox: selectedMarketShippingRateConfig?.twoSheeterSetsPerBox ?? selectedMarketShippingRateConfig?.sheeterSetsPerBox ?? 15,
            fourSheeterSetsPerBox: selectedMarketShippingRateConfig?.fourSheeterSetsPerBox ?? selectedMarketShippingRateConfig?.sheeterSetsPerBox ?? 15,
            sixSheeterSetsPerBox: selectedMarketShippingRateConfig?.sixSheeterSetsPerBox ?? selectedMarketShippingRateConfig?.sheeterSetsPerBox ?? 15,
            eightSheeterSetsPerBox: selectedMarketShippingRateConfig?.eightSheeterSetsPerBox ?? selectedMarketShippingRateConfig?.sheeterSetsPerBox ?? 15,
            twoSheeterPrice: selectedMarketShippingRateConfig?.twoSheeterPrice ?? 0,
            fourSheeterPrice: selectedMarketShippingRateConfig?.fourSheeterPrice ?? 0,
            sixSheeterPrice: selectedMarketShippingRateConfig?.sixSheeterPrice ?? 0,
            eightSheeterPrice: selectedMarketShippingRateConfig?.eightSheeterPrice ?? 0,
            megasPerBox: selectedMarketShippingRateConfig?.megasPerBox ?? 1,
            megaShippingRate: selectedMarketShippingRateConfig?.megaShippingRate ?? 0,
            dotMShippingRate: selectedMarketShippingRateConfig?.dotMShippingRate ?? 0,
            mpShippingRate: selectedMarketShippingRateConfig?.mpShippingRate ?? 0,
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
      if (!options?.silent) {
        setNotice(`Saved shipping rate for ${response.rate.market}.`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save shipping rate');
    } finally {
      setSavingShippingRate(false);
    }
  }

  useEffect(() => {
    if (!canEditShippingRate || !effectiveTenantId || !selectedMarketFilter) return;
    if (!shippingRateDraft.trim()) return;
    if (!postersPerBoxDraft.trim()) return;

    const parsedShippingRate = Number(shippingRateDraft);
    if (!Number.isFinite(parsedShippingRate) || parsedShippingRate < 0) return;
    const parsedPostersPerBox = Number(postersPerBoxDraft);
    const normalizedPostersPerBox = Math.floor(parsedPostersPerBox);
    if (!Number.isFinite(parsedPostersPerBox) || normalizedPostersPerBox <= 0) return;
    if (
      selectedMarketShippingRateConfig &&
      parsedShippingRate === selectedMarketShippingRateConfig.shippingRate &&
      normalizedPostersPerBox === selectedMarketShippingRateConfig.postersPerBox
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void handleSaveShippingRate({ silent: true });
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canEditShippingRate, effectiveTenantId, selectedMarketFilter, selectedMarketShippingRateConfig, shippingRateDraft, postersPerBoxDraft]);

  if (session?.user.role === 'user') {
    return (
      <main className="dense-main mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-amber-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>Only admin and super admin users can manage shipping settings.</CardDescription>
            <Button className="h-11 min-w-[110px] px-5 text-base" onClick={onBack} variant="secondary">
              Back
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <AdminWorkspaceShell
      activeSection="shipping"
      canAccessManagement
      canAccessShippingCosts={session?.user.role === 'super_admin'}
      canAccessPrintingCosts={session?.user.role === 'super_admin'}
      onBack={onBack}
      onOpenLanding={onBack}
      onOpenMappings={onOpenMappings}
      onOpenPrintingCosts={onOpenPrintingCosts}
      onOpenShippingCosts={onOpenShippingCosts}
      onOpenShippingSettings={() => {}}
      onOpenUsers={onOpenUsers}
    >
    <main className="dense-main flex min-h-screen w-full flex-col gap-6">
      <header>
        <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
          <MapPin className="h-3.5 w-3.5" />
          Shipping Address
        </Badge>
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

	      <section className="space-y-5">
		        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
		          <div className="w-full xl:w-[320px]">
		            <div className="inline-flex h-11 w-full overflow-hidden rounded-xl border border-slate-600 bg-slate-800">
		              <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Market</span>
		              <select
		                id="shipping-market-filter"
		                className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
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
		          </div>
	          {canEditShippingRate ? (
	            <div className="grid w-full gap-3 xl:w-auto xl:grid-cols-2">
	              <div className="w-full xl:w-[260px] space-y-2">
	                  <Label htmlFor="shipping-rate-inline">Per Box Price ($)</Label>
	                <div className="flex items-center gap-2">
	                  <Input
	                    id="shipping-rate-inline"
	                    inputMode="decimal"
	                    onChange={(event) => setShippingRateDraft(event.target.value)}
	                    placeholder="e.g. 45.50"
	                    value={shippingRateDraft}
	                  />
	                  {savingShippingRate ? <LoaderCircle className="h-4 w-4 animate-spin text-slate-300" /> : null}
	                </div>
	              </div>
	              <div className="w-full xl:w-[220px] space-y-2">
	                <Label htmlFor="posters-per-box-inline">No of Posters Per Box</Label>
	                <Input
	                  id="posters-per-box-inline"
	                  inputMode="numeric"
	                  onChange={(event) => setPostersPerBoxDraft(event.target.value)}
	                  placeholder="60"
	                  value={postersPerBoxDraft}
	                />
	              </div>
	            </div>
	          ) : null}
	          <div className="xl:ml-auto xl:self-end">
	            <Button className="h-11 min-w-[140px] px-5 text-base" disabled={!effectiveTenantId || !selectedMarketFilter} onClick={openAddAddressDialog} type="button">
	              Add Address
	            </Button>
	          </div>
	        </div>

	        {loading ? (
	          <div className="flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/60 px-6 py-14">
	            <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
	          </div>
	        ) : selectedMarketFilter ? (
	          <div className="space-y-2">
	            {selectedMarketAddresses.length > 0 ? (
	              <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/60">
	                <table className="dense-table min-w-[1180px] w-full border-collapse text-sm">
	                  <thead>
	                    <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
	                      <th className="border border-slate-700 px-4 py-3 text-left">Name</th>
	                      <th className="border border-slate-700 px-4 py-3 text-left">Street</th>
	                      <th className="border border-slate-700 px-4 py-3 text-left">Locality</th>
	                      <th className="border border-slate-700 px-4 py-3 text-left">Phone</th>
	                      <th className="border border-slate-700 px-4 py-3 text-left">Delivery Time</th>
	                      <th className="border border-slate-700 px-4 py-3 text-left">Delivery Point</th>
	                      <th className="border border-slate-700 px-4 py-3 text-left">Notes</th>
	                      <th className="border border-slate-700 px-4 py-3 text-center">Default</th>
	                      <th className="border border-slate-700 px-4 py-3 text-center">Actions</th>
	                    </tr>
	                  </thead>
	                  <tbody>
	                    {selectedMarketAddresses.map((address) => {
	                      const parsed = parseDeliveryAddress(address.deliveryAddress);
	                      return (
	                        <tr
	                          key={`${selectedMarketFilter}-${address.deliveryAddress}`}
	                          className={address.isDefault ? 'bg-violet-500/10' : 'bg-slate-900/50'}
	                        >
	                          <td className="border border-slate-700 px-4 py-3 font-semibold text-white">{parsed.name || 'Delivery address'}</td>
	                          <td className="border border-slate-700 px-4 py-3 text-slate-200">{formatAddressLine(parsed) || '-'}</td>
	                          <td className="border border-slate-700 px-4 py-3 text-slate-200">
	                            {[parsed.suburb, parsed.state, parsed.postcode].filter(Boolean).join(' ') || '-'}
	                          </td>
	                          <td className="border border-slate-700 px-4 py-3 text-slate-300">{parsed.phoneNumber || '-'}</td>
	                          <td className="border border-slate-700 px-4 py-3 text-slate-300">{parsed.deliveryTime || '-'}</td>
	                          <td className="border border-slate-700 px-4 py-3 text-slate-300">{parsed.deliveryPoint || '-'}</td>
	                          <td className="border border-slate-700 px-4 py-3 text-slate-300">{parsed.deliveryNotes || '-'}</td>
	                          <td className="border border-slate-700 px-4 py-3 text-center">
	                            {address.isDefault ? <Badge className="px-2 py-0.5 text-[10px] font-bold">Default</Badge> : '-'}
	                          </td>
	                          <td className="border border-slate-700 px-4 py-3">
	                            <div className="flex items-center justify-center gap-1">
	                              <Button
	                                aria-label="Edit address"
	                                className="h-8 w-8 rounded-lg border-0 p-0 hover:bg-slate-700/70"
	                                onClick={() => openEditAddressDialog(address)}
	                                size="icon"
	                                type="button"
	                                variant="ghost"
	                              >
	                                <Pencil className="h-4 w-4" />
	                              </Button>
	                              <Button
	                                aria-label="Delete address"
	                                className="h-8 w-8 rounded-lg border-0 p-0 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
	                                disabled={deletingAddress === address.deliveryAddress}
	                                onClick={() => void handleDeleteAddress(address.deliveryAddress)}
	                                size="icon"
	                                type="button"
	                                variant="ghost"
	                              >
	                                {deletingAddress === address.deliveryAddress ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
	                              </Button>
	                            </div>
	                          </td>
	                        </tr>
	                      );
	                    })}
	                  </tbody>
	                </table>
	              </div>
	            ) : (
	              <div className="rounded-2xl border border-slate-700 bg-slate-900/50 px-4 py-6 text-center text-sm text-slate-400">
	                No addresses saved for this market yet.
	              </div>
	            )}
	          </div>
	        ) : (
	          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
	            <p className="text-base font-semibold text-white">No market selected</p>
	            <p className="mt-2 text-sm text-slate-400">Choose a market to manage addresses and rates.</p>
	          </div>
	        )}
	      </section>

      <Dialog
        open={addressDialogOpen}
        onOpenChange={(open) => {
          setAddressDialogOpen(open);
          if (!open) {
            setAddressForm(emptyAddressForm());
            setAddressDialogError('');
            setAddressIsDefault(false);
            setEditingDeliveryAddress(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDeliveryAddress ? 'Edit Delivery Address' : 'Add Delivery Address'}</DialogTitle>
            <DialogDescription>
              Add a new delivery address for {selectedMarketFilter || 'the selected market'}.
            </DialogDescription>
          </DialogHeader>
          {addressDialogError ? (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
              {addressDialogError}
            </div>
          ) : null}
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="address-name">Name</Label>
                <Input
                  id="address-name"
                  onChange={(event) => setAddressForm((current) => ({ ...current, name: event.target.value }))}
                  value={addressForm.name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address-unit-street-number">Unit/Street Number</Label>
                <Input
                  id="address-unit-street-number"
                  onChange={(event) => setAddressForm((current) => ({ ...current, unitStreetNumber: event.target.value }))}
                  value={addressForm.unitStreetNumber}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address-suburb">Suburb</Label>
                <Input
                  id="address-suburb"
                  onChange={(event) => setAddressForm((current) => ({ ...current, suburb: event.target.value }))}
                  value={addressForm.suburb}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address-state">State</Label>
                <Input
                  id="address-state"
                  onChange={(event) => setAddressForm((current) => ({ ...current, state: event.target.value }))}
                  value={addressForm.state}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address-postcode">Postcode</Label>
                <Input
                  id="address-postcode"
                  onChange={(event) => setAddressForm((current) => ({ ...current, postcode: event.target.value }))}
                  value={addressForm.postcode}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address-phone">Phone Number</Label>
                <Input
                  id="address-phone"
                  onChange={(event) => setAddressForm((current) => ({ ...current, phoneNumber: event.target.value }))}
                  value={addressForm.phoneNumber}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address-delivery-time">Delivery Time</Label>
                <Input
                  id="address-delivery-time"
                  onChange={(event) => setAddressForm((current) => ({ ...current, deliveryTime: event.target.value }))}
                  value={addressForm.deliveryTime}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="address-delivery-point">Delivery Point</Label>
                <Input
                  id="address-delivery-point"
                  onChange={(event) => setAddressForm((current) => ({ ...current, deliveryPoint: event.target.value }))}
                  value={addressForm.deliveryPoint}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="address-notes">Delivery Notes</Label>
                <Textarea
                  id="address-notes"
                  onChange={(event) => setAddressForm((current) => ({ ...current, deliveryNotes: event.target.value }))}
                  rows={3}
                  value={addressForm.deliveryNotes}
                />
              </div>
              <label className="md:col-span-2 flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                <input
                  checked={addressIsDefault}
                  onChange={(event) => setAddressIsDefault(event.target.checked)}
                  type="checkbox"
                />
                Set as default address for {selectedMarketFilter || 'this market'}
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                className="h-11 px-5 text-base"
                onClick={() => {
                  setAddressDialogOpen(false);
                  setAddressForm(emptyAddressForm());
                  setAddressDialogError('');
                  setAddressIsDefault(false);
                  setEditingDeliveryAddress(null);
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                className="h-11 min-w-[160px] px-5 text-base"
                disabled={savingDeliveryAddress || !selectedMarketFilter}
                onClick={() => void handleSaveDeliveryAddress()}
              >
                {savingDeliveryAddress ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {savingDeliveryAddress ? 'Saving...' : editingDeliveryAddress ? 'Save Changes' : 'Add Address'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
    </AdminWorkspaceShell>
  );
}

