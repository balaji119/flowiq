package main

import "testing"

func TestPublicSpacesHostUsesDigitalOceanCDNHost(t *testing.T) {
	host := publicSpacesHost("adsartwork", "syd1.digitaloceanspaces.com")
	if host != "adsartwork.syd1.cdn.digitaloceanspaces.com" {
		t.Fatalf("unexpected public host: %s", host)
	}
}
