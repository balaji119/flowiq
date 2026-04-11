import { MarketDeliveryAddressInput, MarketDeliveryAddressRecord, MarketShippingRateRecord } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

export async function fetchCampaignMarketDeliveryAddresses() {
  return apiFetchJson<{ addresses: MarketDeliveryAddressRecord[] }>('/api/market-delivery-addresses');
}

export async function fetchCampaignMarketShippingRates() {
  return apiFetchJson<{ rates: MarketShippingRateRecord[] }>('/api/market-shipping-rates');
}

export async function upsertCampaignMarketDeliveryAddress(payload: MarketDeliveryAddressInput) {
  return apiFetchJson<{ address: MarketDeliveryAddressRecord }>('/api/market-delivery-addresses', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
