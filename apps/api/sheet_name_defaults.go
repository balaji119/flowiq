package main

import "encoding/json"

func defaultSheetNameOverrides() sheetNameOverrides {
	return sheetNameOverrides{
		"8-sheet":    "Quad",
		"8-sheet-a0": "Quad A0",
		"6-sheet":    "Triple",
		"4-sheet":    "Double",
		"2-sheet":    "Single",
	}
}

func defaultSheetNameOverridesJSON() (string, error) {
	encoded, err := json.Marshal(defaultSheetNameOverrides())
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
