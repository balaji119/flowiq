package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type printIQSavedStep struct {
	Name      string
	Payload   string
	State     string
	Response  any
	Failure   *printIQSubmissionFailure
	AutoRetry bool
	Attempts  []printIQStepAttempt
}

type printIQStepAttempt struct {
	Payload    string
	StartedAt  time.Time
	FinishedAt *time.Time
	AutoRetry  bool
	Failure    *printIQSubmissionFailure
}

type printIQJournal struct {
	ID            string
	Fingerprint   string
	Test          bool
	Creator       string
	Plans         []printIQMarketPlan
	CustomerCode  string
	PurchaseOrder *printIQArtworkUpload
	Visuals       *printIQArtworkUpload
	Artworks      map[string]*printIQArtworkUpload
	Steps         map[string]*printIQSavedStep
	CurrentStep   string
	Resolutions   []printIQUploadResolution
	Completed     bool
	Superseded    bool
	RunnerID      string
	save          func() error
	wait          func() error
	waitRetry     func() error
	recover       func(string, string, any) (any, bool)
	validate      func(string, any) error
}

func progressFailure(message string) *printIQSubmissionFailure {
	return &printIQSubmissionFailure{Status: 409, Body: map[string]any{"error": message}}
}

func checkpointFailure(message string) *printIQSubmissionFailure {
	return &printIQSubmissionFailure{Status: http.StatusServiceUnavailable, Body: map[string]any{"error": message, "stopSubmission": true}}
}

func (j *printIQJournal) run(key, step string, payload any, call func() (any, *printIQSubmissionFailure)) (any, *printIQSubmissionFailure) {
	autoRetry := false
	for {
		response, failure := j.runOnce(key, step, payload, call, autoRetry)
		if failure != nil && failure.Body["stopSubmission"] == true {
			return response, failure
		}
		saved := j.Steps[key]
		encoded, encodeErr := json.Marshal(payload)
		if failure != nil && saved != nil && saved.State == "pending" && saved.Name == step && encodeErr == nil && saved.Payload == string(encoded) && j.recover != nil {
			if recovered, ok := j.recover(key, step, payload); ok {
				if j.validate != nil {
					if err := j.validate(step, recovered); err != nil {
						return response, failure
					}
				}
				saved.Response, saved.Failure, saved.State = recovered, nil, "done"
				if err := j.save(); err != nil {
					saved.State = "pending"
					return nil, checkpointFailure("Recovered PrintIQ result could not be saved; retry will check the existing result again")
				}
				return recovered, nil
			}
		}
		// An uncertain mutation may already have completed in PrintIQ. Only reads
		// and confirmed rejections can be sent again without reconciliation.
		if autoRetry || failure == nil || saved == nil || saved.State != "failed" || saved.Failure != failure {
			return response, failure
		}
		saved.AutoRetry = true
		if err := j.save(); err != nil {
			return nil, checkpointFailure("Unable to save retry progress; no retry was sent")
		}
		if j.waitRetry != nil {
			if err := j.waitRetry(); err != nil {
				return nil, progressFailure("Submission interrupted before automatic retry; completed steps are saved")
			}
		}
		autoRetry = true
	}
}

func (j *printIQJournal) runOnce(key, step string, payload any, call func() (any, *printIQSubmissionFailure), autoRetry bool) (any, *printIQSubmissionFailure) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, progressFailure("Unable to encode submission progress")
	}
	previous := j.Steps[key]
	if previous != nil {
		if previous.Name != step || previous.Payload != string(encoded) {
			return nil, progressFailure("Submission inputs changed. ADS must reconcile the existing PrintIQ quote before continuing")
		}
		if previous.State == "done" {
			if j.validate != nil {
				if err := j.validate(step, previous.Response); err != nil {
					previous.State, previous.Failure = "pending", progressFailure(err.Error())
					if err := j.save(); err != nil {
						return nil, checkpointFailure("Unable to save invalid response checkpoint")
					}
					return previous.Response, previous.Failure
				}
			}
			return previous.Response, nil
		}
		if previous.State == "failed" && printIQFailureHasCreatedEntity(step, previous.Response) && (previous.Failure == nil || previous.Failure.Body["confirmedMissing"] != true) {
			previous.State = "pending"
		}
		// No idempotency guarantee: a lost response must never trigger a blind resend.
		if previous.State == "pending" || previous.State == "retryable_timeout" {
			if step == "GetQuoteQuestions" {
				previous.State = "failed"
			} else {
				previous.Failure = progressFailure("PrintIQ call outcome is uncertain. ADS must check the existing quote/job before this step can be retried")
				if err := j.save(); err != nil {
					return nil, checkpointFailure("Unable to save reconciliation state")
				}
				return nil, previous.Failure
			}
		}
		if previous.State != "failed" {
			return nil, progressFailure("Unrecognized submission step state; ADS must reconcile this step")
		}
	}
	if step == "UploadArtworkURL" && j.wait != nil {
		if err := j.wait(); err != nil {
			return nil, progressFailure("Submission interrupted; completed steps are saved")
		}
	}
	saved := &printIQSavedStep{Name: step, Payload: string(encoded), State: "pending", AutoRetry: autoRetry}
	if previous != nil {
		saved.Attempts = previous.Attempts
	}
	saved.Attempts = append(saved.Attempts, printIQStepAttempt{Payload: string(encoded), StartedAt: time.Now().UTC(), AutoRetry: autoRetry})
	j.Steps[key] = saved
	j.CurrentStep = key
	if err := j.save(); err != nil {
		return nil, checkpointFailure("Unable to save submission progress; no further PrintIQ request was sent")
	}
	attempt := 1
	if autoRetry {
		attempt = 2
	}
	started := time.Now()
	response, failure := call()
	if failure == nil && j.validate != nil {
		if err := j.validate(step, response); err != nil {
			failure = progressFailure(err.Error() + ". ADS must recover this PrintIQ result before retrying")
		}
	}
	if step == "UploadArtworkURL" {
		fields, _ := payload.(map[string]any)
		log.Printf("PrintIQ artwork upload submission=%s step=%s job=%v attempt=%d duration_ms=%d success=%t", j.ID, key, fields["JobNo"], attempt, time.Since(started).Milliseconds(), failure == nil)
	}
	saved.Response, saved.Failure = response, failure
	finishedAt := time.Now().UTC()
	lastAttempt := &saved.Attempts[len(saved.Attempts)-1]
	lastAttempt.FinishedAt, lastAttempt.Failure = &finishedAt, failure
	if failure == nil {
		saved.State = "done"
	} else {
		// Only an explicit PrintIQ application error is a known failed request.
		// Network/HTTP errors retain pending and require reconciliation.
		message, explicit := failure.Body["printIqMessage"].(string)
		lower := strings.ToLower(message)
		if step == "GetQuoteQuestions" || failure.Body["requestNotSent"] == true || (explicit && strings.TrimSpace(message) != "" && !strings.Contains(lower, "timed out") && !strings.Contains(lower, "timeout") && !printIQFailureHasCreatedEntity(step, response)) {
			saved.State = "failed"
		}
	}
	if err := j.save(); err != nil {
		saved.State = "pending"
		return nil, checkpointFailure("PrintIQ replied but progress could not be saved. ADS must reconcile this call before retrying")
	}
	return response, failure
}

func campaignSubmissionFingerprint(c *campaignRecord) string {
	encoded, _ := json.Marshal([]any{c.Values, c.PurchaseOrder})
	return fmt.Sprintf("%x", sha256.Sum256(encoded))
}

func (j *printIQJournal) hasChangedInputs(c *campaignRecord, test bool) bool {
	return j.Fingerprint != campaignSubmissionFingerprint(c) || j.Test != test
}

// Completed submissions are retained so a repeated Submit returns the original
// result, including when a browser lost the final success response.
func (a *app) loadLatestPrintIQJournal(ctx context.Context, campaign *campaignRecord, testModes ...bool) (*printIQJournal, error) {
	test := len(testModes) > 0 && testModes[0]
	var raw []byte
	var completed bool
	err := a.campaignStore.pool.QueryRow(ctx, `SELECT data, completed FROM printiq_submission_progress WHERE campaign_id=$1 AND tenant_id=$2 AND COALESCE(data->>'Test','false')=$3 ORDER BY completed ASC, updated_at DESC, id DESC LIMIT 1`, campaign.ID, campaign.TenantID, fmt.Sprint(test)).Scan(&raw, &completed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var journal printIQJournal
	if err := json.Unmarshal(raw, &journal); err != nil {
		return nil, err
	}
	if journal.Superseded {
		if test {
			return nil, nil
		}
		return nil, fmt.Errorf("An earlier PrintIQ attempt was superseded. ADS must reconcile its existing quote/jobs before this campaign can resume")
	}
	journal.Completed = completed
	for i := range journal.Plans {
		journal.Plans[i].Values.CreatedByDisplayName = journal.Creator
	}
	return &journal, nil
}

func (a *app) loadPrintIQJournal(ctx context.Context, campaign *campaignRecord, testModes ...bool) (*printIQJournal, error) {
	test := len(testModes) > 0 && testModes[0]
	var raw []byte
	err := a.campaignStore.pool.QueryRow(ctx, `SELECT data FROM printiq_submission_progress WHERE campaign_id=$1 AND tenant_id=$2 AND NOT completed AND COALESCE(data->>'Test','false')=$3`, campaign.ID, campaign.TenantID, fmt.Sprint(test)).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var journal printIQJournal
	if err := json.Unmarshal(raw, &journal); err != nil {
		return nil, err
	}
	for i := range journal.Plans {
		journal.Plans[i].Values.CreatedByDisplayName = journal.Creator
	}
	return &journal, nil
}

func (a *app) bindPrintIQJournal(requestContext context.Context, j *printIQJournal) error {
	// Fence a previous runner if its advisory-lock connection disappeared while
	// PrintIQ was responding. Claim and reload atomically to preserve its latest
	// checkpoints before accepting any new mutation intent.
	runnerID := uuid.NewString()
	var raw []byte
	if err := a.campaignStore.pool.QueryRow(requestContext, `UPDATE printiq_submission_progress SET data=jsonb_set(data,'{RunnerID}',to_jsonb($2::text)), updated_at=NOW() WHERE id=$1 AND NOT completed RETURNING data`, j.ID, runnerID).Scan(&raw); err != nil {
		return err
	}
	if err := json.Unmarshal(raw, j); err != nil {
		return err
	}
	for i := range j.Plans {
		j.Plans[i].Values.CreatedByDisplayName = j.Creator
	}
	j.save = func() error {
		// Persist even when the browser disconnects while PrintIQ is responding.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		raw, err := json.Marshal(j)
		if err != nil {
			return err
		}
		tag, err := a.campaignStore.pool.Exec(ctx, `UPDATE printiq_submission_progress SET data=$2::jsonb, updated_at=NOW() WHERE id=$1 AND NOT completed AND data->>'RunnerID'=$3`, j.ID, raw, runnerID)
		if err == nil && tag.RowsAffected() != 1 {
			return fmt.Errorf("submission progress missing")
		}
		return err
	}
	waitFor := func(delay time.Duration) error {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-requestContext.Done():
			return requestContext.Err()
		case <-timer.C:
			return nil
		}
	}
	j.wait = func() error { return waitFor(time.Second) }
	j.waitRetry = func() error { return waitFor(30 * time.Second) }
	return nil
}

func (a *app) createPrintIQJournal(ctx context.Context, campaign *campaignRecord, j *printIQJournal, supersededTestIDs ...string) error {
	j.ID = uuid.NewString()
	j.Fingerprint = campaignSubmissionFingerprint(campaign)
	j.Steps = map[string]*printIQSavedStep{}
	raw, err := json.Marshal(j)
	if err != nil {
		return err
	}
	if len(supersededTestIDs) > 0 && supersededTestIDs[0] != "" {
		if !j.Test {
			return errors.New("Only a test submission can replace a test attempt")
		}
		tx, err := a.campaignStore.pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		tag, err := tx.Exec(ctx, `UPDATE printiq_submission_progress SET completed=true, data=jsonb_set(data,'{Superseded}','true'::jsonb), updated_at=NOW() WHERE id=$1 AND campaign_id=$2 AND tenant_id=$3 AND NOT completed AND data->>'Test'='true'`, supersededTestIDs[0], campaign.ID, campaign.TenantID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("Previous test submission is no longer active")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO printiq_submission_progress(id,campaign_id,tenant_id,data) VALUES($1,$2,$3,$4::jsonb)`, j.ID, campaign.ID, campaign.TenantID, raw); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	_, err = a.campaignStore.pool.Exec(ctx, `INSERT INTO printiq_submission_progress(id,campaign_id,tenant_id,data) VALUES($1,$2,$3,$4::jsonb)`, j.ID, campaign.ID, campaign.TenantID, raw)
	return err
}

type printIQRecordCheckpoint struct {
	ID     string
	Market string
	Final  bool
}

type printIQUploadResolution struct {
	StepKey string    `json:"stepKey"`
	Action  string    `json:"action"`
	Note    string    `json:"note"`
	UserID  string    `json:"userId"`
	At      time.Time `json:"at"`
}

func (j *printIQJournal) resolveUpload(key, action, note, userID string) error {
	step := j.Steps[key]
	if step == nil || step.Name != "UploadArtworkURL" || (step.State != "pending" && step.State != "failed" && step.State != "retryable_timeout") {
		return errors.New("Only an unresolved artwork upload can be reconciled")
	}
	if strings.TrimSpace(note) == "" {
		return errors.New("Record what was verified in PrintIQ")
	}
	switch action {
	case "confirmed_uploaded":
		step.State = "done"
		step.Response = map[string]any{"IsError": false, "Reconciled": true}
		step.Failure = nil
	case "confirmed_missing":
		step.State = "failed"
		step.Failure = progressFailure("Attachment confirmed missing; ready for retry")
	default:
		return errors.New("Action must be confirmed_uploaded or confirmed_missing")
	}
	j.Resolutions = append(j.Resolutions, printIQUploadResolution{StepKey: key, Action: action, Note: note, UserID: userID, At: time.Now().UTC()})
	return nil
}

// Read/reconcile endpoints are restricted to super admins and the managed tenant.
// They record verified results or absence without sending a PrintIQ mutation.
func (a *app) handlePrintIQProgress(w http.ResponseWriter, r *http.Request) {
	user, err := a.userWithManagedTenant(r)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	if user.Role != "super_admin" {
		writeJSON(w, 403, map[string]string{"error": "Only super admins can reconcile PrintIQ submissions"})
		return
	}
	campaign, err := a.campaignStore.getCampaign(r.Context(), *user, r.PathValue("campaignId"))
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "Campaign not found"})
		return
	}
	if r.Method == http.MethodGet {
		j, err := a.loadPrintIQJournal(r.Context(), campaign, parseBoolQuery(r.URL.Query().Get("test")))
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "Unable to load submission progress"})
			return
		}
		if j == nil {
			writeJSON(w, 404, map[string]string{"error": "No active submission progress"})
			return
		}
		writeJSON(w, 200, map[string]any{"submissionId": j.ID, "status": j.submissionStatus(), "steps": j.Steps, "resolutions": j.Resolutions})
		return
	}
	var input struct {
		SubmissionID string `json:"submissionId"`
		StepKey      string `json:"stepKey"`
		Action       string `json:"action"`
		Note         string `json:"note"`
		Confirmed    bool   `json:"confirmedInPrintIQ"`
		Response     any    `json:"response"`
	}
	if err := decodeJSONBody(r, &input); err != nil || !input.Confirmed {
		writeJSON(w, 400, map[string]string{"error": "Confirm the operation state in PrintIQ before resolving it"})
		return
	}
	tx, err := a.campaignStore.pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "Unable to lock progress"})
		return
	}
	defer tx.Rollback(r.Context())
	var locked bool
	if err = tx.QueryRow(r.Context(), "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))", "printiq:"+campaign.ID).Scan(&locked); err != nil || !locked {
		writeJSON(w, 409, map[string]string{"error": "Campaign submission is running; try after it finishes"})
		return
	}
	var raw []byte
	if err = tx.QueryRow(r.Context(), `SELECT data FROM printiq_submission_progress WHERE id=$1 AND campaign_id=$2 AND tenant_id=$3 AND NOT completed FOR UPDATE`, input.SubmissionID, campaign.ID, campaign.TenantID).Scan(&raw); err != nil {
		writeJSON(w, 409, map[string]string{"error": "Active submission not found"})
		return
	}
	var j printIQJournal
	if err = json.Unmarshal(raw, &j); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Unable to read submission"})
		return
	}
	if strings.HasSuffix(r.URL.Path, "/resolve-step") {
		err = j.resolveStep(input.StepKey, input.Action, input.Note, user.ID, input.Response)
	} else {
		err = j.resolveUpload(input.StepKey, input.Action, input.Note, user.ID)
	}
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	// An old runner may still be waiting for PrintIQ after losing its lock
	// connection. Reconciliation revokes its write access as well.
	j.RunnerID = ""
	raw, err = json.Marshal(j)
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE printiq_submission_progress SET data=$2::jsonb,updated_at=NOW() WHERE id=$1`, j.ID, raw)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "Unable to save reconciliation"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "message": "PrintIQ step reconciled. Submit again to resume the saved submission."})
}
