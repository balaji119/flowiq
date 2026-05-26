package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const campaignEditLockTTL = 2 * time.Minute

type campaignEditLock struct {
	CampaignID string
	TenantID   string
	UserID     string
	UserName   string
	UserEmail  string
	ExpiresAt  time.Time
}

type campaignLockedError struct {
	OwnerName string
}

func (e *campaignLockedError) Error() string {
	if strings.TrimSpace(e.OwnerName) == "" {
		return "This campaign is currently being edited by another user"
	}
	return fmt.Sprintf("This campaign is currently being edited by %s", e.OwnerName)
}

func normalizeLockOwnerName(name, email string) string {
	trimmedName := strings.TrimSpace(name)
	if trimmedName != "" {
		return trimmedName
	}
	return strings.TrimSpace(email)
}

func (s *campaignStore) acquireCampaignEditLock(ctx context.Context, user AuthUser, campaignID string) (*campaignEditLock, error) {
	if user.TenantID == nil || strings.TrimSpace(*user.TenantID) == "" {
		return nil, errors.New("current user is not assigned to a tenant")
	}
	tenantID := strings.TrimSpace(*user.TenantID)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var campaignExists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM campaigns
			WHERE id = $1 AND tenant_id = $2
		)
	`, campaignID, tenantID).Scan(&campaignExists); err != nil {
		return nil, err
	}
	if !campaignExists {
		return nil, errors.New("Campaign not found")
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM campaign_edit_locks
		WHERE campaign_id = $1
		  AND expires_at < NOW()
	`, campaignID); err != nil {
		return nil, err
	}

	current := campaignEditLock{}
	err = tx.QueryRow(ctx, `
		SELECT l.campaign_id, l.tenant_id, l.user_id, u.name, u.email, l.expires_at
		FROM campaign_edit_locks l
		INNER JOIN users u ON u.id = l.user_id
		WHERE l.campaign_id = $1
		FOR UPDATE
	`, campaignID).Scan(
		&current.CampaignID,
		&current.TenantID,
		&current.UserID,
		&current.UserName,
		&current.UserEmail,
		&current.ExpiresAt,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	if err == nil && current.UserID != user.ID {
		return nil, &campaignLockedError{OwnerName: normalizeLockOwnerName(current.UserName, current.UserEmail)}
	}

	if err == nil {
		if _, err := tx.Exec(ctx, `
			UPDATE campaign_edit_locks
			SET expires_at = NOW() + $2::interval
			WHERE campaign_id = $1
		`, campaignID, formatInterval(campaignEditLockTTL)); err != nil {
			return nil, err
		}
		current.ExpiresAt = time.Now().UTC().Add(campaignEditLockTTL)
	} else {
		if _, err := tx.Exec(ctx, `
			INSERT INTO campaign_edit_locks (campaign_id, tenant_id, user_id, created_at, expires_at)
			VALUES ($1, $2, $3, NOW(), NOW() + $4::interval)
		`, campaignID, tenantID, user.ID, formatInterval(campaignEditLockTTL)); err != nil {
			return nil, err
		}
		current = campaignEditLock{
			CampaignID: campaignID,
			TenantID:   tenantID,
			UserID:     user.ID,
			UserName:   user.Name,
			UserEmail:  user.Email,
			ExpiresAt:  time.Now().UTC().Add(campaignEditLockTTL),
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &current, nil
}

func (s *campaignStore) releaseCampaignEditLock(ctx context.Context, user AuthUser, campaignID string) error {
	if user.TenantID == nil || strings.TrimSpace(*user.TenantID) == "" {
		return nil
	}
	tenantID := strings.TrimSpace(*user.TenantID)
	_, err := s.pool.Exec(ctx, `
		DELETE FROM campaign_edit_locks
		WHERE campaign_id = $1
		  AND tenant_id = $2
		  AND user_id = $3
	`, campaignID, tenantID, user.ID)
	return err
}

func (s *campaignStore) assertCampaignEditable(ctx context.Context, user AuthUser, campaignID string) error {
	_, err := s.acquireCampaignEditLock(ctx, user, campaignID)
	return err
}

func formatInterval(duration time.Duration) string {
	seconds := int(duration / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	return fmt.Sprintf("%d seconds", seconds)
}
