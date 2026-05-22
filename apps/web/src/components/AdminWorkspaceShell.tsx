import { ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, CircleDollarSign, Database, Home, LogOut, MapPin, Settings, Truck, Users } from 'lucide-react';
import { cn } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';

export type AdminWorkspaceSection = 'home' | 'landing' | 'quote' | 'artwork' | 'users' | 'mappings' | 'shipping' | 'shipping-costs' | 'printing-costs' | 'settings';

export type AdminWorkspaceHandlers = {
  onBack?: () => void;
  onOpenHome?: () => void;
  onOpenLanding?: () => void;
  onOpenUsers?: () => void;
  onOpenMappings?: () => void;
  onOpenShippingSettings?: () => void;
  onOpenShippingCosts?: () => void;
  onOpenPrintingCosts?: () => void;
  onOpenSettings?: () => void;
};

type AdminWorkspaceShellProps = AdminWorkspaceHandlers & {
  activeSection: AdminWorkspaceSection;
  canAccessManagement: boolean;
  canAccessShippingCosts: boolean;
  canAccessPrintingCosts: boolean;
  hideHeader?: boolean;
  pageTitle?: string;
  topBarActions?: ReactNode;
  children: ReactNode;
};

type NavItem = {
  id: AdminWorkspaceSection;
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

const SIDEBAR_EXPANDED_STORAGE_KEY = 'adsconnect-sidebar-expanded';

export function AdminWorkspaceShell({
  activeSection,
  canAccessManagement,
  canAccessShippingCosts,
  canAccessPrintingCosts,
  hideHeader,
  pageTitle,
  topBarActions,
  onBack,
  onOpenHome,
  onOpenLanding,
  onOpenUsers,
  onOpenMappings,
  onOpenShippingSettings,
  onOpenShippingCosts,
  onOpenPrintingCosts,
  onOpenSettings,
  children,
}: AdminWorkspaceShellProps) {
  const { session, logout } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [collapsedSidebarHover, setCollapsedSidebarHover] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const savedValue = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
      if (savedValue === '1') {
        setExpanded(true);
      }
    } catch {
      // Ignore storage access issues and keep default.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, expanded ? '1' : '0');
    } catch {
      // Ignore storage access issues.
    }
  }, [expanded]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  function toggleExpanded() {
    setExpanded((current) => !current);
  }

  function initials(name: string) {
    const parts = name
      .split(' ')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
  }

  const items: NavItem[] = [];
  if (onOpenLanding) {
    items.push({ id: 'landing', label: 'Dashboard', icon: <Home className="h-[22px] w-[22px]" />, onClick: onOpenLanding });
  }
  if (canAccessManagement && onOpenUsers) {
    items.push({ id: 'users', label: 'User Management', icon: <Users className="h-[22px] w-[22px]" />, onClick: onOpenUsers });
  }
  if (canAccessManagement && onOpenMappings) {
    items.push({ id: 'mappings', label: 'Quantity Mapping', icon: <Database className="h-[22px] w-[22px]" />, onClick: onOpenMappings });
  }
  if (canAccessManagement && onOpenShippingSettings) {
    items.push({ id: 'shipping', label: 'Shipping Address', icon: <MapPin className="h-[22px] w-[22px]" />, onClick: onOpenShippingSettings });
  }
  if (canAccessManagement && onOpenSettings) {
    items.push({ id: 'settings', label: 'Settings', icon: <Settings className="h-[22px] w-[22px]" />, onClick: onOpenSettings });
  }
  if (canAccessShippingCosts && onOpenShippingCosts) {
    items.push({ id: 'shipping-costs', label: 'Shipping Cost', icon: <Truck className="h-[22px] w-[22px]" />, onClick: onOpenShippingCosts });
  }
  if (canAccessPrintingCosts && onOpenPrintingCosts) {
    items.push({ id: 'printing-costs', label: 'Printing Cost', icon: <CircleDollarSign className="h-[22px] w-[22px]" />, onClick: onOpenPrintingCosts });
  }

  return (
    <main className="flex h-screen w-full overflow-hidden">
      <aside
        className={cn(
          'relative flex h-screen shrink-0 flex-col border-r border-slate-700/75 bg-slate-950/65 transition-[width] duration-200',
          expanded ? 'w-[248px]' : 'w-[66px]',
        )}
        onMouseEnter={() => setCollapsedSidebarHover(true)}
        onMouseLeave={() => setCollapsedSidebarHover(false)}
      >
        <div className={cn('border-b border-slate-700/80', expanded ? 'px-2.5 py-2.5' : 'flex h-[66px] items-center justify-center px-1.5')}>
          {expanded ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-1.5">
                <button
                  className="h-8 w-8 overflow-hidden border border-slate-600 bg-slate-900/90 transition hover:border-orange-300/50"
                  onClick={() => (onOpenHome ?? onOpenLanding)?.()}
                  title="Go to Landing Page"
                  type="button"
                >
                  <img alt="ADS logo" className="h-full w-full object-contain" src="/ads-logo.webp" />
                </button>
                <p className="truncate text-xs font-bold uppercase leading-none tracking-[0.16em] text-orange-300">Connect</p>
              </div>
              <button
                className="rounded-md p-2 text-slate-300 transition-[background-color,color,transform,box-shadow] duration-200 hover:-translate-y-[1px] hover:bg-slate-800 hover:text-white hover:shadow-[0_5px_12px_rgba(15,23,42,0.28)]"
                onClick={toggleExpanded}
                title="Collapse sidebar"
                type="button"
              >
                <ChevronRight className="h-4 w-4 rotate-180 transition-transform" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <button
                className="h-10 w-10 overflow-hidden border border-slate-600 bg-slate-900/90 transition hover:border-orange-300/50"
                onClick={() => (onOpenHome ?? onOpenLanding)?.()}
                title="Go to Landing Page"
                type="button"
              >
                <img alt="ADS logo" className="h-full w-full object-contain" src="/ads-logo.webp" />
              </button>
            </div>
          )}
        </div>

        {!expanded ? (
          <button
            className={cn(
              'absolute left-full top-[64px] z-20 -translate-x-1/2 rounded-full border border-slate-300/80 bg-slate-200 p-1.5 text-slate-700 shadow-md transition-all duration-150 hover:bg-white',
              collapsedSidebarHover ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
            )}
            onClick={toggleExpanded}
            title="Expand sidebar"
            type="button"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}

        <nav className="flex-1 space-y-2.5 py-2">
          {items
            .filter((item) => (item.id === 'shipping-costs' ? canAccessShippingCosts : true))
            .map((item) => {
              const active = item.id === activeSection;
              return (
                <button
                  key={item.id}
                  className={cn(
                    'flex items-center rounded-md text-[8px] font-semibold uppercase leading-none tracking-[0.02em] transition-[background-color,border-color,color,transform,box-shadow] duration-200 [&_svg]:transition-opacity [&_svg]:duration-200',
                    expanded ? 'h-11 w-full justify-start gap-2.5 px-2.5' : 'mx-auto h-11 w-11 justify-center',
                    active
                      ? 'border border-orange-300/35 bg-gradient-to-r from-orange-500/20 to-transparent text-white shadow-[0_0_0_1px_rgba(251,146,60,0.22),0_6px_14px_rgba(15,23,42,0.28)] [&_svg]:opacity-100'
                      : 'border border-transparent text-slate-400 [&_svg]:opacity-80 hover:-translate-y-[1px] hover:border-white/10 hover:bg-slate-800/65 hover:text-white hover:shadow-[0_6px_14px_rgba(15,23,42,0.24)] hover:[&_svg]:opacity-100',
                  )}
                  onClick={item.onClick}
                  title={!expanded ? item.label : undefined}
                  type="button"
                >
                  {item.icon}
                  {expanded ? <span className="truncate text-[12px]">{item.label}</span> : null}
                </button>
              );
            })}
        </nav>

        {onBack ? (
          <div className="border-t border-slate-700/80 p-2">
            <button
              className={cn(
                'flex w-full items-center rounded-md px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800/80 hover:text-white',
                expanded ? 'justify-start gap-3' : 'justify-center',
              )}
              onClick={onBack}
              title={!expanded ? 'Back' : undefined}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              {expanded ? <span>Back</span> : null}
            </button>
          </div>
        ) : null}

        <div className="border-t border-slate-700/80 p-2" ref={profileMenuRef}>
          <div className="relative">
            {profileMenuOpen ? (
              <div
                className={cn(
                  'absolute z-30 rounded-md border border-slate-700 bg-slate-900/95 p-1 shadow-xl',
                  expanded ? 'bottom-full left-0 right-0 mb-2' : 'bottom-0 left-full ml-2 w-56',
                )}
              >
                <div className="rounded-md px-3 py-2 text-left">
                  <p className="truncate text-sm font-semibold text-white">{session?.user.name || 'User'}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {session?.user.role ? session.user.role.replace('_', ' ') : 'user'} - {session?.user.tenantName || 'Tenant'}
                  </p>
                </div>
                <div className="my-1 h-px bg-slate-700/80" />
                <button
                  className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    void logout();
                  }}
                  type="button"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            ) : null}

            <button
              className={cn(
                'flex w-full items-center rounded-md border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-slate-200 transition hover:bg-slate-800/80 hover:text-white',
                expanded ? 'gap-2.5' : 'justify-center',
              )}
              onClick={() => setProfileMenuOpen((current) => !current)}
              title={!expanded ? session?.user.name || 'User' : undefined}
              type="button"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-xs font-bold">
                {initials(session?.user.name || 'User')}
              </span>
              {expanded ? (
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-semibold">{session?.user.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">{session?.user.tenantName || 'Tenant'}</span>
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex h-screen flex-1 flex-col overflow-hidden">
        {!hideHeader ? (
        <header className="shrink-0">
          <div className="border-b border-white/10 bg-slate-900/62 backdrop-blur">
            <div
              aria-label="ADS Connect positioning statement"
              className="grid min-h-[62px] grid-cols-1 gap-0.5 px-6 py-1.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-3"
              role="region"
            >
              <h1 className="whitespace-nowrap text-[28px] font-bold leading-none tracking-tight text-white [text-rendering:geometricPrecision]">ADS Connect</h1>
              <div className="min-w-0 border-l-0 border-white/10 pl-0 sm:border-l sm:pl-4">
                <p className="text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-400/45">Powered by ADS</p>
                <h2 className="mt-0.5 text-[14px] font-semibold leading-tight tracking-tight text-slate-100/90 [text-rendering:geometricPrecision]">Turn Hours into Minutes</h2>
                <p className="mt-1 max-w-[500px] text-[11px] leading-[1.35] text-slate-300/70">
                  Integrated with REV360 for faster campaign delivery and workflow automation.
                </p>
              </div>
            </div>
          </div>
          <div className="border-b border-orange-500/22 bg-gradient-to-r from-slate-800/92 via-slate-800/88 to-orange-500/14">
            <div className="flex min-h-[48px] items-center justify-between gap-3 px-6">
              <h2 className="truncate text-lg font-semibold tracking-tight text-slate-100">{pageTitle || 'Workspace'}</h2>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
                <div className="min-w-0 flex-1 text-center text-slate-300/80" id="workspace-topbar-center-slot" />
                <div aria-label="Workspace actions" className="flex flex-wrap items-center justify-end gap-3" id="workspace-topbar-actions-slot">
                  {topBarActions}
                </div>
              </div>
            </div>
          </div>
        </header>
        ) : null}
        <div className="flowiq-dialog-blur-target min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
        <div className="shrink-0" id="workspace-bottom-bar-slot" />
      </section>
    </main>
  );
}
