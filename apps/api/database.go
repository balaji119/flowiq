package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type dbConfig struct {
	DatabaseURL string
}

type migrationFile struct {
	Name string
	Path string
}

func loadDBConfig() (dbConfig, error) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return dbConfig{}, errors.New("Missing required environment variable: DATABASE_URL")
	}
	return dbConfig{DatabaseURL: databaseURL}, nil
}

func connectDatabase(ctx context.Context) (*pgxpool.Pool, error) {
	config, err := loadDBConfig()
	if err != nil {
		return nil, err
	}
	poolConfig, err := pgxpool.ParseConfig(config.DatabaseURL)
	if err != nil {
		return nil, err
	}
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func loadMigrationFiles(dir string) ([]migrationFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	files := make([]migrationFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		files = append(files, migrationFile{
			Name: entry.Name(),
			Path: filepath.Join(dir, entry.Name()),
		})
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Name < files[j].Name
	})
	return files, nil
}

func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return err
	}

	files, err := loadMigrationFiles(filepath.Join("db", "migrations"))
	if err != nil {
		return err
	}

	for _, file := range files {
		var alreadyApplied bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, file.Name).Scan(&alreadyApplied); err != nil {
			return err
		}
		if alreadyApplied {
			continue
		}

		sqlBytes, err := os.ReadFile(file.Path)
		if err != nil {
			return err
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", file.Name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, file.Name); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}

	return nil
}

func seedDatabase(ctx context.Context, pool *pgxpool.Pool) error {
	tenantName := envOrDefault("DEFAULT_TENANT_NAME", "ADS")
	tenantCode := envOrDefault("DEFAULT_TENANT_CODE", "C00003")
	tenantID := uuid.NewString()
	adminUserID := uuid.NewString()
	adminEmail := strings.ToLower(envOrDefault("SUPER_ADMIN_EMAIL", "admin"))
	adminPassword := envOrDefault("SUPER_ADMIN_PASSWORD", "admin")
	adminName := envOrDefault("SUPER_ADMIN_NAME", "FlowIQ Administrator")

	salt, hash, err := newPasswordHash(adminPassword)
	if err != nil {
		return err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var existingTenantID string
	err = tx.QueryRow(ctx, `SELECT id FROM tenants WHERE name = $1 LIMIT 1`, tenantName).Scan(&existingTenantID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO tenants (id, tenant_id, name, code)
			VALUES ($1, $1, $2, $3)
		`, tenantID, tenantName, tenantCode); err != nil {
			return err
		}
		existingTenantID = tenantID
	}

	var existingUserID string
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1 LIMIT 1`, adminEmail).Scan(&existingUserID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO users (id, tenant_id, email, name, role, password_salt, password_hash, active)
			VALUES ($1, $2, $3, $4, 'super_admin', $5, $6, TRUE)
		`, adminUserID, existingTenantID, adminEmail, adminName, salt, hash); err != nil {
			return err
		}
	}

	if err := seedTenantUser(ctx, tx, existingTenantID, "admin", "DEFAULT_ADMIN_EMAIL", "DEFAULT_ADMIN_PASSWORD", "DEFAULT_ADMIN_NAME", "Tenant Administrator"); err != nil {
		return err
	}
	if err := seedTenantUser(ctx, tx, existingTenantID, "user", "DEFAULT_USER_EMAIL", "DEFAULT_USER_PASSWORD", "DEFAULT_USER_NAME", "Tenant User"); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func seedTenantUser(ctx context.Context, tx pgx.Tx, tenantID, role, emailEnvKey, passwordEnvKey, nameEnvKey, fallbackName string) error {
	email := strings.ToLower(strings.TrimSpace(os.Getenv(emailEnvKey)))
	password := strings.TrimSpace(os.Getenv(passwordEnvKey))
	if email == "" || password == "" {
		return nil
	}

	var existingUserID string
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1 LIMIT 1`, email).Scan(&existingUserID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil
	}

	salt, hash, err := newPasswordHash(password)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, tenant_id, email, name, role, password_salt, password_hash, active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
	`, uuid.NewString(), tenantID, email, envOrDefault(nameEnvKey, fallbackName), role, salt, hash)
	return err
}

func backfillMaintenanceRelations(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	commandTag, err := pool.Exec(ctx, `
		WITH maintenance_matches AS (
			SELECT
				primary_asset.id AS primary_id,
				maintenance_asset.id AS maintenance_id
			FROM market_assets primary_asset
			JOIN market_assets maintenance_asset
			  ON maintenance_asset.market_id = primary_asset.market_id
			 AND lower(maintenance_asset.asset) = lower(primary_asset.asset || ' (maintenance)')
			WHERE primary_asset.maintenance_asset_id IS NULL
			  AND lower(primary_asset.asset) NOT LIKE '%(maintenance)%'
		)
		UPDATE market_assets target
		SET maintenance_asset_id = maintenance_matches.maintenance_id,
			updated_at = NOW()
		FROM maintenance_matches
		WHERE target.id = maintenance_matches.primary_id
	`)
	if err != nil {
		return 0, err
	}
	return commandTag.RowsAffected(), nil
}

func backfillCustomSheetProductMappings(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	commandTag, err := pool.Exec(ctx, `
		WITH custom_format_keys AS (
			SELECT *
			FROM (VALUES
				('8-sheet'::text, '8-sheet'::text),
				('8-sheet-a0'::text, 'QA0'::text),
				('6-sheet'::text, '6-sheet'::text),
				('4-sheet'::text, '4-sheet'::text),
				('2-sheet'::text, '2-sheet'::text),
				('mega'::text, 'Mega'::text),
				('dot-m'::text, 'DOT M'::text),
				('mega-portrait'::text, 'MP'::text),
				('ff'::text, 'FF'::text)
			) AS format_keys(settings_key, quantity_key)
		),
		enabled_custom_formats AS (
			SELECT
				sno.tenant_id,
				custom_format_keys.settings_key,
				custom_format_keys.quantity_key
			FROM sheet_name_overrides sno
			JOIN custom_format_keys
			  ON COALESCE((sno.custom_sheet_size_formats ->> custom_format_keys.settings_key)::boolean, false)
		),
		unsubmitted_campaign_assets AS (
			SELECT DISTINCT
				c.tenant_id,
				market_assets.market_id,
				market_assets.id AS asset_id,
				enabled_custom_formats.settings_key
			FROM campaigns c
			CROSS JOIN LATERAL jsonb_array_elements(
				CASE
					WHEN jsonb_typeof(c.form_data -> 'campaignMarkets') = 'array' THEN c.form_data -> 'campaignMarkets'
					ELSE '[]'::jsonb
				END
			) AS campaign_market(value)
			CROSS JOIN LATERAL jsonb_array_elements(
				CASE
					WHEN jsonb_typeof(campaign_market.value -> 'assets') = 'array' THEN campaign_market.value -> 'assets'
					ELSE '[]'::jsonb
				END
			) AS campaign_asset(value)
			JOIN market_assets
			  ON market_assets.id::text = campaign_asset.value ->> 'assetId'
			JOIN markets
			  ON markets.id = market_assets.market_id
			 AND markets.tenant_id = c.tenant_id
			JOIN enabled_custom_formats
			  ON enabled_custom_formats.tenant_id = c.tenant_id
			WHERE c.status <> 'submitted'
			  AND COALESCE(NULLIF(market_assets.quantities ->> enabled_custom_formats.quantity_key, '')::numeric, 0) > 0
		)
		INSERT INTO market_material_mappings (
			tenant_id,
			market_id,
			sheet_key,
			product_code,
			sheet_code,
			created_at,
			updated_at
		)
		SELECT
			source_mapping.tenant_id,
			source_mapping.market_id,
			source_mapping.sheet_key || '|sheet:' || unsubmitted_campaign_assets.settings_key,
			source_mapping.product_code,
			source_mapping.sheet_code,
			NOW(),
			NOW()
		FROM unsubmitted_campaign_assets
		JOIN market_material_mappings source_mapping
		  ON source_mapping.tenant_id = unsubmitted_campaign_assets.tenant_id
		 AND source_mapping.market_id = unsubmitted_campaign_assets.market_id
		 AND source_mapping.sheet_key = 'asset:' || unsubmitted_campaign_assets.asset_id::text
		WHERE btrim(source_mapping.product_code) <> ''
		ON CONFLICT (tenant_id, market_id, sheet_key) DO NOTHING
	`)
	if err != nil {
		return 0, err
	}
	return commandTag.RowsAffected(), nil
}
