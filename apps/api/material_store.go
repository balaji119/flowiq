package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

func scanMaterialRecord(scanner interface{ Scan(dest ...any) error }) (materialRecord, error) {
	var record materialRecord
	var createdAt, updatedAt time.Time
	err := scanner.Scan(&record.ID, &record.TenantID, &record.Name, &record.IsDefault, &createdAt, &updatedAt)
	record.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	record.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return record, err
}

func (s *mappingStore) listMaterials(ctx context.Context, tenantID string) ([]materialRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, tenant_id::text, name, is_default, created_at, updated_at
		FROM materials
		WHERE tenant_id = $1
		ORDER BY LOWER(name), name
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := make([]materialRecord, 0)
	for rows.Next() {
		record, err := scanMaterialRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *mappingStore) replaceMaterials(ctx context.Context, tenantID string, payload []materialInput) ([]materialRecord, error) {
	if err := s.ensureTenantExists(ctx, tenantID); err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(payload))
	defaultCount := 0
	for index := range payload {
		payload[index].Name = strings.TrimSpace(payload[index].Name)
		if payload[index].Name == "" {
			return nil, errors.New("Material name is required")
		}
		if len(payload[index].Name) > 200 {
			return nil, errors.New("Material name must be 200 characters or fewer")
		}
		key := strings.ToLower(payload[index].Name)
		if seen[key] {
			return nil, errors.New("Material names must be unique")
		}
		seen[key] = true
		if payload[index].IsDefault {
			defaultCount++
		}
	}
	if len(payload) > 0 && defaultCount != 1 {
		return nil, errors.New("Exactly one material must be the default")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	existingIDs := make(map[string]bool)
	rows, err := tx.Query(ctx, `SELECT id::text FROM materials WHERE tenant_id = $1`, tenantID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		existingIDs[id] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	if _, err := tx.Exec(ctx, `DELETE FROM materials WHERE tenant_id = $1`, tenantID); err != nil {
		return nil, err
	}
	for _, item := range payload {
		id := strings.TrimSpace(item.ID)
		if _, err := uuid.Parse(id); err != nil || !existingIDs[id] {
			id = uuid.NewString()
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO materials (id, tenant_id, name, is_default, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
		`, id, tenantID, item.Name, item.IsDefault); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.listMaterials(ctx, tenantID)
}
