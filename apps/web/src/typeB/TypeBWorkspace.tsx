import { useEffect, useState } from "react";
import { TenantRecord } from "@flowiq/shared";
import {
  Building2,
  ChevronDown,
  Home,
  Users,
  MapPin,
  Package,
  LogOut,
} from "lucide-react";
import { EmbeddedWorkspaceContext } from "../components/AdminWorkspaceShell";
import { useAuth } from "../context/AuthContext";
import { UserManagementScreen } from "../screens/UserManagementScreen";
import { TenantManagementScreen } from "../screens/TenantManagementScreen";
import { OrderCatalog } from "./OrderCatalog";
import { OrderDashboard, OrderEditor } from "./OrderScreens";
import "./typeB.css";

type View =
  | "landing"
  | "quote"
  | "material-mapping"
  | "shipping"
  | "users"
  | "tenants";
export function TypeBWorkspace({
  tenant,
  tenants,
  view,
  orderId,
  onNavigate,
  onSelectTenant,
  onTenantsChanged,
}: {
  tenant: TenantRecord;
  tenants: TenantRecord[];
  view: string;
  orderId: string | null;
  onNavigate: (view: View, orderId?: string) => void;
  onSelectTenant: (id: string) => void;
  onTenantsChanged: () => void;
}) {
  const { session, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const superAdmin = session?.user.role === "super_admin";
  const manager = session?.user.role !== "user";
  useEffect(() => {
    document.body.classList.add("type-b-active");
    return () => document.body.classList.remove("type-b-active");
  }, []);
  const links = [
    { id: "landing" as View, label: "Dashboard", icon: Home },
    ...(manager
      ? [{ id: "users" as View, label: "User Management", icon: Users }]
      : []),
    ...(superAdmin
      ? [{ id: "tenants" as View, label: "Tenant Management", icon: Building2 }]
      : []),
    ...(manager
      ? [{ id: "shipping" as View, label: "Shipping Address", icon: MapPin }]
      : []),
    ...(superAdmin
      ? [
          {
            id: "material-mapping" as View,
            label: "Product mapping",
            icon: Package,
          },
        ]
      : []),
  ];
  const title =
    view === "quote"
      ? orderId
        ? "Order details"
        : "Create order"
      : (links.find((link) => link.id === view)?.label ?? "Dashboard");
  let content;
  if (view === "quote")
    content = (
      <OrderEditor
        key={orderId ?? "new"}
        tenantId={tenant.id}
        orderId={orderId}
        onBack={() => onNavigate("landing")}
        onBusy={setBusy}
        onSaved={(id) => onNavigate("quote", id)}
      />
    );
  else if (view === "users" && manager)
    content = (
      <UserManagementScreen
        tenantId={tenant.id}
        onBack={() => onNavigate("landing")}
      />
    );
  else if (view === "tenants" && superAdmin)
    content = (
      <TenantManagementScreen
        onBack={() => onNavigate("landing")}
        onTenantsChanged={onTenantsChanged}
      />
    );
  else if (view === "shipping" && manager)
    content = (
      <OrderCatalog key="addresses" tenantId={tenant.id} kind="addresses" />
    );
  else if (view === "material-mapping" && superAdmin)
    content = (
      <OrderCatalog key="products" tenantId={tenant.id} kind="products" />
    );
  else
    content = (
      <OrderDashboard
        tenantId={tenant.id}
        onCreate={() => onNavigate("quote")}
        onOpen={(id) => onNavigate("quote", id)}
      />
    );
  return (
    <div className="type-b-workspace">
      <aside className="b-sidebar">
        <button
          className="b-brand"
          disabled={busy}
          onClick={() => onNavigate("landing")}
          aria-label="Captive Vision dashboard"
        >
          <img src="/captive-vision.svg" alt="Captive Vision" />
          <span>ORDER PORTAL</span>
        </button>
        <nav aria-label="Main navigation">
          {links.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              disabled={busy}
              aria-current={
                view === id ||
                (id === "landing" && ["home", "quote"].includes(view))
                  ? "page"
                  : undefined
              }
              onClick={() => onNavigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="b-profile">
          <strong>{session?.user.name}</strong>
          <small>{session?.user.role.replace("_", " ")}</small>
          <button disabled={busy} onClick={() => void logout()}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <div className="b-main">
        <header className="b-header">
          <div>
            <p>CAPTIVE VISION</p>
            <h1>{title}</h1>
          </div>
          {superAdmin ? (
            <label className={`b-tenant-switcher${busy ? " is-disabled" : ""}`}>
              <span className="b-tenant-icon" aria-hidden="true">
                <Building2 size={18} />
              </span>
              <span className="b-tenant-copy" aria-hidden="true">
                <span className="b-tenant-label">Tenant</span>
                <span className="b-tenant-name" title={tenant.name}>
                  {tenant.name}
                </span>
              </span>
              <ChevronDown
                className="b-tenant-chevron"
                size={16}
                aria-hidden="true"
              />
              <select
                aria-label="Switch tenant"
                disabled={busy}
                value={tenant.id}
                onChange={(event) => onSelectTenant(event.target.value)}
              >
                {tenants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span>{tenant.name}</span>
          )}
        </header>
        <main className="b-content">
          <EmbeddedWorkspaceContext.Provider value={true}>
            {content}
          </EmbeddedWorkspaceContext.Provider>
        </main>
      </div>
    </div>
  );
}
