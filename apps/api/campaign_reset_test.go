package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResetCampaignStatusRejectsNonSuperAdmins(t *testing.T) {
	for _, role := range []string{"user", "admin", ""} {
		t.Run(role, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/campaigns/campaign-id/reset-status", nil)
			req = req.WithContext(context.WithValue(req.Context(), authUserKey, AuthUser{Role: role}))
			response := httptest.NewRecorder()
			// No database is configured: unauthorized requests must stop before accessing it.
			(&app{}).handleResetCampaignStatus(response, req)
			if response.Code != http.StatusForbidden {
				t.Fatalf("got status %d, want %d", response.Code, http.StatusForbidden)
			}
		})
	}
}

func TestResetCampaignStatusRequiresTenant(t *testing.T) {
	_, err := (&campaignStore{}).resetCampaignStatus(context.Background(), AuthUser{Role: "super_admin"}, "campaign-id")
	if err == nil || err.Error() != "current user is not assigned to a tenant" {
		t.Fatalf("expected missing tenant error, got %v", err)
	}
}
