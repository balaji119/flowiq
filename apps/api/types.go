package main

type OperationOption struct {
	ID               string `json:"id,omitempty"`
	Label            string `json:"label"`
	OperationName    string `json:"operationName"`
	EnabledByDefault bool   `json:"enabledByDefault,omitempty"`
}

type PrintIQStockOption struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

type TenantRecord struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type AuthUser struct {
	ID         string  `json:"id"`
	Email      string  `json:"email"`
	Name       string  `json:"name"`
	Role       string  `json:"role"`
	TenantID   *string `json:"tenantId"`
	TenantName *string `json:"tenantName"`
	Active     bool    `json:"active"`
}

type contactDetails struct {
	Title     string `json:"title"`
	FirstName string `json:"firstName"`
	Surname   string `json:"surname"`
	Email     string `json:"email"`
}

type orderFormValues struct {
	CustomerCode              string           `json:"customerCode"`
	CustomerReference         string           `json:"customerReference"`
	CampaignName              string           `json:"campaignName"`
	JobDescription            string           `json:"jobDescription"`
	Notes                     string           `json:"notes"`
	ProductCategory           string           `json:"productCategory"`
	SectionType               string           `json:"sectionType"`
	FoldCatalog               string           `json:"foldCatalog"`
	StockCode                 string           `json:"stockCode"`
	ProcessFront              string           `json:"processFront"`
	ProcessReverse            string           `json:"processReverse"`
	TargetFreightPrice        string           `json:"targetFreightPrice"`
	Quantity                  string           `json:"quantity"`
	FinishWidth               string           `json:"finishWidth"`
	FinishHeight              string           `json:"finishHeight"`
	SectionWidth              string           `json:"sectionWidth"`
	SectionHeight             string           `json:"sectionHeight"`
	Pages                     string           `json:"pages"`
	KindName                  string           `json:"kindName"`
	CampaignStartDate         string           `json:"campaignStartDate"`
	DueDate                   string           `json:"dueDate"`
	NumberOfWeeks             string           `json:"numberOfWeeks"`
	CampaignMarkets           []campaignMarket `json:"campaignMarkets"`
	Contact                   contactDetails   `json:"contact"`
	SelectedJobOperations     []string         `json:"selectedJobOperations"`
	SelectedSectionOperations []string         `json:"selectedSectionOperations"`
}

type campaignAsset struct {
	ID            string `json:"id"`
	AssetID       string `json:"assetId"`
	AssetSearch   string `json:"assetSearch"`
	SelectedWeeks []int  `json:"selectedWeeks"`
}

type campaignMarket struct {
	ID     string          `json:"id"`
	Market string          `json:"market"`
	Assets []campaignAsset `json:"assets"`
}

type purchaseOrderDetails struct {
	OriginalName string `json:"originalName"`
	StoredName   string `json:"storedName"`
	MimeType     string `json:"mimeType"`
	Size         int64  `json:"size"`
	UploadedAt   string `json:"uploadedAt"`
}

type campaignRecord struct {
	ID                string                `json:"id"`
	TenantID          string                `json:"tenantId"`
	CreatedByUserID   string                `json:"createdByUserId"`
	UpdatedByUserID   string                `json:"updatedByUserId"`
	Status            string                `json:"status"`
	Values            orderFormValues       `json:"values"`
	Summary           *campaignSummary      `json:"summary"`
	PurchaseOrder     *purchaseOrderDetails `json:"purchaseOrder"`
	LatestQuoteAmount any                   `json:"latestQuoteAmount"`
	CreatedAt         string                `json:"createdAt"`
	UpdatedAt         string                `json:"updatedAt"`
}

type cacheBucket struct {
	Cached    bool    `json:"cached"`
	Count     int     `json:"count"`
	UpdatedAt *string `json:"updatedAt"`
}

type cacheRefreshBucket struct {
	Count     int     `json:"count"`
	UpdatedAt *string `json:"updatedAt"`
}

type optionsCacheStatus struct {
	Stocks    cacheBucket `json:"stocks"`
	Processes cacheBucket `json:"processes"`
}

type quoteFormOptions struct {
	JobOperations     []OperationOption `json:"jobOperations"`
	SectionOperations []OperationOption `json:"sectionOperations"`
}

type quantityBreakdown map[string]int

type marketAssetOption struct {
	ID         string            `json:"id"`
	Market     string            `json:"market"`
	Asset      string            `json:"asset"`
	Label      string            `json:"label"`
	State      string            `json:"state"`
	Quantities quantityBreakdown `json:"quantities"`
}

type marketMetadata struct {
	Name   string              `json:"name"`
	Assets []marketAssetOption `json:"assets"`
}

type campaignLine struct {
	ID            string `json:"id"`
	AssetID       string `json:"assetId"`
	AssetSearch   string `json:"assetSearch,omitempty"`
	SelectedWeeks []int  `json:"selectedWeeks"`
	Market        string `json:"market,omitempty"`
}

type campaignLineResult struct {
	ID            string            `json:"id"`
	Market        string            `json:"market"`
	AssetLabel    string            `json:"assetLabel"`
	State         string            `json:"state"`
	RunCount      int               `json:"runCount"`
	SelectedWeeks []int             `json:"selectedWeeks"`
	Breakdown     quantityBreakdown `json:"breakdown"`
}

type campaignTotals struct {
	Market             string            `json:"market"`
	Breakdown          quantityBreakdown `json:"breakdown"`
	PosterTotal        int               `json:"posterTotal"`
	FrameTotal         int               `json:"frameTotal"`
	SpecialFormatTotal int               `json:"specialFormatTotal"`
	TotalUnits         int               `json:"totalUnits"`
	ActiveAssets       int               `json:"activeAssets"`
	ActiveRuns         int               `json:"activeRuns"`
}

type campaignSummary struct {
	Lines      []campaignLineResult `json:"lines"`
	PerMarket  []campaignTotals     `json:"perMarket"`
	GrandTotal campaignTotals       `json:"grandTotal"`
}

type uploadResponse struct {
	OriginalName string `json:"originalName"`
	StoredName   string `json:"storedName"`
	Size         int64  `json:"size"`
	MimeType     string `json:"mimeType"`
	UploadedAt   string `json:"uploadedAt"`
}
