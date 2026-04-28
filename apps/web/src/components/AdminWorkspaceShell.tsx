import { ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, CircleDollarSign, Database, Home, LogOut, MapPin, Truck, Users } from 'lucide-react';
import { cn } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';

export type AdminWorkspaceSection = 'landing' | 'quote' | 'artworks' | 'users' | 'mappings' | 'shipping' | 'shipping-costs' | 'printing-costs';

export type AdminWorkspaceHandlers = {
  onBack?: () => void;
  onOpenLanding?: () => void;
  onOpenUsers?: () => void;
  onOpenMappings?: () => void;
  onOpenShippingSettings?: () => void;
  onOpenShippingCosts?: () => void;
  onOpenPrintingCosts?: () => void;
};

type AdminWorkspaceShellProps = AdminWorkspaceHandlers & {
  activeSection: AdminWorkspaceSection;
  canAccessManagement: boolean;
  canAccessShippingCosts: boolean;
  canAccessPrintingCosts: boolean;
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

export function AdminWorkspaceShell({
  activeSection,
  canAccessManagement,
  canAccessShippingCosts,
  canAccessPrintingCosts,
  pageTitle,
  topBarActions,
  onBack,
  onOpenLanding,
  onOpenUsers,
  onOpenMappings,
  onOpenShippingSettings,
  onOpenShippingCosts,
  onOpenPrintingCosts,
  children,
}: AdminWorkspaceShellProps) {
  const { session, logout } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [collapsedSidebarHover, setCollapsedSidebarHover] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

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
          'relative flex h-screen shrink-0 flex-col border-r border-slate-700/80 bg-slate-950/65 transition-[width] duration-200',
          expanded ? 'w-64' : 'w-[74px]',
        )}
        onMouseEnter={() => setCollapsedSidebarHover(true)}
        onMouseLeave={() => setCollapsedSidebarHover(false)}
      >
        <div className={cn('border-b border-slate-700/80', expanded ? 'px-3 py-2.5' : 'flex h-[74px] items-center justify-center px-2')}>
          {expanded ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold uppercase tracking-[0.2em] text-slate-100">ADS CONNECT</p>
              </div>
              <button
                className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
                onClick={toggleExpanded}
                title="Collapse sidebar"
                type="button"
              >
                <ChevronRight className="h-4 w-4 rotate-180 transition-transform" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-600 bg-slate-900/90 text-sm font-bold uppercase tracking-[0.1em] text-slate-100">
                ADS
              </div>
            </div>
          )}
        </div>

        {!expanded ? (
          <button
            className={cn(
              'absolute left-full top-[72px] z-20 -translate-x-1/2 rounded-full border border-slate-300/80 bg-slate-200 p-1.5 text-slate-700 shadow-md transition-all duration-150 hover:bg-white',
              collapsedSidebarHover ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
            )}
            onClick={toggleExpanded}
            title="Expand sidebar"
            type="button"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}

        <nav className="flex-1 space-y-1 p-2">
          {items
            .filter((item) => (item.id === 'shipping-costs' ? canAccessShippingCosts : true))
            .map((item) => {
              const active = item.id === activeSection;
              return (
                <button
                  key={item.id}
                  className={cn(
                    'flex items-center rounded-xl text-sm font-semibold transition',
                    expanded ? 'w-full justify-start gap-3 px-3 py-2.5' : 'mx-auto h-12 w-12 justify-center',
                    active
                      ? 'bg-slate-800 text-white shadow-[inset_0_0_0_1px_rgba(148,163,184,0.35)]'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                  )}
                  onClick={item.onClick}
                  title={!expanded ? item.label : undefined}
                  type="button"
                >
                  {item.icon}
                  {expanded ? <span className="truncate">{item.label}</span> : null}
                </button>
              );
            })}
        </nav>

        {onBack ? (
          <div className="border-t border-slate-700/80 p-2">
            <button
              className={cn(
                'flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800/80 hover:text-white',
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
                <div className="rounded-lg px-3 py-2 text-left">
                  <p className="truncate text-sm font-semibold text-white">{session?.user.name || 'User'}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {session?.user.role ? session.user.role.replace('_', ' ') : 'user'} - {session?.user.tenantName || 'Tenant'}
                  </p>
                </div>
                <div className="my-1 h-px bg-slate-700/80" />
                <button
                  className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
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

      <section className="min-w-0 flex-1 overflow-y-auto">
        {pageTitle || topBarActions ? (
          <header className="border-b border-slate-700/80 bg-slate-900/70 backdrop-blur">
            <div className="flex min-h-[72px] items-center justify-between gap-3 px-6">
              <h1 className="truncate text-3xl font-semibold tracking-tight text-white">{pageTitle || ''}</h1>
              {topBarActions ? <div className="flex flex-wrap items-center justify-end gap-2">{topBarActions}</div> : null}
            </div>
          </header>
        ) : null}
        {children}
      </section>
    </main>
  );
}

