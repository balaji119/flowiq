import type { OrderFormValues } from './types';

export const CREATIVE_NAMES_REQUIRED = 'Assign a creative name to every artwork before submitting to PrintIQ or downloading visuals or installs.';

export function creativeNameValidationError(values: Pick<OrderFormValues, 'printImages' | 'creativeNameAssignments'>): string {
  const images = new Set(values.printImages.map((image) => image.id));
  const assignedImages = new Set<string>();
  const assignedNumbers = new Set<number>();
  for (const [name, imageId] of Object.entries(values.creativeNameAssignments ?? {})) {
    // Deleted artworks must not reserve names.
    if (!images.has(imageId)) continue;
    const match = /^Creative([1-9]\d*)$/.exec(name);
    if (!match || !Number.isSafeInteger(Number(match[1])) || assignedImages.has(imageId) || assignedNumbers.has(Number(match[1]))) {
      return 'Each artwork must have one unique creative name. Clear duplicate or invalid assignments first.';
    }
    assignedImages.add(imageId);
    assignedNumbers.add(Number(match[1]));
  }
  return images.size > 0 && assignedImages.size === images.size ? '' : CREATIVE_NAMES_REQUIRED;
}

export function assignCreativeName(assignments: Record<string, string>, imageIds: string[], imageId: string, name: string): { assignments: Record<string, string>; error: string } {
  const images = new Set(imageIds);
  if (!images.has(imageId)) return { assignments, error: 'This artwork is no longer available.' };
  const active = Object.fromEntries(Object.entries(assignments).filter(([, id]) => images.has(id)));
  if (name && (!/^Creative([1-9]\d*)$/.test(name) || !Number.isSafeInteger(Number(name.slice(8))))) return { assignments, error: 'Select a valid creative name.' };
  if (name && active[name] && active[name] !== imageId) {
    return { assignments, error: `${name} is already chosen. Clear it from the other artwork first.` };
  }
  const next = Object.fromEntries(Object.entries(active).filter(([, id]) => id !== imageId));
  if (name) next[name] = imageId;
  return { assignments: next, error: '' };
}
