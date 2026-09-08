type ShippingAsset = {
  id: string;
  creativeImageId?: string;
  creativeImageIds?: Record<string, string>;
  artworkMaterialAssignments?: Record<string, { artworkImageId: string; frameCount: number }[]>;
};

// Apply after quantity overrides so unassigned quantities are not redistributed.
export function shippingLinesWithCreatives<T extends { id: string; breakdown: object }>(
  lines: T[], markets: { assets: ShippingAsset[] }[],
): T[] {
  const assets = new Map(markets.flatMap((market) => market.assets.map((asset) => [asset.id, asset] as const)));
  return lines.map((line) => {
    const asset = assets.get(line.id);
    return { ...line, breakdown: Object.fromEntries(Object.entries(line.breakdown).map(([format, quantity]) => {
      const assignments = asset?.artworkMaterialAssignments?.[format] ?? [];
      const hasCreative = assignments.length > 0
        ? assignments.some((assignment) => assignment.frameCount > 0 && Boolean(assignment.artworkImageId.trim()))
        : Boolean((asset?.creativeImageIds?.[format] || (format === '8-sheet' ? asset?.creativeImageId : '') || '').trim());
      return [format, hasCreative ? quantity : 0];
    })) };
  });
}
