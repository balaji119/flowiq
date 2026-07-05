package main

type PrintIQStockOption struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

type TenantRecord struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	UserCount     int    `json:"userCount"`
	CampaignCount int    `json:"campaignCount"`
	CreatedAt     string `json:"createdAt,omitempty"`
}

type sheetNameOverrides map[string]string

type sheetNameOverrideRecord struct {
	TenantID               string             `json:"tenantId"`
	Overrides              sheetNameOverrides `json:"overrides"`
	MultipleArtworkFormats map[string]bool    `json:"multipleArtworkFormats,omitempty"`
	CustomPrintCostFormats map[string]bool    `json:"customPrintCostFormats,omitempty"`
	CreatedAt              string             `json:"createdAt"`
	UpdatedAt              string             `json:"updatedAt"`
}

type materialInput struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	IsDefault bool   `json:"isDefault"`
}

type materialRecord struct {
	ID        string `json:"id"`
	TenantID  string `json:"tenantId"`
	Name      string `json:"name"`
	IsDefault bool   `json:"isDefault"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type customPrintCostInput struct {
	SheetKey        string  `json:"sheetKey"`
	OnePageCost     float64 `json:"onePageCost"`
	TwoPageCost     float64 `json:"twoPageCost"`
	FivePageCost    float64 `json:"fivePageCost"`
	TenPlusPageCost float64 `json:"tenPlusPageCost"`
}

type customPrintCostRecord struct {
	TenantID        string  `json:"tenantId"`
	SheetKey        string  `json:"sheetKey"`
	OnePageCost     float64 `json:"onePageCost"`
	TwoPageCost     float64 `json:"twoPageCost"`
	FivePageCost    float64 `json:"fivePageCost"`
	TenPlusPageCost float64 `json:"tenPlusPageCost"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
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

type campaignPrintImage struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	FileName            string `json:"fileName"`
	MimeType            string `json:"mimeType"`
	StoredName          string `json:"storedName,omitempty"`
	ImageURL            string `json:"imageUrl,omitempty"`
	ThumbnailFileName   string `json:"thumbnailFileName,omitempty"`
	ThumbnailStoredName string `json:"thumbnailStoredName,omitempty"`
	ThumbnailURL        string `json:"thumbnailUrl,omitempty"`
	SourcePDFFileName   string `json:"sourcePdfFileName,omitempty"`
	SourcePDFStoredName string `json:"sourcePdfStoredName,omitempty"`
	SourcePDFURL        string `json:"sourcePdfUrl,omitempty"`
}

type orderFormValues struct {
	CustomerCode            string               `json:"customerCode"`
	CustomerReference       string               `json:"customerReference"`
	CampaignName            string               `json:"campaignName"`
	JobDescription          string               `json:"jobDescription"`
	Notes                   string               `json:"notes"`
	ProductCategory         string               `json:"productCategory"`
	SectionType             string               `json:"sectionType"`
	FoldCatalog             string               `json:"foldCatalog"`
	StockCode               string               `json:"stockCode"`
	Packing                 string               `json:"packing"`
	Finish                  string               `json:"finish"`
	Print                   string               `json:"print"`
	ProductCode             string               `json:"productCode"`
	TargetFreightPrice      string               `json:"targetFreightPrice"`
	Quantity                string               `json:"quantity"`
	FinishWidth             string               `json:"finishWidth"`
	FinishHeight            string               `json:"finishHeight"`
	SectionWidth            string               `json:"sectionWidth"`
	SectionHeight           string               `json:"sectionHeight"`
	Pages                   string               `json:"pages"`
	KindName                string               `json:"kindName"`
	CampaignStartDate       string               `json:"campaignStartDate"`
	DueDate                 string               `json:"dueDate"`
	NumberOfWeeks           string               `json:"numberOfWeeks"`
	PrintImages             []campaignPrintImage `json:"printImages"`
	CreativeNameAssignments map[string]string    `json:"creativeNameAssignments,omitempty"`
	CampaignMarkets         []campaignMarket     `json:"campaignMarkets"`
	Contact                 contactDetails       `json:"contact"`
}

type campaignAsset struct {
	ID                         string                                 `json:"id"`
	AssetID                    string                                 `json:"assetId"`
	AssetSearch                string                                 `json:"assetSearch"`
	SelectedWeeks              []int                                  `json:"selectedWeeks"`
	CreativeImageID            string                                 `json:"creativeImageId"`
	CreativeImageIDs           map[string]string                      `json:"creativeImageIds,omitempty"`
	ArtworkMaterialAssignments map[string][]artworkMaterialAssignment `json:"artworkMaterialAssignments,omitempty"`
	QuantityOverrides          *campaignQuantityOverrides             `json:"quantityOverrides,omitempty"`
	DeliveryAddress            string                                 `json:"deliveryAddress"`
}

type artworkMaterialAssignment struct {
	ArtworkImageID string `json:"artworkImageId"`
	MaterialID     string `json:"materialId"`
	FrameCount     int    `json:"frameCount"`
}

type campaignMarket struct {
	ID                string                     `json:"id"`
	Market            string                     `json:"market"`
	Assets            []campaignAsset            `json:"assets"`
	QuantityOverrides *campaignQuantityOverrides `json:"quantityOverrides,omitempty"`
}

type campaignQuantityOverrides struct {
	Posters quantityBreakdown `json:"posters,omitempty"`
	Frames  quantityBreakdown `json:"frames,omitempty"`
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
	ParentCampaignID  *string               `json:"parentCampaignId,omitempty"`
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

type quantityBreakdown map[string]int

type marketAssetOption struct {
	ID                 string            `json:"id"`
	Market             string            `json:"market"`
	Asset              string            `json:"asset"`
	Label              string            `json:"label"`
	State              string            `json:"state"`
	MaintenanceAssetID *string           `json:"maintenanceAssetId,omitempty"`
	IsMaintenance      bool              `json:"isMaintenance,omitempty"`
	Quantities         quantityBreakdown `json:"quantities"`
}

type marketMetadata struct {
	Name   string              `json:"name"`
	Assets []marketAssetOption `json:"assets"`
}

type calculatorMappingInput struct {
	Market             string            `json:"market"`
	Asset              string            `json:"asset"`
	Label              string            `json:"label"`
	State              string            `json:"state"`
	MaintenanceAssetID *string           `json:"maintenanceAssetId,omitempty"`
	Quantities         quantityBreakdown `json:"quantities"`
}

type calculatorMappingRecord struct {
	ID                 string            `json:"id"`
	TenantID           string            `json:"tenantId"`
	Market             string            `json:"market"`
	Asset              string            `json:"asset"`
	Label              string            `json:"label"`
	State              string            `json:"state"`
	MaintenanceAssetID *string           `json:"maintenanceAssetId,omitempty"`
	Quantities         quantityBreakdown `json:"quantities"`
	CreatedAt          string            `json:"createdAt"`
	UpdatedAt          string            `json:"updatedAt"`
}

type marketDeliveryAddressInput struct {
	Market          string `json:"market"`
	DeliveryAddress string `json:"deliveryAddress"`
	IsDefault       bool   `json:"isDefault"`
}

type marketDeliveryAddressDeleteInput struct {
	Market          string `json:"market"`
	DeliveryAddress string `json:"deliveryAddress"`
}

type marketDeliveryAddressRecord struct {
	TenantID        string `json:"tenantId"`
	Market          string `json:"market"`
	DeliveryAddress string `json:"deliveryAddress"`
	IsDefault       bool   `json:"isDefault"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

type marketShippingRateInput struct {
	Market                 string  `json:"market"`
	UseFlatRate            bool    `json:"useFlatRate"`
	UseFlatRateSheeters    bool    `json:"useFlatRateSheeters"`
	UseFlatRateMegas       bool    `json:"useFlatRateMegas"`
	ShippingRate           float64 `json:"shippingRate"`
	PostersPerBox          int     `json:"postersPerBox"`
	SheeterSetsPerBox      int     `json:"sheeterSetsPerBox"`
	TwoSheeterSetsPerBox   int     `json:"twoSheeterSetsPerBox"`
	FourSheeterSetsPerBox  int     `json:"fourSheeterSetsPerBox"`
	SixSheeterSetsPerBox   int     `json:"sixSheeterSetsPerBox"`
	EightSheeterSetsPerBox int     `json:"eightSheeterSetsPerBox"`
	TwoSheeterPrice        float64 `json:"twoSheeterPrice"`
	FourSheeterPrice       float64 `json:"fourSheeterPrice"`
	SixSheeterPrice        float64 `json:"sixSheeterPrice"`
	EightSheeterPrice      float64 `json:"eightSheeterPrice"`
	MegasPerBox            int     `json:"megasPerBox"`
	MegaShippingRate       float64 `json:"megaShippingRate"`
	DotMShippingRate       float64 `json:"dotMShippingRate"`
	MpShippingRate         float64 `json:"mpShippingRate"`
}

type marketShippingRateRecord struct {
	TenantID               string  `json:"tenantId"`
	Market                 string  `json:"market"`
	UseFlatRate            bool    `json:"useFlatRate"`
	UseFlatRateSheeters    bool    `json:"useFlatRateSheeters"`
	UseFlatRateMegas       bool    `json:"useFlatRateMegas"`
	ShippingRate           float64 `json:"shippingRate"`
	PostersPerBox          int     `json:"postersPerBox"`
	SheeterSetsPerBox      int     `json:"sheeterSetsPerBox"`
	TwoSheeterSetsPerBox   int     `json:"twoSheeterSetsPerBox"`
	FourSheeterSetsPerBox  int     `json:"fourSheeterSetsPerBox"`
	SixSheeterSetsPerBox   int     `json:"sixSheeterSetsPerBox"`
	EightSheeterSetsPerBox int     `json:"eightSheeterSetsPerBox"`
	TwoSheeterPrice        float64 `json:"twoSheeterPrice"`
	FourSheeterPrice       float64 `json:"fourSheeterPrice"`
	SixSheeterPrice        float64 `json:"sixSheeterPrice"`
	EightSheeterPrice      float64 `json:"eightSheeterPrice"`
	MegasPerBox            int     `json:"megasPerBox"`
	MegaShippingRate       float64 `json:"megaShippingRate"`
	DotMShippingRate       float64 `json:"dotMShippingRate"`
	MpShippingRate         float64 `json:"mpShippingRate"`
	CreatedAt              string  `json:"createdAt"`
	UpdatedAt              string  `json:"updatedAt"`
}

type printingCostBreakdown map[string]float64

type marketAssetPrintingCostInput struct {
	Market  string                `json:"market"`
	AssetID string                `json:"assetId"`
	Costs   printingCostBreakdown `json:"costs"`
}

type marketAssetPrintingCostRecord struct {
	TenantID  string                `json:"tenantId"`
	Market    string                `json:"market"`
	AssetID   string                `json:"assetId"`
	Asset     string                `json:"asset"`
	Label     string                `json:"label"`
	Costs     printingCostBreakdown `json:"costs"`
	CreatedAt string                `json:"createdAt"`
	UpdatedAt string                `json:"updatedAt"`
}

type marketSheetSizeInput struct {
	Market    string  `json:"market"`
	AssetID   *string `json:"assetId,omitempty"`
	PresetKey string  `json:"presetKey,omitempty"`
	Name      string  `json:"name"`
	WidthMm   float64 `json:"widthMm"`
	HeightMm  float64 `json:"heightMm"`
}

type marketSheetSizeRecord struct {
	ID        string  `json:"id"`
	TenantID  string  `json:"tenantId"`
	Market    string  `json:"market"`
	AssetID   *string `json:"assetId,omitempty"`
	Asset     string  `json:"asset,omitempty"`
	Label     string  `json:"label,omitempty"`
	PresetKey string  `json:"presetKey,omitempty"`
	Name      string  `json:"name"`
	WidthMm   float64 `json:"widthMm"`
	HeightMm  float64 `json:"heightMm"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
}

type marketAssetShippingCostInput struct {
	Market           string  `json:"market"`
	AssetID          string  `json:"assetId"`
	MegaShippingRate float64 `json:"megaShippingRate"`
	DotMShippingRate float64 `json:"dotMShippingRate"`
	MpShippingRate   float64 `json:"mpShippingRate"`
}

type marketAssetShippingCostRecord struct {
	TenantID         string  `json:"tenantId"`
	Market           string  `json:"market"`
	AssetID          string  `json:"assetId"`
	Asset            string  `json:"asset"`
	Label            string  `json:"label"`
	MegaShippingRate float64 `json:"megaShippingRate"`
	DotMShippingRate float64 `json:"dotMShippingRate"`
	MpShippingRate   float64 `json:"mpShippingRate"`
	CreatedAt        string  `json:"createdAt"`
	UpdatedAt        string  `json:"updatedAt"`
}

type campaignLine struct {
	ID                      string                     `json:"id"`
	AssetID                 string                     `json:"assetId"`
	AssetSearch             string                     `json:"assetSearch,omitempty"`
	SelectedWeeks           []int                      `json:"selectedWeeks"`
	Market                  string                     `json:"market,omitempty"`
	QuantityOverrides       *campaignQuantityOverrides `json:"quantityOverrides,omitempty"`
	MarketQuantityOverrides *campaignQuantityOverrides `json:"marketQuantityOverrides,omitempty"`
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
	FrameBreakdown     quantityBreakdown `json:"frameBreakdown,omitempty"`
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
	URL          string `json:"url,omitempty"`
}
