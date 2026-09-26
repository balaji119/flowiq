import { AnchorHTMLAttributes } from 'react';

// Only ordinary left clicks use the app's navigation and unsaved-change guards.
// Let the browser handle modified clicks, middle clicks and the context menu.
export function NavigationLink({ onNavigate, disabled, children, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'onClick'> & {
  onNavigate: () => void;
  disabled?: boolean;
}) {
  return (
    <a
      {...props}
      href={disabled ? undefined : props.href}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (props.target && props.target !== '_self') return;
        event.preventDefault();
        onNavigate();
      }}
    >
      {children}
    </a>
  );
}

export function navigationUrl(view: string, options: { tenantId?: string | null; campaignId?: string; previewCampaignId?: string } = {}) {
  const params = new URLSearchParams({ view });
  const tenantId = options.tenantId === undefined && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('tenantId') : options.tenantId;
  if (tenantId) params.set('tenantId', tenantId);
  if (options.campaignId) params.set('campaignId', options.campaignId);
  if (options.previewCampaignId) params.set('previewCampaignId', options.previewCampaignId);
  return `?${params.toString()}`;
}
