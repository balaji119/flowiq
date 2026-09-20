import { apiFetchJson, getApiAuthToken } from "../services/apiClient";
import { buildApiUrl } from "../services/apiBase";

export type Product = { id: string; name: string; code?: string };
export type Address = { id: string; name: string; address: string };
export type OrderLine = {
  productId: string;
  productName?: string;
  width: number;
  height: number;
  quantity: number;
  addressId: string;
  address?: string;
  storedName: string;
  fileName: string;
};
export type Order = {
  id: string;
  name: string;
  description: string;
  lines: OrderLine[];
  status: "draft" | "submitting" | "submitted" | "attention";
  revision: number;
  quoteNo: string;
  jobNos: string[];
  error: string;
  createdAt: string;
};
export function orderApi<T>(
  tenantId: string,
  path = "",
  options?: RequestInit,
) {
  return apiFetchJson<T>(
    `/api/orders${path}?tenantId=${encodeURIComponent(tenantId)}`,
    options,
  );
}
export async function uploadOrderArtwork(tenantId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  const headers = new Headers();
  const token = getApiAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(
    buildApiUrl(
      `/api/orders/artworks?tenantId=${encodeURIComponent(tenantId)}`,
    ),
    { method: "POST", headers, body },
  );
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "Unable to upload artwork");
  return payload as { storedName: string; fileName: string };
}
