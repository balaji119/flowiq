# Type B orders

Tenant creation accepts `type: "A" | "B"`. Omitting it preserves the legacy Type A default. Migration `041_type_b_orders.sql` sets every existing tenant to Type A. Editing a tenant's name/code does not change its type; conversion between types is deliberately not exposed.

Type A retains its campaign screens, market mappings, calculations, branding and PrintIQ submission path. Type B uses `apps/web/src/typeB` and the separate `/api/orders` API, `orders`, `order_products`, `order_addresses` and `order_artworks` tables. The new theme applies only while the Type B workspace is mounted, including portal dialogs.

## Access

| Capability | Super admin | Admin | User |
| --- | --- | --- | --- |
| Dashboard / create and view orders | Yes | Yes | Yes |
| User management | Yes | Yes | No |
| Tenant management | Yes | No | No |
| Shipping address management | Yes | Yes | No |
| Product mapping management | Yes | No | No |

All roles can read product names/IDs and shipping addresses for the order dialog. Product management routes enforce the super-admin role. Tenant selection is accepted only for super admins; other roles always use their assigned tenant. The server resolves product codes, address text and artwork ownership itself. Saved orders retain snapshots if mappings or addresses subsequently change.

## Submission

**Save Draft**, beside **Create Order**, persists the name, description and saved artwork entries without calling PrintIQ. Drafts may have no artwork yet; a blank name becomes `Untitled order`. The dashboard labels these entries **Draft** and offers **Resume draft**. Reopening loads editable fields and the current product/address options. **Create Order** validates the completed draft and submits that same order ID.

Migration `042_order_drafts.sql` adds the Type B draft status and a revision counter. Saving and submitting check this revision, so a stale browser tab cannot overwrite newer changes. Only drafts may be edited; submitted, submitting and attention-required orders remain locked. Type A campaign statuses are unaffected.

The tenant code is the PrintIQ customer code. The first artwork calls `CreateQuoteWithDelivery`; each additional artwork uses `GetPrice` to add a product with its own quantity and delivery address. Proof-contact questions, `AcceptQuote`, then `UploadArtworkURL` follow the existing integration conventions. This workflow does not create market delivery products or use campaign calculations. PrintIQ determines freight rather than receiving a forced zero freight amount.

Width/height are entered in **millimetres** and are included in each product's description/instructions. The published `CreateQuoteWithDelivery` product-code contract has no direct dimension override. These inputs **do not override a mapped product's finish size or pricing**. A size-driven pricing workflow needs the applicable PrintIQ product/filter configuration and a separately verified contract.

PDF, PNG and JPEG uploads are supported up to 250 MB per file. Existing storage and image-to-PDF helpers supply the artwork URL. Configure public object storage or a public `APP_BASE_URL` that PrintIQ can reach.

An order ID is inserted before external calls. Repeated submissions of that ID are rejected, and each external request/response is recorded in `orders.submission_log`. Partial/ambiguous failures leave the order for manual reconciliation instead of automatically creating duplicate quotes. Open the order to see its error and any known quote/job numbers. If the server stops mid-submission, inspect its stored submission log and PrintIQ before taking further action.

## Rollout and checks

Deploy the API and migrations before the new web build. Restarting the updated API applies pending migrations 041 and 042; the explicit migration command is `go run . migrate` from `apps/api` using the intended environment. Do not run it against production as part of local verification. An application rollback can leave the additive tables/columns in place.

Local validation performed:

- `npm run -w apps/web typecheck`
- `npm run -w apps/web build`
- `go test ./...` from `apps/api`
- `git diff --check`
- PostgreSQL migration and API tests using a disposable PostgreSQL instance (`FLOWIQ_TEST_DATABASE_URL`), covering legacy tenant defaults, role restrictions, tenant isolation, server-owned submission fields, failure persistence and duplicate protection.
- Draft-specific PostgreSQL tests cover empty/artwork draft saves, reopening data, stale revisions, tenant isolation, draft-to-submitted transition, and locking after submission. Draft UI changes passed TypeScript checking; the browser draft flow has not been exercised.
- Browser checks with isolated tenants and mocked PrintIQ: product and address creation, artwork upload, order submission/dashboard, role-specific navigation, tenant type selector, and switching back to the existing Type A dashboard.

No production migration or real PrintIQ order was executed. Live verification with the intended Type B customer/product codes, reachable artwork URLs and shipping/pricing configuration remains required before rollout.
