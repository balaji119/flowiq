package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type orderProduct struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
}
type orderAddress struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Address string `json:"address"`
}
type orderLine struct {
	ProductID   string  `json:"productId"`
	ProductName string  `json:"productName"`
	ProductCode string  `json:"productCode"`
	Width       float64 `json:"width"`
	Height      float64 `json:"height"`
	Quantity    int     `json:"quantity"`
	AddressID   string  `json:"addressId"`
	Address     string  `json:"address"`
	StoredName  string  `json:"storedName"`
	FileName    string  `json:"fileName"`
	ArtworkURL  string  `json:"-"`
}
type simpleOrder struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Lines       []orderLine `json:"lines"`
	Status      string      `json:"status"`
	QuoteNo     string      `json:"quoteNo"`
	JobNos      []string    `json:"jobNos"`
	Error       string      `json:"error"`
	CreatedAt   time.Time   `json:"createdAt"`
	Revision    int         `json:"revision"`
}

func (a *app) registerOrderRoutes(mux *http.ServeMux) {
	for _, resource := range []string{"products", "addresses"} {
		mux.Handle("GET /api/orders/"+resource, a.withAuth(http.HandlerFunc(a.handleOrderCatalog)))
		roles := []string{"super_admin"}
		if resource == "addresses" {
			roles = append(roles, "admin")
		}
		for _, method := range []string{"PUT", "DELETE"} {
			mux.Handle(method+" /api/orders/"+resource, a.withAuth(a.requireRoles(http.HandlerFunc(a.handleOrderCatalog), roles...)))
		}
	}
	mux.Handle("POST /api/orders/artworks", a.withAuth(http.HandlerFunc(a.handleOrderArtwork)))
	mux.Handle("GET /api/orders", a.withAuth(http.HandlerFunc(a.handleOrders)))
	mux.Handle("POST /api/orders", a.withAuth(http.HandlerFunc(a.handleOrders)))
	mux.Handle("PUT /api/orders/drafts", a.withAuth(http.HandlerFunc(a.handleOrders)))
}

func (a *app) orderTenant(w http.ResponseWriter, r *http.Request) (*TenantRecord, *AuthUser) {
	user, err := a.userWithManagedTenant(r)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return nil, nil
	}
	tenant, err := a.authStore.getTenant(*user.TenantID)
	if err != nil || tenant.Type != "B" {
		writeJSON(w, 403, map[string]string{"error": "Orders require a Type B tenant"})
		return nil, nil
	}
	return tenant, user
}

func (a *app) handleOrderCatalog(w http.ResponseWriter, r *http.Request) {
	tenant, _ := a.orderTenant(w, r)
	if tenant == nil {
		return
	}
	products := strings.HasSuffix(r.URL.Path, "/products")
	table, field := "order_addresses", "address"
	if products {
		table, field = "order_products", "code"
	}
	fail := func(err error) { writeJSON(w, 400, map[string]string{"error": err.Error()}) }
	if r.Method == "GET" {
		// Product codes are management data; order builders only receive IDs and names.
		rows, err := a.authStore.pool.Query(r.Context(), "SELECT id,name,"+field+" FROM "+table+" WHERE tenant_id=$1 ORDER BY name", tenant.ID)
		if err != nil {
			fail(err)
			return
		}
		defer rows.Close()
		items := []map[string]string{}
		for rows.Next() {
			var id, name, value string
			if err := rows.Scan(&id, &name, &value); err != nil {
				fail(err)
				return
			}
			item := map[string]string{"id": id, "name": name}
			if !products || currentUser(r.Context()).Role == "super_admin" {
				item[field] = value
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			fail(err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
		return
	}
	var input struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Code    string `json:"code"`
		Address string `json:"address"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		fail(errors.New("Invalid request"))
		return
	}
	if input.ID == "" {
		input.ID = uuid.NewString()
	}
	if _, err := uuid.Parse(input.ID); err != nil {
		fail(errors.New("Invalid item ID"))
		return
	}
	if r.Method == "DELETE" {
		_, err := a.authStore.pool.Exec(r.Context(), "DELETE FROM "+table+" WHERE id=$1 AND tenant_id=$2", input.ID, tenant.ID)
		if err != nil {
			fail(err)
			return
		}
		writeJSON(w, 200, map[string]bool{"deleted": true})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	value := strings.TrimSpace(input.Address)
	if products {
		value = strings.TrimSpace(input.Code)
	}
	if input.Name == "" || value == "" {
		fail(errors.New("Name and value are required"))
		return
	}
	result, err := a.authStore.pool.Exec(r.Context(), "INSERT INTO "+table+" (id,tenant_id,name,"+field+") VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,"+field+"=EXCLUDED."+field+" WHERE "+table+".tenant_id=EXCLUDED.tenant_id", input.ID, tenant.ID, input.Name, value)
	if err != nil {
		fail(err)
		return
	}
	if result.RowsAffected() != 1 {
		writeJSON(w, 403, map[string]string{"error": "Item belongs to another tenant"})
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}

func (a *app) handleOrderArtwork(w http.ResponseWriter, r *http.Request) {
	tenant, user := a.orderTenant(w, r)
	if tenant == nil {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 251<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Upload a PDF or image up to 250 MB"})
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Artwork is required"})
		return
	}
	defer file.Close()
	if header.Size <= 0 || header.Size > 250<<20 {
		writeJSON(w, 400, map[string]string{"error": "Artwork must be between 1 byte and 250 MB"})
		return
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	contentTypes := map[string]string{".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
	contentType, ok := contentTypes[ext]
	if !ok {
		writeJSON(w, 400, map[string]string{"error": "Use PDF, PNG or JPEG artwork"})
		return
	}
	stored := uuid.NewString() + ext
	if err := a.storeCampaignImageReader(r.Context(), stored, contentType, file, header.Size); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Unable to store artwork"})
		return
	}
	if _, err := a.authStore.pool.Exec(r.Context(), "INSERT INTO order_artworks (stored_name,tenant_id,original_name,created_by) VALUES ($1,$2,$3,$4)", stored, tenant.ID, header.Filename, user.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Unable to register artwork"})
		return
	}
	writeJSON(w, 201, map[string]string{"storedName": stored, "fileName": header.Filename})
}

func validateSimpleOrder(order *simpleOrder) error {
	return validateOrderInput(order, false)
}

func validateOrderInput(order *simpleOrder, draft bool) error {
	if _, err := uuid.Parse(order.ID); err != nil {
		return errors.New("Invalid order ID")
	}
	order.Name = strings.TrimSpace(order.Name)
	if draft && order.Name == "" {
		order.Name = "Untitled order"
	}
	if order.Name == "" || len(order.Name) > 200 {
		return errors.New("Order name is required (maximum 200 characters)")
	}
	if (!draft && len(order.Lines) == 0) || len(order.Lines) > 100 {
		return errors.New("Add between 1 and 100 artworks")
	}
	for i, line := range order.Lines {
		if math.IsNaN(line.Width) || math.IsInf(line.Width, 0) || math.IsNaN(line.Height) || math.IsInf(line.Height, 0) || line.Width <= 0 || line.Height <= 0 || line.Width > 100000 || line.Height > 100000 || line.Quantity < 1 || line.Quantity > 1000000 {
			return fmt.Errorf("Artwork %d requires valid dimensions and quantity", i+1)
		}
		if _, err := uuid.Parse(line.ProductID); err != nil {
			return errors.New("Select a product")
		}
		if _, err := uuid.Parse(line.AddressID); err != nil {
			return errors.New("Select a shipping address")
		}
		if line.StoredName == "" || filepath.Base(line.StoredName) != line.StoredName || strings.ContainsAny(line.StoredName, "/\\") {
			return errors.New("Upload artwork before creating the order")
		}
	}
	return nil
}

func (a *app) handleOrders(w http.ResponseWriter, r *http.Request) {
	tenant, user := a.orderTenant(w, r)
	if tenant == nil {
		return
	}
	fail := func(status int, err error) { writeJSON(w, status, map[string]string{"error": err.Error()}) }
	if r.Method == "GET" {
		rows, err := a.authStore.pool.Query(r.Context(), "SELECT id,name,description,lines,status,quote_no,job_nos,error,created_at,revision FROM orders WHERE tenant_id=$1 ORDER BY created_at DESC", tenant.ID)
		if err != nil {
			fail(500, err)
			return
		}
		defer rows.Close()
		orders := []simpleOrder{}
		for rows.Next() {
			var order simpleOrder
			if err := rows.Scan(&order.ID, &order.Name, &order.Description, &order.Lines, &order.Status, &order.QuoteNo, &order.JobNos, &order.Error, &order.CreatedAt, &order.Revision); err != nil {
				fail(500, err)
				return
			}
			orders = append(orders, order)
		}
		if err := rows.Err(); err != nil {
			fail(500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"orders": orders})
		return
	}
	var order simpleOrder
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if err := decodeJSONBody(r, &order); err != nil {
		fail(400, errors.New("Invalid order"))
		return
	}
	isDraft := r.Method == http.MethodPut
	if err := validateOrderInput(&order, isDraft); err != nil {
		fail(400, err)
		return
	}
	// Submission state is always server-owned, including on malformed/replayed clients.
	order.QuoteNo = ""
	order.JobNos = []string{}
	order.Status = "submitting"
	if isDraft {
		order.Status = "draft"
	}
	if order.Lines == nil {
		order.Lines = []orderLine{}
	}
	order.Error = ""
	order.CreatedAt = time.Now().UTC()
	// Resolve tenant-owned records on the server; never trust submitted product codes, addresses or URLs.
	for i := range order.Lines {
		line := &order.Lines[i]
		err := a.authStore.pool.QueryRow(r.Context(), "SELECT p.name,p.code,d.address,f.original_name FROM order_products p CROSS JOIN order_addresses d CROSS JOIN order_artworks f WHERE p.id=$1 AND d.id=$2 AND f.stored_name=$3 AND p.tenant_id=$4 AND d.tenant_id=$4 AND f.tenant_id=$4", line.ProductID, line.AddressID, line.StoredName, tenant.ID).Scan(&line.ProductName, &line.ProductCode, &line.Address, &line.FileName)
		if err != nil {
			fail(400, errors.New("Product, address or artwork is unavailable for this tenant"))
			return
		}
		if isDraft {
			continue
		}
		artworkURL, err := a.resolvePrintIQArtworkURL(r.Context(), campaignPrintImage{StoredName: line.StoredName, FileName: line.FileName})
		if err != nil {
			fail(400, err)
			return
		}
		parsed, err := url.Parse(artworkURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
			fail(400, errors.New("Configure a public artwork URL before submitting orders"))
			return
		}
		line.ArtworkURL = artworkURL
	}
	lines, _ := json.Marshal(order.Lines)
	// Updating a draft or claiming it for PrintIQ is atomic. A stale editor or a
	// second submission cannot overwrite an order after submission has started.
	err := a.authStore.pool.QueryRow(r.Context(), `
		INSERT INTO orders (id,tenant_id,name,description,lines,status,created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO UPDATE
		SET name=EXCLUDED.name, description=EXCLUDED.description,
		    lines=EXCLUDED.lines, status=EXCLUDED.status, revision=orders.revision+1
		WHERE orders.tenant_id=EXCLUDED.tenant_id AND orders.status='draft' AND orders.revision=$8
		RETURNING created_at, revision
	`, order.ID, tenant.ID, order.Name, order.Description, lines, order.Status, user.ID, order.Revision).Scan(&order.CreatedAt, &order.Revision)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(409, errors.New("This order was changed or already submitted. Reopen it from the dashboard before continuing"))
		return
	}
	if err != nil {
		fail(500, err)
		return
	}
	if isDraft {
		writeJSON(w, 200, map[string]any{"order": order})
		return
	}
	// Finish and persist even when the browser disconnects. Never automatically repeat an ambiguous external request.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	checkpoint := func(step string, payload, response any) error {
		entry, _ := json.Marshal([]any{map[string]any{"step": step, "request": payload, "response": response}})
		_, err := a.authStore.pool.Exec(ctx, "UPDATE orders SET submission_log=submission_log || $2::jsonb WHERE id=$1", order.ID, entry)
		return err
	}
	err = a.submitSimpleOrder(&order, *tenant, *user, checkpoint)
	status := "submitted"
	message := ""
	if err != nil {
		status = "attention"
		message = err.Error() + " Check PrintIQ before creating another order."
	}
	jobs, _ := json.Marshal(order.JobNos)
	if _, saveErr := a.authStore.pool.Exec(ctx, "UPDATE orders SET status=$2,quote_no=$3,job_nos=$4,error=$5 WHERE id=$1", order.ID, status, order.QuoteNo, jobs, message); saveErr != nil {
		fail(500, errors.New("Order received but final status could not be saved. Check PrintIQ before retrying"))
		return
	}
	order.Status = status
	order.Error = message
	writeJSON(w, 201, map[string]any{"order": order})
}
