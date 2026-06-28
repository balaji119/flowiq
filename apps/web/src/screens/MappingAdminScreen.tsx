import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, LoaderCircle, Pencil, Plus, Shield, Trash2, Upload } from 'lucide-react';
import { CalculatorMappingInput, CalculatorMappingRecord, MarketMetadata, SheetNameOverrides, TenantRecord, createEmptyBreakdown, formatKeys } from '@flowiq/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from '@flowiq/ui';
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
import { useAuth } from '../context/AuthContext';
import {
  createCalculatorMapping,
  deleteCalculatorMapping,
  fetchAdminSheetNameOverrides,
  fetchCalculatorMappings,
  fetchTenants,
  importCalculatorMappings,
  updateCalculatorMapping,
} from '../services/adminApi';
import { resolveFormatName, resolveSheetName, sanitizeSheetNameOverrides, toCanonicalSheetNameKey } from '../services/sheetNameOverrides';

const BUILT_IN_OVERRIDE_KEYS = new Set(['8-sheet', '8-sheet-a0', '6-sheet', '4-sheet', '2-sheet', 'mega', 'dot-m', 'mega-portrait', 'ff']);

type MappingAdminScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
} & Omit<AdminWorkspaceHandlers, 'onBack' | 'onOpenMappings'>;

function emptyForm(): CalculatorMappingInput {
  return {
    market: '',
    asset: '',
    label: '',
    state: '',
    maintenanceAssetId: null,
    quantities: createEmptyBreakdown(),
  };
}

function escapeCsvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inQuotes) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error('The CSV contains an unclosed quoted value.');
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function normalizeCsvHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mappingLookupKey(market: string, asset: string) {
  return `${market.trim().toLowerCase()}\u0000${asset.trim().toLowerCase()}`;
}

function formatSheetHeader(key: (typeof formatKeys)[number], overrides: SheetNameOverrides) {
  return resolveFormatName(key, overrides);
}

export function MappingAdminScreen({ onBack, onOpenMaterials, onOpenPrintingCosts, onOpenSettings, onOpenSheetSizeSettings, onOpenShippingCosts, onOpenShippingSettings, onOpenTenants, onOpenUsers, tenantId }: MappingAdminScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [mappings, setMappings] = useState<CalculatorMappingRecord[]>([]);
  const [sheetNameOverrides, setSheetNameOverrides] = useState<SheetNameOverrides>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CalculatorMappingInput>(emptyForm);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState('');
  const [selectedMarketFilter, setSelectedMarketFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSwitchTenant = session?.user.role === 'super_admin';
  const effectiveTenantId = canSwitchTenant ? selectedTenantId ?? undefined : session?.user.tenantId ?? undefined;
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null, [selectedTenantId, tenants]);

  useEffect(() => {
    if (session?.user.role !== 'super_admin') {
      setSelectedTenantId(session?.user.tenantId ?? null);
      return;
    }
    if (tenantId) {
      setSelectedTenantId(tenantId);
    }
  }, [session?.user.role, session?.user.tenantId, tenantId]);

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
          setSelectedTenantId((current) => {
            if (current && tenantResponse.tenants.some((tenant) => tenant.id === current)) {
              return current;
            }
            return tenantResponse.tenants[0]?.id ?? null;
          });
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
  }, [canSwitchTenant]);

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
        const mappingResponse = await fetchCalculatorMappings(effectiveTenantId);
        if (!active) return;
        setMappings(mappingResponse.mappings);
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

  useEffect(() => {
    let active = true;
    if (!effectiveTenantId) {
      setSheetNameOverrides({});
      return;
    }

    async function loadSheetNameOverrides() {
      try {
        const response = await fetchAdminSheetNameOverrides(effectiveTenantId);
        if (!active) return;
        setSheetNameOverrides(sanitizeSheetNameOverrides(response.settings.overrides));
      } catch {
        if (!active) return;
        setSheetNameOverrides({});
      }
    }

    void loadSheetNameOverrides();
    return () => {
      active = false;
    };
  }, [effectiveTenantId]);

  const marketOptions = useMemo(() => [...new Set(mappings.map((mapping) => mapping.market))].sort((left, right) => left.localeCompare(right)), [mappings]);
  const customQuantityKeys = useMemo(() => {
    const storedQuantityKeys = Array.from(new Set(mappings.flatMap((mapping) => Object.keys(mapping.quantities as Record<string, number>))))
      .filter((key) => !BUILT_IN_OVERRIDE_KEYS.has(toCanonicalSheetNameKey(key)));
    const storedCanonicalKeys = new Set(storedQuantityKeys.map(toCanonicalSheetNameKey));
    const overrideKeys = Object.keys(sheetNameOverrides)
      .filter((key) => !BUILT_IN_OVERRIDE_KEYS.has(key))
      .filter((key) => !storedCanonicalKeys.has(toCanonicalSheetNameKey(key)));
    return Array.from(new Set([...overrideKeys, ...storedQuantityKeys]))
      .filter((key) => !formatKeys.some((formatKey) => normalizeCsvHeader(formatKey) === normalizeCsvHeader(key)))
      .sort((left, right) => left.localeCompare(right));
  }, [mappings, sheetNameOverrides]);
  const allQuantityKeys = useMemo(() => [...formatKeys, ...customQuantityKeys], [customQuantityKeys]);
  const mappingById = useMemo(() => new Map(mappings.map((mapping) => [mapping.id, mapping])), [mappings]);
  const maintenanceCandidates = useMemo(() => {
    if (!form.market) return [] as CalculatorMappingRecord[];
    return mappings
      .filter((mapping) => mapping.market === form.market && mapping.id !== editingId)
      .sort((left, right) => left.label.localeCompare(right.label) || left.asset.localeCompare(right.asset));
  }, [editingId, form.market, mappings]);

  const filteredMappings = useMemo(() => {
    if (!selectedMarketFilter) return [];
    return mappings
      .filter((mapping) => mapping.market === selectedMarketFilter)
      .sort((left, right) => left.asset.localeCompare(right.asset) || left.label.localeCompare(right.label));
  }, [mappings, selectedMarketFilter]);

  function quantityValue(quantities: CalculatorMappingRecord['quantities'], key: string) {
    const dynamicQuantities = quantities as Record<string, number>;
    return dynamicQuantities[key] ?? 0;
  }

  useEffect(() => {
    if (marketOptions.length === 0) {
      setSelectedMarketFilter('');
      return;
    }
    if (!selectedMarketFilter || !marketOptions.includes(selectedMarketFilter)) {
      setSelectedMarketFilter(marketOptions[0]);
    }
  }, [marketOptions, selectedMarketFilter]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function updateQuantity(key: string, value: string) {
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
      const quantityKeysForPayload = Array.from(
        new Set([...Object.keys((form.quantities as Record<string, number>) ?? {}), ...allQuantityKeys]),
      );
      const normalizedQuantities = quantityKeysForPayload.reduce<Record<string, number>>((acc, key) => {
        const raw = Number((form.quantities as Record<string, number>)[key] ?? 0);
        acc[key] = Number.isFinite(raw) ? Math.max(0, raw) : 0;
        return acc;
      }, {});
      const payload: CalculatorMappingInput = {
        ...form,
        quantities: normalizedQuantities as CalculatorMappingInput['quantities'],
      };
      if (editingId) {
        const response = await updateCalculatorMapping(editingId, payload, effectiveTenantId);
        setMappings((current) => current.map((item) => (item.id === editingId ? response.mapping : item)));
        setNotice(`Updated mapping ${response.mapping.label}.`);
      } else {
        const response = await createCalculatorMapping(payload, effectiveTenantId);
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

  function downloadImportTemplate() {
    const headers = ['Market', 'Asset', 'Label', 'State', 'Maintenance Asset', ...allQuantityKeys];
    const sortedMappings = [...mappings].sort(
      (left, right) => left.market.localeCompare(right.market) || left.asset.localeCompare(right.asset) || left.label.localeCompare(right.label),
    );
    const rows = sortedMappings.map((mapping) => [
      mapping.market,
      mapping.asset,
      mapping.label,
      mapping.state,
      mapping.maintenanceAssetId ? (mappingById.get(mapping.maintenanceAssetId)?.asset ?? '') : '',
      ...allQuantityKeys.map((key) => quantityValue(mapping.quantities, key)),
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const tenantName = (selectedTenant?.name || effectiveTenantId || 'tenant').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    anchor.href = url;
    anchor.download = `quantity-mappings-${tenantName || 'tenant'}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function parseImportedMappingsCsv(text: string): MarketMetadata[] {
    const csvRows = parseCsvRows(text);
    if (csvRows.length < 2) throw new Error('The CSV must include the header row and at least one mapping record.');

    const headers = csvRows[0].map(normalizeCsvHeader);
    const duplicateHeader = headers.find((header, index) => headers.indexOf(header) !== index);
    if (duplicateHeader) throw new Error(`The CSV contains a duplicate column: ${csvRows[0][headers.indexOf(duplicateHeader)]}.`);

    const baseHeaders = ['Market', 'Asset', 'Label', 'State', 'Maintenance Asset'];
    const requiredHeaders = [...baseHeaders, ...allQuantityKeys];
    const requiredHeaderKeys = requiredHeaders.map(normalizeCsvHeader);
    const missingHeader = requiredHeaderKeys.find((header) => !headers.includes(header));
    if (missingHeader) {
      const displayName = requiredHeaders[requiredHeaderKeys.indexOf(missingHeader)];
      throw new Error(`The CSV is missing the required column: ${displayName}. Download a fresh template and try again.`);
    }
    const emptyHeaderIndex = headers.findIndex((header) => !header);
    if (emptyHeaderIndex >= 0) throw new Error(`Column ${emptyHeaderIndex + 1} needs a name.`);

    const baseHeaderKeys = baseHeaders.map(normalizeCsvHeader);
    const existingQuantityKeyByHeader = new Map(allQuantityKeys.map((key) => [normalizeCsvHeader(key), key]));
    const importedQuantityKeys = csvRows[0]
      .map((header) => header.trim())
      .filter((header) => !baseHeaderKeys.includes(normalizeCsvHeader(header)))
      .map((header) => existingQuantityKeyByHeader.get(normalizeCsvHeader(header)) ?? header);

    const columnIndex = new Map(headers.map((header, index) => [header, index]));
    const valueAt = (row: string[], header: string) => (row[columnIndex.get(normalizeCsvHeader(header)) ?? -1] ?? '').trim();
    const existingIdByKey = new Map(mappings.map((mapping) => [mappingLookupKey(mapping.market, mapping.asset), mapping.id]));
    const importedRows = csvRows.slice(1).map((row, index) => {
      const rowNumber = index + 2;
      const market = valueAt(row, 'Market');
      const asset = valueAt(row, 'Asset');
      if (!market) throw new Error(`Row ${rowNumber}: Market is required.`);
      if (!asset) throw new Error(`Row ${rowNumber}: Asset is required.`);

      const quantities = importedQuantityKeys.reduce<Record<string, number>>((result, key) => {
        const rawValue = valueAt(row, key);
        const value = rawValue === '' ? 0 : Number(rawValue);
        if (!Number.isInteger(value) || value < 0) {
          throw new Error(`Row ${rowNumber}: ${key} must be a whole number greater than or equal to zero.`);
        }
        result[key] = value;
        return result;
      }, {});

      return {
        asset,
        id: existingIdByKey.get(mappingLookupKey(market, asset)) || crypto.randomUUID(),
        label: valueAt(row, 'Label') || asset,
        maintenanceAsset: valueAt(row, 'Maintenance Asset'),
        market,
        quantities,
        rowNumber,
        state: valueAt(row, 'State'),
      };
    });

    const importedIdByKey = new Map(existingIdByKey);
    const seenImportedKeys = new Set<string>();
    importedRows.forEach((row) => {
      const key = mappingLookupKey(row.market, row.asset);
      if (seenImportedKeys.has(key)) throw new Error(`Row ${row.rowNumber}: ${row.market} / ${row.asset} is duplicated in the CSV.`);
      seenImportedKeys.add(key);
      importedIdByKey.set(key, row.id);
    });

    const marketsByName = new Map<string, MarketMetadata>();
    importedRows.forEach((row) => {
      const maintenanceAssetId = row.maintenanceAsset
        ? importedIdByKey.get(mappingLookupKey(row.market, row.maintenanceAsset))
        : '';
      if (row.maintenanceAsset && !maintenanceAssetId) {
        throw new Error(`Row ${row.rowNumber}: Maintenance Asset "${row.maintenanceAsset}" was not found in market "${row.market}".`);
      }
      if (maintenanceAssetId === row.id) {
        throw new Error(`Row ${row.rowNumber}: An asset cannot be its own maintenance asset.`);
      }

      const market = marketsByName.get(row.market) ?? { name: row.market, assets: [] };
      market.assets.push({
        id: row.id,
        market: row.market,
        asset: row.asset,
        label: row.label,
        state: row.state,
        maintenanceAssetId,
        quantities: row.quantities as CalculatorMappingInput['quantities'],
      });
      marketsByName.set(row.market, market);
    });
    return Array.from(marketsByName.values());
  }

  function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setImportError('');
    if (file && !file.name.toLowerCase().endsWith('.csv')) {
      setImportFile(null);
      setImportError('Choose a CSV file downloaded from this import window.');
      return;
    }
    setImportFile(file);
  }

  async function handleImport() {
    if (!importFile || !effectiveTenantId) return;

    setImporting(true);
    setImportError('');
    setNotice('');

    try {
      const markets = parseImportedMappingsCsv(await importFile.text());
      const response = await importCalculatorMappings(markets, effectiveTenantId);
      const nextMappings = await fetchCalculatorMappings(effectiveTenantId);
      setMappings(nextMappings.mappings);
      resetForm();
      setNotice(response.message);
      setImportDialogOpen(false);
      setImportFile(null);
    } catch (importError) {
      setImportError(importError instanceof Error ? importError.message : 'Unable to import quantity mappings CSV');
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
      maintenanceAssetId: mapping.maintenanceAssetId ?? null,
      quantities: { ...mapping.quantities },
    });
    setMappingDialogOpen(true);
  }

  if (session?.user.role === 'user') {
    return (
      <main className="dense-main mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-violet-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>Only admin and super admin users can manage quantity mappings.</CardDescription>
            <Button onClick={onBack} variant="secondary">Back</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <AdminWorkspaceShell
      activeSection="mappings"
      canAccessManagement
      canAccessShippingCosts={session?.user.role === 'super_admin'}
      canAccessPrintingCosts={session?.user.role === 'super_admin'}
      pageTitle="Quantity Mappings"
      topBarActions={
        <>
          <Button
            className="h-10 min-w-[128px] rounded-md px-4 text-sm font-semibold"
            disabled={importing || !effectiveTenantId}
            onClick={() => {
              setImportError('');
              setImportFile(null);
              setImportDialogOpen(true);
            }}
            type="button"
            variant="outline"
          >
            {importing ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : <Upload className="h-4 w-4" />}
            {importing ? 'Importing...' : 'Import'}
          </Button>
          <Button
            className="h-10 min-w-[130px] rounded-md px-4 text-sm font-semibold btn-theme-primary"
            disabled={!effectiveTenantId || !selectedMarketFilter}
            onClick={openAddMappingDialog}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add Mapping
          </Button>
        </>
      }
      onBack={onBack}
      onOpenLanding={onBack}
      onOpenMappings={() => {}}
      onOpenMaterials={onOpenMaterials}
      onOpenPrintingCosts={onOpenPrintingCosts}
      onOpenSettings={onOpenSettings}
      onOpenSheetSizeSettings={onOpenSheetSizeSettings}
      onOpenShippingCosts={onOpenShippingCosts}
      onOpenShippingSettings={onOpenShippingSettings}
      onOpenTenants={onOpenTenants}
      onOpenUsers={onOpenUsers}
    >
    <main className="dense-main flex min-h-screen w-full flex-col gap-6">
      {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

      <section className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            {canSwitchTenant ? (
              <div className="w-full sm:w-[320px]">
                <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                  <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Tenant</span>
                  <select
                    id="mapping-tenant-filter"
                    className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
                    onChange={(event) => setSelectedTenantId(event.target.value || null)}
                    value={selectedTenantId ?? ''}
                  >
                    {tenants.length === 0 ? <option value="">No tenants available</option> : null}
                    {tenants.map((tenant) => (
                      <option key={`mapping-tenant-${tenant.id}`} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
            <div className="w-full sm:w-[320px]">
              <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Market</span>
              <select
                id="market-filter"
                  className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
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
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : marketOptions.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
              <FileSpreadsheet className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-4 text-base font-semibold text-white">No mapping data yet</p>
              <p className="mt-2 text-sm text-slate-400">Import a CSV template or add records one by one.</p>
            </div>
          ) : filteredMappings.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
              <p className="text-base font-semibold text-white">No assets for this market yet</p>
              <p className="mt-2 text-sm text-slate-400">Choose Add Mapping to create the first asset mapping for {selectedMarketFilter}.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
              <table className="dense-table min-w-[1180px] w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-4 py-3 text-left">Asset</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">Label</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">State</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">Maintenance Asset</th>
                    {allQuantityKeys.map((key) => (
                      <th key={`mapping-head-${key}`} className="border border-slate-700 px-4 py-3 text-center">
                        {formatKeys.includes(key as (typeof formatKeys)[number]) ? formatSheetHeader(key as (typeof formatKeys)[number], sheetNameOverrides) : resolveSheetName(key, sheetNameOverrides)}
                      </th>
                    ))}
                    <th className="sticky right-0 z-20 border border-slate-700 bg-slate-950 px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMappings.map((mapping, rowIndex) => (
                    <tr
                      key={`mapping-row-${mapping.id}`}
                      className={`border-t border-white/5 ${rowIndex % 2 === 0 ? 'bg-[#241c45]/70' : 'bg-[#1a1733]'}`}
                    >
                      <td className="border border-slate-700 px-4 py-3 font-semibold text-white">{mapping.asset}</td>
                      <td className="border border-slate-700 px-4 py-3 text-slate-200">{mapping.label}</td>
                      <td className="border border-slate-700 px-4 py-3 text-slate-300">{mapping.state || '-'}</td>
                      <td className="border border-slate-700 px-4 py-3 text-slate-300">
                        {mapping.maintenanceAssetId ? (mappingById.get(mapping.maintenanceAssetId)?.label ?? mappingById.get(mapping.maintenanceAssetId)?.asset ?? 'Unknown') : '-'}
                      </td>
                      {allQuantityKeys.map((key) => (
                        <td key={`mapping-cell-${mapping.id}-${key}`} className="border border-slate-700 px-4 py-3 text-center font-semibold text-white">
                          {quantityValue(mapping.quantities, key)}
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
      </section>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (importing) return;
          setImportDialogOpen(open);
          if (!open) {
            setImportFile(null);
            setImportError('');
          }
        }}
      >
        <DialogContent style={{ width: 'min(calc(100vw - 2rem), 36rem)' }}>
          <DialogHeader>
            <DialogTitle>Import Quantity Mappings</DialogTitle>
            <DialogDescription>
              Download the CSV containing the current mappings, update existing rows, add records or add custom quantity columns, then upload it here. Matching Market and Asset values are updated; omitted rows are not deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-slate-700 bg-slate-900/70 p-4">
              <p className="text-sm font-semibold text-slate-100">1. Download current mappings</p>
              <p className="mt-1 text-xs text-slate-400">The CSV includes all mappings for the selected tenant and can be edited in Excel or another spreadsheet app.</p>
              <Button className="mt-3" disabled={!effectiveTenantId} onClick={downloadImportTemplate} type="button" variant="secondary">
                <Download className="h-4 w-4" />
                Download Template
              </Button>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-900/70 p-4">
              <p className="text-sm font-semibold text-slate-100">2. Upload updated CSV</p>
              <p className="mt-1 text-xs text-slate-400">Keep the five descriptive columns unchanged. Any additional column is imported as a custom quantity field, and its values must be whole numbers greater than or equal to zero.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button disabled={importing} onClick={() => fileInputRef.current?.click()} type="button" variant="outline">
                  <Upload className="h-4 w-4" />
                  Choose CSV
                </Button>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-300" title={importFile?.name}>
                  {importFile?.name || 'No file selected'}
                </span>
                <input ref={fileInputRef} accept=".csv,text/csv" className="hidden" onChange={handleImportFileChange} type="file" />
              </div>
            </div>

            {importError ? (
              <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
                {importError}
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button disabled={importing} onClick={() => setImportDialogOpen(false)} type="button" variant="ghost">
                Cancel
              </Button>
              <Button className="btn-theme-primary" disabled={importing || !importFile || !effectiveTenantId} onClick={() => void handleImport()} type="button">
                {importing ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : <Upload className="h-4 w-4" />}
                {importing ? 'Importing...' : 'Import CSV'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="mapping-maintenance-asset">Maintenance asset (optional)</Label>
                <select
                  id="mapping-maintenance-asset"
                  className="h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maintenanceAssetId: event.target.value || null,
                    }))
                  }
                  value={form.maintenanceAssetId ?? ''}
                >
                  <option value="">No maintenance asset</option>
                  {maintenanceCandidates.map((candidate) => (
                    <option key={`maintenance-candidate-${candidate.id}`} value={candidate.id}>
                      {candidate.label || candidate.asset}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {allQuantityKeys.map((key) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`qty-${key}`}>
                    {formatKeys.includes(key as (typeof formatKeys)[number]) ? formatSheetHeader(key as (typeof formatKeys)[number], sheetNameOverrides) : resolveSheetName(key, sheetNameOverrides)}
                  </Label>
                  <Input
                    id={`qty-${key}`}
                    inputMode="numeric"
                    onChange={(event) => updateQuantity(key, event.target.value)}
                    value={String((form.quantities as Record<string, number>)[key] ?? 0)}
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
              <Button
                className="btn-theme-primary"
                disabled={saving || !effectiveTenantId}
                onClick={() => void handleSubmit()}
              >
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {saving ? 'Saving...' : editingId ? 'Update Mapping' : 'Add Mapping'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
    </AdminWorkspaceShell>
  );
}
