DROP INDEX printiq_submission_progress_active;
CREATE UNIQUE INDEX printiq_submission_progress_active
    ON printiq_submission_progress(campaign_id, (COALESCE(data->>'Test', 'false')))
    WHERE NOT completed;
