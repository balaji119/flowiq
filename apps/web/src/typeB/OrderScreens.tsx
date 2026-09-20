import { FormEvent, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@flowiq/ui";
import { FileImage, Plus, Search } from "lucide-react";
import { buildApiUrl } from "../services/apiBase";
import {
  Address,
  Order,
  OrderLine,
  Product,
  orderApi,
  uploadOrderArtwork,
} from "./api";

export function OrderDashboard({
  tenantId,
  onCreate,
  onOpen,
}: {
  tenantId: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    orderApi<{ orders: Order[] }>(tenantId)
      .then((result) => {
        if (active) setOrders(result.orders);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId]);
  const visible = orders.filter((order) =>
    `${order.name} ${order.description} ${order.quoteNo}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="b-section">
      <div className="b-toolbar">
        <label className="b-search">
          <Search size={18} />
          <input
            aria-label="Search orders"
            placeholder="Search orders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="b-primary" onClick={onCreate}>
          <Plus size={18} /> Create orders
        </button>
      </div>
      {error && (
        <p role="alert" className="b-error">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading orders...</p>
      ) : (
        <div className="b-table-wrap">
          <table className="b-table">
            <thead>
              <tr>
                <th>Order name</th>
                <th>Description</th>
                <th>Quote</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => (
                <tr key={order.id}>
                  <td>
                    <button className="b-link" onClick={() => onOpen(order.id)}>
                      {order.name}
                    </button>
                    {order.status === "draft" && (
                      <span className="b-draft-badge">Draft</span>
                    )}
                  </td>
                  <td>{order.description || "—"}</td>
                  <td>{order.quoteNo || "—"}</td>
                  <td>
                    {new Date(order.createdAt).toLocaleDateString("en-AU")}
                  </td>
                  <td>
                    <button onClick={() => onOpen(order.id)}>
                      {order.status === "draft" ? "Resume draft" : "View order"}
                    </button>
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={5} className="b-empty">
                    {query
                      ? "No matching orders."
                      : "No orders yet. Create your first order to get started."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const blankLine = (): OrderLine => ({
  productId: "",
  width: 0,
  height: 0,
  quantity: 1,
  addressId: "",
  storedName: "",
  fileName: "",
});
export function OrderEditor({
  tenantId,
  orderId,
  onBack,
  onBusy,
  onSaved,
}: {
  tenantId: string;
  orderId: string | null;
  onBack: () => void;
  onBusy: (busy: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<OrderLine>(blankLine);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const working = submitting || savingDraft;
  const [result, setResult] = useState<Order | null>(null);
  const requestId = useRef<string>(orderId ?? crypto.randomUUID());
  const savedSnapshot = useRef(
    JSON.stringify({ name: "", description: "", lines: [] }),
  );
  const submissionLock = useRef(false);
  const readonly = Boolean(
    (orderId && !result) || (result && result.status !== "draft"),
  );
  const dirty =
    JSON.stringify({ name, description, lines }) !== savedSnapshot.current;
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let loadCatalog = true;
        if (orderId) {
          const response = await orderApi<{ orders: Order[] }>(tenantId);
          const order = response.orders.find((item) => item.id === orderId);
          if (!order) throw new Error("Order not found");
          loadCatalog = order.status === "draft";
          if (active) {
            setName(order.name);
            setDescription(order.description);
            setLines(order.lines);
            setResult(order);
            requestId.current = order.id;
            savedSnapshot.current = JSON.stringify({
              name: order.name,
              description: order.description,
              lines: order.lines,
            });
          }
        }
        if (loadCatalog) {
          const [p, a] = await Promise.all([
            orderApi<{ items: Product[] }>(tenantId, "/products"),
            orderApi<{ items: Address[] }>(tenantId, "/addresses"),
          ]);
          if (active) {
            setProducts(p.items);
            setAddresses(a.items);
          }
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "Unable to load order");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [tenantId, orderId]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (working || saving || (!readonly && dirty)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [working, saving, readonly, dirty]);
  function edit(index: number | null) {
    setEditing(index);
    setDraft(index === null ? blankLine() : { ...lines[index] });
    setFile(null);
    setDialogError("");
    setOpen(true);
  }
  async function saveLine(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!file && !draft.storedName) {
      setDialogError("Choose an artwork file.");
      return;
    }
    setSaving(true);
    onBusy(true);
    setDialogError("");
    try {
      const artwork = file
        ? await uploadOrderArtwork(tenantId, file)
        : { storedName: draft.storedName, fileName: draft.fileName };
      const line = {
        ...draft,
        ...artwork,
        productName: products.find((p) => p.id === draft.productId)?.name,
        address: addresses.find((a) => a.id === draft.addressId)?.address,
      };
      setLines((current) =>
        editing === null
          ? [...current, line]
          : current.map((item, index) => (index === editing ? line : item)),
      );
      setOpen(false);
    } catch (err) {
      setDialogError(
        err instanceof Error ? err.message : "Unable to save artwork",
      );
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }
  async function saveDraft() {
    if (submissionLock.current || readonly) return;
    submissionLock.current = true;
    setSavingDraft(true);
    onBusy(true);
    setError("");
    try {
      const { order } = await orderApi<{ order: Order }>(tenantId, "/drafts", {
        method: "PUT",
        body: JSON.stringify({
          id: requestId.current,
          revision: result?.revision ?? 0,
          name,
          description,
          lines,
        }),
      });
      setName(order.name);
      setDescription(order.description);
      setLines(order.lines);
      setResult(order);
      savedSnapshot.current = JSON.stringify({
        name: order.name,
        description: order.description,
        lines: order.lines,
      });
      if (!orderId) onSaved(order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save draft");
    } finally {
      submissionLock.current = false;
      setSavingDraft(false);
      onBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submissionLock.current || readonly) return;
    if (!lines.length) {
      setError("Add at least one artwork.");
      return;
    }
    submissionLock.current = true;
    setSubmitting(true);
    onBusy(true);
    setError("");
    try {
      const response = await orderApi<{ order: Order }>(tenantId, "", {
        method: "POST",
        body: JSON.stringify({
          id: requestId.current,
          revision: result?.revision ?? 0,
          name,
          description,
          lines,
        }),
      });
      setResult(response.order);
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "Unable to create order"}. If the request was received, it will appear on the dashboard.`,
      );
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
      onBusy(false);
    }
  }
  if (loading) return <p>Loading...</p>;
  return (
    <section className="b-section">
      <form className="b-form" onSubmit={submit}>
        <div className="b-toolbar">
          <button type="button" disabled={saving || working} onClick={onBack}>
            ← Back to orders
          </button>
          {result?.quoteNo && (
            <span className="b-quote">Quote {result.quoteNo}</span>
          )}
        </div>
        {error && (
          <p className="b-error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p
            className={
              result.status === "draft"
                ? "b-info"
                : result.status === "submitted"
                  ? "b-success"
                  : "b-error"
            }
            role="status"
          >
            {result.status === "draft"
              ? dirty
                ? "Draft — you have unsaved changes."
                : "Draft saved. You can finish this order now or resume it later from the dashboard."
              : result.status === "submitted"
                ? `Order created successfully. ${result.jobNos?.length ? `Jobs: ${result.jobNos.join(", ")}` : ""}`
                : result.error ||
                  "Submission is being processed. Check PrintIQ before creating another order."}
          </p>
        )}
        <fieldset disabled={readonly || working} className="b-form b-card">
          <label>
            Name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </fieldset>
        <section className="b-card">
          <div className="b-toolbar">
            <div>
              <h2>Manage artwork</h2>
              <p>Artwork, product specifications and delivery details.</p>
            </div>
            {!readonly && (
              <button
                type="button"
                className="b-primary"
                disabled={working || lines.length >= 100}
                onClick={() => edit(null)}
              >
                <Plus size={18} /> Add artwork
              </button>
            )}
          </div>
          {!readonly && (!products.length || !addresses.length) && (
            <p className="b-info">
              {!products.length
                ? "Ask a super admin to add product mappings. "
                : ""}
              {!addresses.length
                ? "Ask an admin to add a shipping address."
                : ""}
            </p>
          )}
          {!lines.length ? (
            <div className="b-empty">
              <FileImage size={32} />
              <p>Add artwork to start building your order.</p>
            </div>
          ) : (
            <div className="b-artwork-grid">
              {lines.map((line, index) => (
                <article
                  className="b-artwork"
                  key={`${line.storedName}-${index}`}
                >
                  <div className="b-artwork-preview">
                    {/\.(png|jpe?g)$/i.test(line.storedName) ? (
                      <img
                        src={buildApiUrl(
                          `/api/campaign-images/${encodeURIComponent(line.storedName)}`,
                        )}
                        alt={line.fileName}
                      />
                    ) : (
                      <FileImage size={42} />
                    )}
                  </div>
                  <div className="b-artwork-body">
                    <h3>{line.productName}</h3>
                    <a
                      href={buildApiUrl(
                        `/api/campaign-images/${encodeURIComponent(line.storedName)}/download`,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {line.fileName}
                    </a>
                    <dl>
                      <div>
                        <dt>Size</dt>
                        <dd>
                          {line.width} × {line.height} mm
                        </dd>
                      </div>
                      <div>
                        <dt>Quantity</dt>
                        <dd>{line.quantity}</dd>
                      </div>
                    </dl>
                    <p className="b-preline">{line.address}</p>
                    {!readonly && (
                      <div className="b-actions">
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => edit(index)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={working}
                          onClick={() =>
                            setLines((current) =>
                              current.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        {!readonly && (
          <div className="b-submit">
            <button
              type="button"
              disabled={working || saving}
              onClick={() => void saveDraft()}
            >
              {savingDraft ? "Saving draft..." : "Save Draft"}
            </button>
            <button
              className="b-primary"
              disabled={working || saving || !lines.length}
            >
              {submitting ? "Creating order..." : "Create Order"}
            </button>
          </div>
        )}
      </form>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
      >
        <DialogContent className="b-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing === null ? "Add artwork" : "Edit artwork"}
            </DialogTitle>
          </DialogHeader>
          <form className="b-form" onSubmit={saveLine}>
            {dialogError && (
              <p role="alert" className="b-error">
                {dialogError}
              </p>
            )}
            <fieldset disabled={saving} className="b-form">
              <div className="b-grid">
                <label>
                  Width (mm)
                  <input
                    type="number"
                    min="0.01"
                    max="100000"
                    step="0.01"
                    required
                    value={draft.width || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, width: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Height (mm)
                  <input
                    type="number"
                    min="0.01"
                    max="100000"
                    step="0.01"
                    required
                    value={draft.height || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, height: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label>
                Product
                <select
                  required
                  value={draft.productId}
                  onChange={(e) =>
                    setDraft({ ...draft, productId: e.target.value })
                  }
                >
                  <option value="">Select product</option>
                  {products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Artwork
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  required={!draft.storedName}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {draft.fileName && !file && (
                <small>Current file: {draft.fileName}</small>
              )}
              <small>PDF, PNG or JPEG · Up to 250 MB</small>
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  required
                  value={draft.quantity || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, quantity: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Address
                <select
                  required
                  value={draft.addressId}
                  onChange={(e) =>
                    setDraft({ ...draft, addressId: e.target.value })
                  }
                >
                  <option value="">Select shipping address</option>
                  {addresses.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name} — {a.address.split("\n")[1]}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <div className="b-actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="b-primary" disabled={saving}>
                {saving ? "Uploading artwork..." : "Save"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
