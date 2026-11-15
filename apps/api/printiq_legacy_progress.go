package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func (a *app) checkPrintIQHistory(ctx context.Context, campaign *campaignRecord, testModes ...bool) error {
	test := len(testModes) > 0 && testModes[0]
	// Completed durable records supersede log errors from reconciled attempts.
	// The other mode has its own journal, so its unfinished modern attempt must
	// not be mistaken for a legacy failure that blocks switching modes.
	var knownProgress bool
	if err := a.campaignStore.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM printiq_submission_progress WHERE campaign_id=$1 AND tenant_id=$2 AND (completed OR COALESCE(data->>'Test','false')<>$3))`, campaign.ID, campaign.TenantID, fmt.Sprint(test)).Scan(&knownProgress); err != nil {
		return err
	}
	if knownProgress {
		return nil
	}
	return a.checkLegacyPrintIQProgress(campaign)
}

// Historical attempts predate durable checkpoints. Their abbreviated logs are
// insufficient to safely reconstruct every PrintIQ response and resume them.
func (a *app) checkLegacyPrintIQProgress(campaign *campaignRecord) error {
	files, err := filepath.Glob(filepath.Join(a.logDir, printIQLogPrefix+"*"+printIQLogSuffix))
	if err != nil {
		return err
	}
	type attempt struct {
		At, Kind, Quote string
		Failed          bool
	}
	attempts := map[string]*attempt{}
	for _, path := range files {
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 4096), 4<<20)
		for scanner.Scan() {
			if !bytes.Contains(scanner.Bytes(), []byte(campaign.ID)) {
				continue
			}
			var row struct {
				CampaignID string         `json:"campaignId"`
				TenantID   string         `json:"tenantId"`
				RequestID  string         `json:"requestId"`
				Timestamp  string         `json:"timestamp"`
				Type       string         `json:"type"`
				Response   map[string]any `json:"response"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
				f.Close()
				return fmt.Errorf("Unable to check historical PrintIQ progress")
			}
			if row.CampaignID != campaign.ID || row.TenantID != campaign.TenantID {
				continue
			}
			entry := attempts[row.RequestID]
			if entry == nil {
				entry = &attempt{}
				attempts[row.RequestID] = entry
			}
			entry.At, entry.Kind = row.Timestamp, row.Type
			if row.Type == "error" {
				entry.Failed = true
			}
			if quote, ok := row.Response["quoteNo"].(string); ok && quote != "" {
				entry.Quote = quote
			}
		}
		scanErr := scanner.Err()
		f.Close()
		if scanErr != nil {
			return scanErr
		}
	}
	var latest *attempt
	for _, entry := range attempts {
		if latest == nil || entry.At > latest.At {
			latest = entry
		}
	}
	if latest != nil && (latest.Quote != "" || latest.Failed || latest.Kind == "request") {
		return fmt.Errorf("An earlier PrintIQ submission has unresolved progress (quote %s). ADS must reconcile the existing jobs before creating another quote; historical attempts cannot be resumed automatically", latest.Quote)
	}
	return nil
}
