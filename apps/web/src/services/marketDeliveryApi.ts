import { MarketAssetPrintingCostRecord, MarketAssetShippingCostRecord, MarketDeliveryAddressInput, MarketDeliveryAddressRecord, MarketShippingRateRecord } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

function withTenant(path: string, tenantId?: string | null) {
  if (!tenantId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

export async function fetchCampaignMarketDeliveryAddresses(tenantId?: string | null) {
  return apiFetchJson<{ addresses: MarketDeliveryAddressRecord[] }>(withTenant('/api/market-delivery-addresses', tenantId));
}

export async function fetchCampaignMarketShippingRates(tenantId?: string | null) {
  return apiFetchJson<{ rates: MarketShippingRateRecord[] }>(withTenant('/api/market-shipping-rates', tenantId));
}

export async function fetchCampaignMarketAssetPrintingCosts(tenantId?: string | null) {
  return apiFetchJson<{ costs: MarketAssetPrintingCostRecord[] }>(withTenant('/api/market-asset-printing-costs', tenantId));
}

export async function fetchCampaignMarketAssetShippingCosts(tenantId?: string | null) {
  return apiFetchJson<{ costs: MarketAssetShippingCostRecord[] }>(withTenant('/api/market-asset-shipping-costs', tenantId));
}

export async function upsertCampaignMarketDeliveryAddress(payload: MarketDeliveryAddressInput, tenantId?: string | null) {
  return apiFetchJson<{ address: MarketDeliveryAddressRecord }>(withTenant('/api/market-delivery-addresses', tenantId), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
