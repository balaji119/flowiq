package main

import (
	"fmt"
	"regexp"
	"strconv"
)

var explicitCreativeNamePattern = regexp.MustCompile(`^Creative([1-9][0-9]*)$`)

// Validate before any PrintIQ calls, including retries and super-admin test submits.
func validateCreativeNames(values orderFormValues) error {
	images := map[string]bool{}
	for _, image := range values.PrintImages {
		images[image.ID] = true
	}
	assignedImages := map[string]bool{}
	assignedNumbers := map[int64]bool{}
	for name, imageID := range values.CreativeNameAssignments {
		if !images[imageID] {
			continue
		} // Deleted artwork does not reserve a name.
		match := explicitCreativeNamePattern.FindStringSubmatch(name)
		if len(match) != 2 {
			return fmt.Errorf("Each artwork must have one unique creative name. Clear duplicate or invalid assignments first.")
		}
		number, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil || number > 9007199254740991 || assignedImages[imageID] || assignedNumbers[number] {
			return fmt.Errorf("Each artwork must have one unique creative name. Clear duplicate or invalid assignments first.")
		}
		assignedImages[imageID] = true
		assignedNumbers[number] = true
	}
	if len(images) == 0 || len(assignedImages) != len(images) {
		return fmt.Errorf("Assign a creative name to every artwork before submitting to PrintIQ or downloading visuals or installs.")
	}
	return nil
}
