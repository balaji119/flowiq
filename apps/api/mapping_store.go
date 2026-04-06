package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type mappingStore struct {
	pool *pgxpool.Pool
}

type calculatorMappingRow struct {
	ID         string
	TenantID   string
	Market     string
	Asset      string
	Label      string
	State      string
	Quantities []byte
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type marketDeliveryAddressRow struct {
	TenantID        string
	Market          string
	DeliveryAddress string
	IsDefault       bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type marketShippingRateRow struct {
	TenantID     string
	Market       string
	ShippingRate float64
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func newMappingStore(pool *pgxpool.Pool) *mappingStore {
	return &mappingStore{pool: pool}
}

func normalizeQuantityBreakdown(input quantityBreakdown) quantityBreakdown {
	normalized := createEmptyBreakdown()
	for _, key := range formatKeys {
		normalized[key] = input[key]
	}
	return normalized
}

func sanitizeMappingText(value, field string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("%s is required", field)
	}
	return trimmed, nil
}

func (s *mappingStore) ensureTenantExists(ctx context.Context, tenantID string) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return errors.New("tenantId is required")
	}

	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM tenants WHERE id = $1)`, trimmedTenantID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return errors.New("Tenant not found")
	}
	return nil
}

func scanCalculatorMappingRow(scanner interface {
	Scan(dest ...any) error
}) (calculatorMappingRow, error) {
	var row calculatorMappingRow
	err := scanner.Scan(
		&row.ID,
		&row.TenantID,
		&row.Market,
		&row.Asset,
		&row.Label,
		&row.State,
		&row.Quantities,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	return row, err
}

func decodeCalculatorMappingRow(row calculatorMappingRow) (calculatorMappingRecord, error) {
	quantities := createEmptyBreakdown()
	if len(row.Quantities) > 0 {
		if err := json.Unmarshal(row.Quantities, &quantities); err != nil {
			return calculatorMappingRecord{}, err
		}
	}

	return calculatorMappingRecord{
		ID:         row.ID,
		TenantID:   row.TenantID,
		Market:     row.Market,
		Asset:      row.Asset,
		Label:      row.Label,
		State:      row.State,
		Quantities: normalizeQuantityBreakdown(quantities),
		CreatedAt:  row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:  row.UpdatedAt.UTC().Format(time.RFC3339),
	}, nil
}

func encodeQuantities(quantities quantityBreakdown) (string, error) {
	bytes, err := json.Marshal(normalizeQuantityBreakdown(quantities))
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func normalizeMappingID(value string) string {
	mappingID := strings.TrimSpace(value)
	if mappingID == "" {
		return uuid.NewString()
	}
	if _, err := uuid.Parse(mappingID); err != nil {
		return uuid.NewString()
	}
	return mappingID
}

func scanMarketDeliveryAddressRow(scanner interface {
	Scan(dest ...any) error
}) (marketDeliveryAddressRow, error) {
	var row marketDeliveryAddressRow
	err := scanner.Scan(
		&row.TenantID,
		&row.Market,
		&row.DeliveryAddress,
		&row.IsDefault,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	return row, err
}

func decodeMarketDeliveryAddressRow(row marketDeliveryAddressRow) marketDeliveryAddressRecord {
	return marketDeliveryAddressRecord{
		TenantID:        row.TenantID,
		Market:          row.Market,
		DeliveryAddress: row.DeliveryAddress,
		IsDefault:       row.IsDefault,
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       row.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func scanMarketShippingRateRow(scanner interface {
	Scan(dest ...any) error
}) (marketShippingRateRow, error) {
	var row marketShippingRateRow
	err := scanner.Scan(
		&row.TenantID,
		&row.Market,
		&row.ShippingRate,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	return row, err
}

func decodeMarketShippingRateRow(row marketShippingRateRow) marketShippingRateRecord {
	return marketShippingRateRecord{
		TenantID:     row.TenantID,
		Market:       row.Market,
		ShippingRate: row.ShippingRate,
		CreatedAt:    row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:    row.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *mappingStore) ensureMarket(ctx context.Context, tenantID, marketName string) (string, error) {
	var marketID string
	err := s.pool.QueryRow(ctx, `
		SELECT id
		FROM markets
		WHERE tenant_id = $1 AND name = $2
	`, tenantID, marketName).Scan(&marketID)
	if err == nil {
		return marketID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	marketID = uuid.NewString()
	_, err = s.pool.Exec(ctx, `
		INSERT INTO markets (id, tenant_id, name, created_at, updated_at)
		VALUES ($1, $2, $3, NOW(), NOW())
		ON CONFLICT (tenant_id, name) DO NOTHING
	`, marketID, tenantID, marketName)
	if err != nil {
		return "", err
	}

	err = s.pool.QueryRow(ctx, `
		SELECT id
		FROM markets
		WHERE tenant_id = $1 AND name = $2
	`, tenantID, marketName).Scan(&marketID)
	if err != nil {
		return "", err
	}
	return marketID, nil
}

func (s *mappingStore) getRecordByID(ctx context.Context, tenantID, mappingID string) (*calculatorMappingRecord, error) {
	row, err := scanCalculatorMappingRow(s.pool.QueryRow(ctx, `
		SELECT ma.id, m.tenant_id, m.name AS market, ma.asset, ma.label, ma.state, ma.quantities, ma.created_at, ma.updated_at
		FROM market_assets ma
		JOIN markets m ON m.id = ma.market_id
		WHERE ma.id = $1 AND m.tenant_id = $2
	`, mappingID, tenantID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("Mapping not found")
	}
	if err != nil {
		return nil, err
	}
	record, err := decodeCalculatorMappingRow(row)
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (s *mappingStore) listRecords(ctx context.Context, tenantID string) ([]calculatorMappingRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT ma.id, m.tenant_id, m.name AS market, ma.asset, ma.label, ma.state, ma.quantities, ma.created_at, ma.updated_at
		FROM market_assets ma
		JOIN markets m ON m.id = ma.market_id
		WHERE m.tenant_id = $1
		ORDER BY m.name ASC, ma.label ASC, ma.asset ASC
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]calculatorMappingRecord, 0)
	for rows.Next() {
		row, err := scanCalculatorMappingRow(rows)
		if err != nil {
			return nil, err
		}
		record, err := decodeCalculatorMappingRow(row)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *mappingStore) listMarketMetadata(ctx context.Context, tenantID string) ([]marketMetadata, error) {
	records, err := s.listRecords(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	grouped := make(map[string][]marketAssetOption)
	order := make([]string, 0)
	for _, record := range records {
		if _, exists := grouped[record.Market]; !exists {
			order = append(order, record.Market)
		}
		grouped[record.Market] = append(grouped[record.Market], marketAssetOption{
			ID:         record.ID,
			Market:     record.Market,
			Asset:      record.Asset,
			Label:      record.Label,
			State:      record.State,
			Quantities: normalizeQuantityBreakdown(record.Quantities),
		})
	}

	sort.Strings(order)
	metadata := make([]marketMetadata, 0, len(order))
	for _, marketName := range order {
		assets := grouped[marketName]
		sort.Slice(assets, func(i, j int) bool {
			if assets[i].Label == assets[j].Label {
				return assets[i].Asset < assets[j].Asset
			}
			return assets[i].Label < assets[j].Label
		})
		metadata = append(metadata, marketMetadata{
			Name:   marketName,
			Assets: assets,
		})
	}

	return metadata, nil
}

func (s *mappingStore) createMapping(ctx context.Context, tenantID string, payload calculatorMappingInput) (*calculatorMappingRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}

	market, err := sanitizeMappingText(payload.Market, "market")
	if err != nil {
		return nil, err
	}
	asset, err := sanitizeMappingText(payload.Asset, "asset")
	if err != nil {
		return nil, err
	}
	label, err := sanitizeMappingText(firstNonEmpty(payload.Label, payload.Asset), "label")
	if err != nil {
		return nil, err
	}

	marketID, err := s.ensureMarket(ctx, tenantID, market)
	if err != nil {
		return nil, err
	}

	quantitiesJSON, err := encodeQuantities(payload.Quantities)
	if err != nil {
		return nil, err
	}

	mappingID := uuid.NewString()
	_, err = s.pool.Exec(ctx, `
		INSERT INTO market_assets (id, market_id, asset, label, state, quantities, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
	`, mappingID, marketID, asset, label, strings.TrimSpace(payload.State), quantitiesJSON)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, errors.New("A mapping for this market and asset already exists")
		}
		return nil, err
	}

	record, err := s.getRecordByID(ctx, tenantID, mappingID)
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (s *mappingStore) updateMapping(ctx context.Context, tenantID, mappingID string, payload calculatorMappingInput) (*calculatorMappingRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}

	market, err := sanitizeMappingText(payload.Market, "market")
	if err != nil {
		return nil, err
	}
	asset, err := sanitizeMappingText(payload.Asset, "asset")
	if err != nil {
		return nil, err
	}
	label, err := sanitizeMappingText(firstNonEmpty(payload.Label, payload.Asset), "label")
	if err != nil {
		return nil, err
	}

	marketID, err := s.ensureMarket(ctx, tenantID, market)
	if err != nil {
		return nil, err
	}

	quantitiesJSON, err := encodeQuantities(payload.Quantities)
	if err != nil {
		return nil, err
	}

	commandTag, err := s.pool.Exec(ctx, `
		UPDATE market_assets ma
		SET market_id = $3,
			asset = $4,
			label = $5,
			state = $6,
			quantities = $7::jsonb,
			updated_at = NOW()
		FROM markets current_market
		WHERE ma.id = $1
		  AND ma.market_id = current_market.id
		  AND current_market.tenant_id = $2
	`, mappingID, tenantID, marketID, asset, label, strings.TrimSpace(payload.State), quantitiesJSON)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, errors.New("A mapping for this market and asset already exists")
		}
		return nil, err
	}
	if commandTag.RowsAffected() == 0 {
		return nil, errors.New("Mapping not found")
	}

	record, err := s.getRecordByID(ctx, tenantID, mappingID)
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (s *mappingStore) deleteMapping(ctx context.Context, tenantID, mappingID string) error {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return err
	}

	commandTag, err := s.pool.Exec(ctx, `
		DELETE FROM market_assets ma
		USING markets m
		WHERE ma.id = $1
		  AND ma.market_id = m.id
		  AND m.tenant_id = $2
	`, mappingID, tenantID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return errors.New("Mapping not found")
	}
	return nil
}

func (s *mappingStore) replaceMappingsFromImport(ctx context.Context, tenantID string, metadata []marketMetadata) (int, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return 0, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM market_assets
		WHERE market_id IN (SELECT id FROM markets WHERE tenant_id = $1)
	`, tenantID); err != nil {
		return 0, err
	}

	type normalizedImportRow struct {
		id         string
		marketID   string
		market     string
		asset      string
		label      string
		state      string
		quantities string
	}

	uniqueRows := make(map[string]normalizedImportRow)
	order := make([]string, 0)

	marketIDs := make(map[string]string)
	count := 0
	for _, market := range metadata {
		marketName, err := sanitizeMappingText(market.Name, "market")
		if err != nil {
			return 0, err
		}
		marketID, exists := marketIDs[marketName]
		if !exists {
			err = tx.QueryRow(ctx, `
				SELECT id
				FROM markets
				WHERE tenant_id = $1 AND name = $2
			`, tenantID, marketName).Scan(&marketID)
			if errors.Is(err, pgx.ErrNoRows) {
				marketID = uuid.NewString()
				if _, err := tx.Exec(ctx, `
					INSERT INTO markets (id, tenant_id, name, created_at, updated_at)
					VALUES ($1, $2, $3, NOW(), NOW())
					ON CONFLICT (tenant_id, name) DO NOTHING
				`, marketID, tenantID, marketName); err != nil {
					return 0, err
				}
				if err := tx.QueryRow(ctx, `
					SELECT id
					FROM markets
					WHERE tenant_id = $1 AND name = $2
				`, tenantID, marketName).Scan(&marketID); err != nil {
					return 0, err
				}
			} else if err != nil {
				return 0, err
			}
			marketIDs[marketName] = marketID
		}
		for _, asset := range market.Assets {
			assetName, err := sanitizeMappingText(asset.Asset, "asset")
			if err != nil {
				return 0, err
			}
			label, err := sanitizeMappingText(firstNonEmpty(asset.Label, asset.Asset), "label")
			if err != nil {
				return 0, err
			}
			quantitiesJSON, err := encodeQuantities(asset.Quantities)
			if err != nil {
				return 0, err
			}

			key := marketName + "\x00" + assetName
			if _, exists := uniqueRows[key]; !exists {
				order = append(order, key)
			}
			uniqueRows[key] = normalizedImportRow{
				id:         normalizeMappingID(asset.ID),
				marketID:   marketID,
				market:     marketName,
				asset:      assetName,
				label:      label,
				state:      strings.TrimSpace(asset.State),
				quantities: quantitiesJSON,
			}
		}
	}

	for _, key := range order {
		row := uniqueRows[key]
		if _, err := tx.Exec(ctx, `
			INSERT INTO market_assets (id, market_id, asset, label, state, quantities, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
		`, row.id, row.marketID, row.asset, row.label, row.state, row.quantities); err != nil {
			return 0, err
		}
		count++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *mappingStore) listMarketDeliveryAddresses(ctx context.Context, tenantID string) ([]marketDeliveryAddressRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT mda.tenant_id, m.name, mda.delivery_address, mda.is_default, mda.created_at, mda.updated_at
		FROM market_delivery_addresses mda
		JOIN markets m ON m.id = mda.market_id
		WHERE mda.tenant_id = $1
		ORDER BY m.name ASC, mda.created_at ASC, mda.delivery_address ASC
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]marketDeliveryAddressRecord, 0)
	for rows.Next() {
		row, err := scanMarketDeliveryAddressRow(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, decodeMarketDeliveryAddressRow(row))
	}
	return records, rows.Err()
}

func (s *mappingStore) upsertMarketDeliveryAddress(ctx context.Context, tenantID string, payload marketDeliveryAddressInput) (*marketDeliveryAddressRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}

	market, err := sanitizeMappingText(payload.Market, "market")
	if err != nil {
		return nil, err
	}
	deliveryAddress, err := sanitizeMappingText(payload.DeliveryAddress, "deliveryAddress")
	if err != nil {
		return nil, err
	}
	marketID, err := s.ensureMarket(ctx, tenantID, market)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if payload.IsDefault {
		if _, err := tx.Exec(ctx, `
			UPDATE market_delivery_addresses
			SET is_default = FALSE, updated_at = NOW()
			WHERE tenant_id = $1
			  AND market_id = $2
			  AND is_default = TRUE
			  AND delivery_address <> $3
		`, tenantID, marketID, deliveryAddress); err != nil {
			return nil, err
		}
	}

	row, err := scanMarketDeliveryAddressRow(tx.QueryRow(ctx, `
		INSERT INTO market_delivery_addresses (tenant_id, market_id, delivery_address, is_default, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (tenant_id, market_id, delivery_address)
		DO UPDATE SET is_default = EXCLUDED.is_default, updated_at = NOW()
		RETURNING tenant_id, $5::text, delivery_address, is_default, created_at, updated_at
	`, tenantID, marketID, deliveryAddress, payload.IsDefault, market))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "idx_market_delivery_addresses_one_default_per_market") {
			return nil, errors.New("Only one default delivery address is allowed per market")
		}
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	record := decodeMarketDeliveryAddressRow(row)
	return &record, nil
}

func (s *mappingStore) deleteMarketDeliveryAddress(ctx context.Context, tenantID string, payload marketDeliveryAddressDeleteInput) error {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return err
	}

	market, err := sanitizeMappingText(payload.Market, "market")
	if err != nil {
		return err
	}
	deliveryAddress, err := sanitizeMappingText(payload.DeliveryAddress, "deliveryAddress")
	if err != nil {
		return err
	}

	commandTag, err := s.pool.Exec(ctx, `
		DELETE FROM market_delivery_addresses mda
		USING markets m
		WHERE mda.tenant_id = $1
		  AND mda.market_id = m.id
		  AND m.tenant_id = $1
		  AND m.name = $2
		  AND mda.delivery_address = $3
	`, tenantID, market, deliveryAddress)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return errors.New("Delivery address not found")
	}
	return nil
}

func (s *mappingStore) listMarketShippingRates(ctx context.Context, tenantID string) ([]marketShippingRateRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT msr.tenant_id, m.name, msr.shipping_rate::float8, msr.created_at, msr.updated_at
		FROM market_shipping_rates msr
		JOIN markets m ON m.id = msr.market_id
		WHERE msr.tenant_id = $1
		ORDER BY m.name ASC
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]marketShippingRateRecord, 0)
	for rows.Next() {
		row, err := scanMarketShippingRateRow(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, decodeMarketShippingRateRow(row))
	}
	return records, rows.Err()
}

func (s *mappingStore) upsertMarketShippingRate(ctx context.Context, tenantID string, payload marketShippingRateInput) (*marketShippingRateRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}

	market, err := sanitizeMappingText(payload.Market, "market")
	if err != nil {
		return nil, err
	}
	if payload.ShippingRate < 0 {
		return nil, errors.New("shippingRate must be greater than or equal to 0")
	}

	marketID, err := s.ensureMarket(ctx, tenantID, market)
	if err != nil {
		return nil, err
	}

	row, err := scanMarketShippingRateRow(s.pool.QueryRow(ctx, `
		INSERT INTO market_shipping_rates (tenant_id, market_id, shipping_rate, created_at, updated_at)
		VALUES ($1, $2, $3, NOW(), NOW())
		ON CONFLICT (tenant_id, market_id)
		DO UPDATE SET shipping_rate = EXCLUDED.shipping_rate, updated_at = NOW()
		RETURNING tenant_id, $4::text, shipping_rate::float8, created_at, updated_at
	`, tenantID, marketID, payload.ShippingRate, market))
	if err != nil {
		return nil, err
	}

	record := decodeMarketShippingRateRow(row)
	return &record, nil
}
