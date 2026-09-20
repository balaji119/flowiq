import { FormEvent, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@flowiq/ui";
import { Address, orderApi, Product } from "./api";

type Entry = Product & Partial<Address>;
const empty = {
  name: "",
  code: "",
  street: "",
  suburb: "",
  state: "",
  postcode: "",
  phone: "",
  notes: "",
};
export function OrderCatalog({
  tenantId,
  kind,
}: {
  tenantId: string;
  kind: "products" | "addresses";
}) {
  const products = kind === "products";
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(empty);
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);
  const load = async () => {
    const result = await orderApi<{ items: Entry[] }>(tenantId, `/${kind}`);
    setItems(result.items);
  };
  useEffect(() => {
    let active = true;
    orderApi<{ items: Entry[] }>(tenantId, `/${kind}`)
      .then((result) => {
        if (active) setItems(result.items);
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
  }, [tenantId, kind]);
  function edit(item?: Entry) {
    setEditing(item?.id ?? null);
    setDialogError("");
    const lines = item?.address?.split("\n") ?? [];
    const locality = lines[2]?.match(/^(.*?)\s+(\S+)\s+(\S+)$/);
    setDraft({
      ...empty,
      name: item?.name ?? "",
      code: item?.code ?? "",
      street: lines[1] ?? "",
      suburb: locality?.[1] ?? "",
      state: locality?.[2] ?? "",
      postcode: locality?.[3] ?? "",
      phone: lines.find((line) => line.startsWith("Phone: "))?.slice(7) ?? "",
      notes: lines.find((line) => line.startsWith("Notes: "))?.slice(7) ?? "",
    });
    setOpen(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setDialogError("");
    try {
      const address = [
        draft.name.trim(),
        draft.street.trim(),
        `${draft.suburb.trim()} ${draft.state.trim()} ${draft.postcode.trim()}`,
        `Phone: ${draft.phone.trim()}`,
        `Notes: ${draft.notes.trim().replaceAll("\n", " ")}`,
        "Australia",
      ].join("\n");
      await orderApi(tenantId, `/${kind}`, {
        method: "PUT",
        body: JSON.stringify({
          id: editing,
          name: draft.name,
          ...(products ? { code: draft.code } : { address }),
        }),
      });
      await load();
      setOpen(false);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Unable to save");
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!pendingDelete) return;
    setSaving(true);
    setDialogError("");
    try {
      await orderApi(tenantId, `/${kind}`, {
        method: "DELETE",
        body: JSON.stringify({ id: pendingDelete.id }),
      });
      await load();
      setPendingDelete(null);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Unable to delete");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="b-section">
      <div className="b-toolbar">
        <p>
          {products
            ? "Manage the products available when creating an order."
            : "Manage delivery destinations for your orders."}
        </p>
        <button className="b-primary" onClick={() => edit()}>
          + Add {products ? "product" : "address"}
        </button>
      </div>
      {error && (
        <p role="alert" className="b-error">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="b-table-wrap">
          <table className="b-table">
            <thead>
              <tr>
                <th>{products ? "Product name" : "Name"}</th>
                <th>{products ? "Product code" : "Shipping address"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>
                    <div className="b-row">
                      <span className="b-preline">
                        {products ? item.code : item.address}
                      </span>
                      <div className="b-actions">
                        <button
                          onClick={() => edit(item)}
                          aria-label={`Edit ${item.name}`}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            setDialogError("");
                            setPendingDelete(item);
                          }}
                          aria-label={`Delete ${item.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={2} className="b-empty">
                    No {kind} yet. Add one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
      >
        <DialogContent className="b-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit" : "Add"}{" "}
              {products ? "product" : "shipping address"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="b-form">
            {dialogError && (
              <p className="b-error" role="alert">
                {dialogError}
              </p>
            )}
            <label>
              {products ? "Product name" : "Name"}
              <input
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            {products ? (
              <label>
                Product code
                <input
                  required
                  maxLength={200}
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                />
              </label>
            ) : (
              <>
                <label>
                  Street address
                  <input
                    required
                    value={draft.street}
                    onChange={(e) =>
                      setDraft({ ...draft, street: e.target.value })
                    }
                  />
                </label>
                <div className="b-grid">
                  {(["suburb", "state", "postcode", "phone"] as const).map(
                    (field) => (
                      <label key={field}>
                        {field === "phone"
                          ? "Phone number"
                          : field[0].toUpperCase() + field.slice(1)}
                        <input
                          required={field !== "phone"}
                          value={draft[field]}
                          onChange={(e) =>
                            setDraft({ ...draft, [field]: e.target.value })
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
                <label>
                  Delivery notes
                  <textarea
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft({ ...draft, notes: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            <div className="b-actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="b-primary" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(value) => {
          if (!value && !saving) setPendingDelete(null);
        }}
      >
        <DialogContent className="b-dialog">
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name}?</DialogTitle>
          </DialogHeader>
          <p>Existing order details will be retained.</p>
          {dialogError && (
            <p role="alert" className="b-error">
              {dialogError}
            </p>
          )}
          <div className="b-actions">
            <button disabled={saving} onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button
              disabled={saving}
              className="b-primary"
              onClick={() => void remove()}
            >
              {saving ? "Deleting..." : "Delete"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
