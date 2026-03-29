import { MarketDeliveryAddressRecord } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

export async function fetchCampaignMarketDeliveryAddresses() {
  return apiFetchJson<{ addresses: MarketDeliveryAddressRecord[] }>('/api/market-delivery-addresses');
}
