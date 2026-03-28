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

func (s *mappingStore) listRecords(ctx context.Context, tenantID string) ([]calculatorMappingRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, tenant_id, market, asset, label, state, quantities, created_at, updated_at
		FROM calculator_mappings
		WHERE tenant_id = $1
		ORDER BY market ASC, label ASC, asset ASC
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

	quantitiesJSON, err := encodeQuantities(payload.Quantities)
	if err != nil {
		return nil, err
	}

	row, err := scanCalculatorMappingRow(s.pool.QueryRow(ctx, `
		INSERT INTO calculator_mappings (id, tenant_id, market, asset, label, state, quantities, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
		RETURNING id, tenant_id, market, asset, label, state, quantities, created_at, updated_at
	`, uuid.NewString(), tenantID, market, asset, label, strings.TrimSpace(payload.State), quantitiesJSON))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, errors.New("A mapping for this market and asset already exists")
		}
		return nil, err
	}

	record, err := decodeCalculatorMappingRow(row)
	if err != nil {
		return nil, err
	}
	return &record, nil
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

	quantitiesJSON, err := encodeQuantities(payload.Quantities)
	if err != nil {
		return nil, err
	}

	row, err := scanCalculatorMappingRow(s.pool.QueryRow(ctx, `
		UPDATE calculator_mappings
		SET market = $3,
			asset = $4,
			label = $5,
			state = $6,
			quantities = $7::jsonb,
			updated_at = NOW()
		WHERE id = $1 AND tenant_id = $2
		RETURNING id, tenant_id, market, asset, label, state, quantities, created_at, updated_at
	`, mappingID, tenantID, market, asset, label, strings.TrimSpace(payload.State), quantitiesJSON))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("Mapping not found")
	}
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, errors.New("A mapping for this market and asset already exists")
		}
		return nil, err
	}

	record, err := decodeCalculatorMappingRow(row)
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (s *mappingStore) deleteMapping(ctx context.Context, tenantID, mappingID string) error {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return err
	}

	commandTag, err := s.pool.Exec(ctx, `
		DELETE FROM calculator_mappings
		WHERE id = $1 AND tenant_id = $2
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

	if _, err := tx.Exec(ctx, `DELETE FROM calculator_mappings WHERE tenant_id = $1`, tenantID); err != nil {
		return 0, err
	}

	type normalizedImportRow struct {
		id         string
		market     string
		asset      string
		label      string
		state      string
		quantities string
	}

	uniqueRows := make(map[string]normalizedImportRow)
	order := make([]string, 0)

	count := 0
	for _, market := range metadata {
		marketName, err := sanitizeMappingText(market.Name, "market")
		if err != nil {
			return 0, err
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
			INSERT INTO calculator_mappings (id, tenant_id, market, asset, label, state, quantities, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
		`, row.id, tenantID, row.market, row.asset, row.label, row.state, row.quantities); err != nil {
			return 0, err
		}
		count++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}
