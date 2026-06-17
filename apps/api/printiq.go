package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var defaultJobOperations = []OperationOption{
	{Label: "Preflight", OperationName: "Preflight", EnabledByDefault: true},
	{Label: "Proof PDF", OperationName: "* PROOF PDF", EnabledByDefault: true},
	{Label: "File Setup", OperationName: "*FILE SETUP ADS", EnabledByDefault: true},
	{Label: "Auto to Press", OperationName: "Auto to Press", EnabledByDefault: true},
	{Label: "Standard Pack and Wrap", OperationName: "* Standard Pack and Wrap", EnabledByDefault: true},
}

var defaultSectionOperations = []OperationOption{
	{Label: "Cut - Kongsberg Table Cutter", OperationName: "CUT - Kongsberg Table Cutter", EnabledByDefault: true},
	{Label: "Trim to Size", OperationName: "Trim to Size"},
	{Label: "Drill Holes", OperationName: "Drill Holes"},
	{Label: "Round Corners", OperationName: "Round Corners"},
}

type optionService struct {
	baseURL          string
	dataDir          string
	httpClient       *http.Client
	mu               sync.Mutex
	cachedLoginToken string
	cacheExpiry      time.Time
}

func newOptionService(baseURL, dataDir string) *optionService {
	return &optionService{
		baseURL:    strings.TrimRight(baseURL, "/"),
		dataDir:    dataDir,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

func (o *optionService) stockDefinitionsPath() string {
	return filepath.Join(o.dataDir, "printiq-stock-definitions.json")
}

func (o *optionService) processTypesPath() string {
	return filepath.Join(o.dataDir, "printiq-process-types.json")
}

func (o *optionService) ensureDataDir() error {
	return os.MkdirAll(o.dataDir, 0o755)
}

func (o *optionService) getAccessToken() string {
	return strings.TrimSpace(os.Getenv("PRINTIQ_ACCESS_TOKEN"))
}

func (o *optionService) getCachedLoginToken() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.cachedLoginToken != "" && time.Now().Before(o.cacheExpiry) {
		return o.cachedLoginToken
	}
	return ""
}

func (o *optionService) setCachedLoginToken(token string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.cachedLoginToken = token
	o.cacheExpiry = time.Now().Add(10 * time.Minute)
}

func (o *optionService) clearCachedLoginToken() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.cachedLoginToken = ""
	o.cacheExpiry = time.Time{}
}

func decodeEnvValue(value string) string {
	decoded, err := url.QueryUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}

func appendLoginToken(baseURL, encodedToken string) string {
	if strings.Contains(baseURL, "?") {
		return baseURL + "&LoginToken=" + encodedToken
	}
	return baseURL + "?LoginToken=" + encodedToken
}

func (o *optionService) getLoginToken() (string, error) {
	if cached := o.getCachedLoginToken(); cached != "" {
		return cached, nil
	}

	username, err := requiredEnv("PRINTIQ_USERNAME")
	if err != nil {
		return "", err
	}
	password, err := requiredEnv("PRINTIQ_PASSWORD")
	if err != nil {
		return "", err
	}
	applicationName, err := requiredEnv("PRINTIQ_APPLICATION_NAME")
	if err != nil {
		return "", err
	}
	applicationKey, err := requiredEnv("PRINTIQ_APPLICATION_KEY")
	if err != nil {
		return "", err
	}

	params := url.Values{
		"UserName":        {decodeEnvValue(username)},
		"Password":        {decodeEnvValue(password)},
		"ApplicationName": {decodeEnvValue(applicationName)},
		"ApplicationKey":  {decodeEnvValue(applicationKey)},
	}
	tokenURL := fmt.Sprintf("%s/api/QuoteProcess/GetApplicationLogInToken", o.baseURL)
	attempts := []struct {
		name string
		req  func() (*http.Response, error)
	}{
		{
			name: "POST querystring",
			req: func() (*http.Response, error) {
				request, _ := http.NewRequest(http.MethodPost, tokenURL+"?"+params.Encode(), nil)
				return o.httpClient.Do(request)
			},
		},
		{
			name: "POST form body",
			req: func() (*http.Response, error) {
				request, _ := http.NewRequest(http.MethodPost, tokenURL, strings.NewReader(params.Encode()))
				request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
				return o.httpClient.Do(request)
			},
		},
		{
			name: "GET querystring",
			req: func() (*http.Response, error) {
				request, _ := http.NewRequest(http.MethodGet, tokenURL+"?"+params.Encode(), nil)
				return o.httpClient.Do(request)
			},
		},
	}

	failures := make([]string, 0)
	for _, attempt := range attempts {
		response, err := attempt.req()
		if err != nil {
			failures = append(failures, attempt.name+" -> "+err.Error())
			continue
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			token := strings.TrimSpace(strings.Trim(string(body), `"`))
			o.setCachedLoginToken(token)
			return token, nil
		}

		failures = append(failures, fmt.Sprintf("%s -> (%d) %s", attempt.name, response.StatusCode, string(body)))
		if response.StatusCode != 400 && response.StatusCode != 404 && response.StatusCode != 405 {
			break
		}
	}

	return "", fmt.Errorf("Token request failed. Attempts: %s", strings.Join(failures, " | "))
}

func (o *optionService) fetchWithAccessToken(requestURL, accessToken string) (*http.Response, error) {
	request, _ := http.NewRequest(http.MethodGet, requestURL, nil)
	request.Header.Set("PrintIQ-Access-Token", accessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := o.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	return nil, fmt.Errorf("PrintIQ options request failed (%d): %s", response.StatusCode, string(body))
}

func (o *optionService) fetchWithLoginToken(requestURL, loginToken string) (*http.Response, error) {
	encodedToken := url.QueryEscape(loginToken)
	attempts := []struct {
		name       string
		requestURL string
		headers    map[string]string
	}{
		{name: "querystring login token", requestURL: appendLoginToken(requestURL, encodedToken), headers: map[string]string{"Content-Type": "application/json"}},
		{name: "LoginToken header", requestURL: requestURL, headers: map[string]string{"Content-Type": "application/json", "LoginToken": encodedToken}},
		{name: "PrintIQ-Login-Token header", requestURL: requestURL, headers: map[string]string{"Content-Type": "application/json", "PrintIQ-Login-Token": encodedToken}},
		{name: "Authorization bearer token", requestURL: requestURL, headers: map[string]string{"Content-Type": "application/json", "Authorization": "Bearer " + encodedToken}},
		{name: "Authorization raw token", requestURL: requestURL, headers: map[string]string{"Content-Type": "application/json", "Authorization": encodedToken}},
	}

	failures := make([]string, 0)
	for _, attempt := range attempts {
		request, _ := http.NewRequest(http.MethodGet, attempt.requestURL, nil)
		for key, value := range attempt.headers {
			request.Header.Set(key, value)
		}
		response, err := o.httpClient.Do(request)
		if err != nil {
			failures = append(failures, attempt.name+" -> "+err.Error())
			continue
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			return response, nil
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		failures = append(failures, fmt.Sprintf("%s -> (%d) %s", attempt.name, response.StatusCode, string(body)))
		if response.StatusCode != 400 && response.StatusCode != 401 && response.StatusCode != 403 && response.StatusCode != 404 && response.StatusCode != 405 {
			break
		}
	}

	return nil, fmt.Errorf("PrintIQ options request failed. Attempts: %s", strings.Join(failures, " | "))
}

func (o *optionService) getLoginTokenWithRetry() (string, error) {
	token, err := o.getLoginToken()
	if err == nil {
		return token, nil
	}
	o.clearCachedLoginToken()
	return o.getLoginToken()
}

func (o *optionService) fetchAllODataPages(baseURL string) ([]map[string]any, error) {
	results := make([]map[string]any, 0)
	nextURL := baseURL
	accessToken := o.getAccessToken()

	for nextURL != "" {
		var response *http.Response
		var err error

		if accessToken != "" {
			response, err = o.fetchWithAccessToken(nextURL, accessToken)
		} else {
			token, tokenErr := o.getLoginTokenWithRetry()
			if tokenErr != nil {
				return nil, tokenErr
			}
			response, err = o.fetchWithLoginToken(nextURL, token)
		}
		if err != nil {
			return nil, err
		}

		body, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			return nil, readErr
		}

		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			return nil, err
		}
		if rawValues, ok := payload["value"].([]any); ok {
			for _, rawValue := range rawValues {
				if item, ok := rawValue.(map[string]any); ok {
					results = append(results, item)
				}
			}
		}
		if next, ok := payload["@odata.nextLink"].(string); ok {
			nextURL = next
		} else {
			nextURL = ""
		}
	}

	return results, nil
}

func (o *optionService) readCache(path string, target any) error {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(bytes) == 0 {
		return nil
	}
	return json.Unmarshal(bytes, target)
}

func (o *optionService) writeCache(path string, data any) error {
	if err := o.ensureDataDir(); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, bytes, 0o644)
}

func fileMeta(path string) cacheBucket {
	info, err := os.Stat(path)
	if err != nil {
		return cacheBucket{Cached: false, Count: 0, UpdatedAt: nil}
	}
	bytes, readErr := os.ReadFile(path)
	if readErr != nil {
		return cacheBucket{Cached: true, Count: 0, UpdatedAt: stringPtr(info.ModTime().UTC().Format(time.RFC3339))}
	}
	var items []any
	_ = json.Unmarshal(bytes, &items)
	return cacheBucket{
		Cached:    true,
		Count:     len(items),
		UpdatedAt: stringPtr(info.ModTime().UTC().Format(time.RFC3339)),
	}
}

func (o *optionService) getStockDefinitions(forceRefresh bool) ([]PrintIQStockOption, error) {
	path := o.stockDefinitionsPath()
	if !forceRefresh {
		var cached []PrintIQStockOption
		if err := o.readCache(path, &cached); err == nil && len(cached) > 0 {
			return cached, nil
		}
	}

	rawStocks, err := o.fetchAllODataPages(o.baseURL + "/api/v1/odata/StockDefinitions")
	if err != nil {
		return nil, err
	}

	stocks := make([]PrintIQStockOption, 0, len(rawStocks))
	for _, stock := range rawStocks {
		code, _ := stock["Code"].(string)
		if strings.TrimSpace(code) == "" {
			continue
		}
		description, _ := stock["Description"].(string)
		stocks = append(stocks, PrintIQStockOption{Value: code, Label: code, Description: description})
	}
	if err := o.writeCache(path, stocks); err != nil {
		return nil, err
	}
	return stocks, nil
}

func (o *optionService) getProcessTypes(forceRefresh bool) ([]map[string]string, error) {
	path := o.processTypesPath()
	if !forceRefresh {
		var cached []map[string]string
		if err := o.readCache(path, &cached); err == nil && len(cached) > 0 {
			return cached, nil
		}
	}

	rawProcesses, err := o.fetchAllODataPages(o.baseURL + "/api/v1/odata/Processes")
	if err != nil {
		return nil, err
	}

	processes := make([]map[string]string, 0, len(rawProcesses))
	for _, process := range rawProcesses {
		description, _ := process["Description"].(string)
		description = strings.TrimSpace(description)
		if description == "" {
			continue
		}
		processes = append(processes, map[string]string{"value": description, "label": description})
	}
	if err := o.writeCache(path, processes); err != nil {
		return nil, err
	}
	return processes, nil
}

func (o *optionService) searchStockDefinitions(query string) ([]PrintIQStockOption, error) {
	stocks, err := o.getStockDefinitions(false)
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	filtered := make([]PrintIQStockOption, 0, 20)
	for _, stock := range stocks {
		if query == "" || strings.Contains(strings.ToLower(stock.Value), query) || strings.Contains(strings.ToLower(stock.Description), query) {
			filtered = append(filtered, stock)
			if len(filtered) == 20 {
				break
			}
		}
	}
	return filtered, nil
}

func (o *optionService) searchProcessTypes(query string) ([]map[string]string, error) {
	processes, err := o.getProcessTypes(false)
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	filtered := make([]map[string]string, 0, 20)
	for _, process := range processes {
		if query == "" || strings.Contains(strings.ToLower(process["value"]), query) {
			filtered = append(filtered, process)
			if len(filtered) == 20 {
				break
			}
		}
	}
	return filtered, nil
}

func (o *optionService) getQuoteFormOptions() quoteFormOptions {
	return quoteFormOptions{JobOperations: defaultJobOperations, SectionOperations: defaultSectionOperations}
}

func (o *optionService) getOptionsCacheStatus() optionsCacheStatus {
	return optionsCacheStatus{
		Stocks:    fileMeta(o.stockDefinitionsPath()),
		Processes: fileMeta(o.processTypesPath()),
	}
}

func (o *optionService) refreshOptionsCache() (cacheRefreshBucket, cacheRefreshBucket, error) {
	stocks, err := o.getStockDefinitions(true)
	if err != nil {
		return cacheRefreshBucket{}, cacheRefreshBucket{}, err
	}
	processes, err := o.getProcessTypes(true)
	if err != nil {
		return cacheRefreshBucket{}, cacheRefreshBucket{}, err
	}
	status := o.getOptionsCacheStatus()
	return cacheRefreshBucket{Count: len(stocks), UpdatedAt: status.Stocks.UpdatedAt}, cacheRefreshBucket{Count: len(processes), UpdatedAt: status.Processes.UpdatedAt}, nil
}

func (o *optionService) postQuoteProcess(endpoint string, payload any) (any, int, error) {
	token, err := o.getLoginToken()
	if err != nil {
		return nil, 500, err
	}
	requestURL := appendLoginToken(o.baseURL+"/api/QuoteProcess/"+strings.TrimLeft(endpoint, "/"), url.QueryEscape(token))
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 500, err
	}

	request, _ := http.NewRequest(http.MethodPost, requestURL, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := o.httpClient.Do(request)
	if err != nil {
		return nil, 500, err
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, 500, err
	}

	var parsed any
	if len(responseBody) > 0 {
		if err := json.Unmarshal(responseBody, &parsed); err != nil {
			parsed = string(responseBody)
		}
	}
	return parsed, response.StatusCode, nil
}

func (o *optionService) createQuoteWithDelivery(payload any) (any, int, error) {
	return o.postQuoteProcess("CreateQuoteWithDelivery", payload)
}

func (o *optionService) acceptQuote(payload any) (any, int, error) {
	return o.postQuoteProcess("AcceptQuote", payload)
}

func (o *optionService) uploadArtworkURL(payload any) (any, int, error) {
	return o.postQuoteProcess("UploadArtworkURL", payload)
}

func valueAtPath(result any, path ...string) any {
	current := result
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func printIQStringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return fmt.Sprintf("%d", int64(typed))
		}
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	case int:
		return strconv.Itoa(typed)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func extractQuoteNo(result any) string {
	if quoteNo := printIQStringValue(valueAtPath(result, "QuoteDetails", "QuoteNo")); quoteNo != "" {
		return quoteNo
	}
	return printIQStringValue(valueAtPath(result, "QuoteNo"))
}

func extractJobNo(result any) string {
	if jobNo := findStringField(result, "JobNo"); jobNo != "" {
		return jobNo
	}
	return findStringField(result, "JobNumber")
}

func extractQSTKey(result any) any {
	if qstKey := findNonZeroField(result, "QSTKey"); qstKey != nil {
		return qstKey
	}
	return nil
}

func findStringField(value any, fieldName string) string {
	switch typed := value.(type) {
	case map[string]any:
		if result := printIQStringValue(typed[fieldName]); result != "" {
			return result
		}
		for _, nested := range typed {
			if result := findStringField(nested, fieldName); result != "" {
				return result
			}
		}
	case []any:
		for _, nested := range typed {
			if result := findStringField(nested, fieldName); result != "" {
				return result
			}
		}
	}
	return ""
}

func findNonZeroField(value any, fieldName string) any {
	switch typed := value.(type) {
	case map[string]any:
		if raw, exists := typed[fieldName]; exists && !isZeroValue(raw) {
			return raw
		}
		for _, nested := range typed {
			if result := findNonZeroField(nested, fieldName); result != nil {
				return result
			}
		}
	case []any:
		for _, nested := range typed {
			if result := findNonZeroField(nested, fieldName); result != nil {
				return result
			}
		}
	}
	return nil
}

func isZeroValue(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(typed) == "" || strings.TrimSpace(typed) == "0"
	case float64:
		return typed == 0
	case int:
		return typed == 0
	case json.Number:
		return typed.String() == "0" || strings.TrimSpace(typed.String()) == ""
	default:
		return false
	}
}
