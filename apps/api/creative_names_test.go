package main

import (
	"encoding/json"
	"testing"
)

func TestValidateExplicitCreativeNames(t *testing.T) {
	for _, tc := range []struct {
		name        string
		assignments map[string]string
		valid       bool
	}{
		{"new artwork stays unnamed", nil, false},
		{"partially assigned", map[string]string{"Creative1": "a"}, false},
		{"all assigned out of order", map[string]string{"Creative2": "a", "Creative1": "b"}, true},
		{"two names for one artwork", map[string]string{"Creative1": "a", "Creative2": "a"}, false},
		{"invalid name", map[string]string{"Creative0": "a", "Creative2": "b"}, false},
		{"case variant", map[string]string{"creative1": "a", "Creative2": "b"}, false},
		{"stale deleted artwork", map[string]string{"Creative1": "a", "Creative2": "b", "Creative3": "deleted"}, true},
		{"preserve saved higher number after deletion", map[string]string{"Creative4": "a", "Creative2": "b"}, true},
		{"unsafe number", map[string]string{"Creative9007199254740992": "a", "Creative2": "b"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			values := orderFormValues{PrintImages: []campaignPrintImage{{ID: "a"}, {ID: "b"}}, CreativeNameAssignments: tc.assignments}
			if err := validateCreativeNames(values); (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}

func TestClearedCreativeNamesStayUnassignedAfterReload(t *testing.T) {
	original := orderFormValues{PrintImages: []campaignPrintImage{{ID: "a"}}, CreativeNameAssignments: map[string]string{}}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var reloaded orderFormValues
	if err := json.Unmarshal(data, &reloaded); err != nil {
		t.Fatal(err)
	}
	if len(reloaded.CreativeNameAssignments) != 0 {
		t.Fatal("reload assigned a name automatically")
	}
	if validateCreativeNames(reloaded) == nil {
		t.Fatal("cleared names must block submission")
	}
}
