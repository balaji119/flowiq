package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/blob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/bloberror"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/sas"
)

type azureBlobStorage struct {
	client     *azblob.Client
	credential *azblob.SharedKeyCredential
	account    string
	container  string
}

func (a *app) initCampaignBlobStorage(ctx context.Context) error {
	account := strings.TrimSpace(os.Getenv("AZURE_STORAGE_ACCOUNT"))
	key := strings.TrimSpace(os.Getenv("AZURE_STORAGE_KEY"))
	container := strings.TrimSpace(os.Getenv("AZURE_STORAGE_CONTAINER"))

	if account == "" && key == "" && container == "" {
		return nil
	}
	if account == "" || key == "" || container == "" {
		return fmt.Errorf("AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY, and AZURE_STORAGE_CONTAINER must all be set")
	}

	credential, err := azblob.NewSharedKeyCredential(account, key)
	if err != nil {
		return fmt.Errorf("create Azure shared key credential: %w", err)
	}
	serviceURL := fmt.Sprintf("https://%s.blob.core.windows.net/", account)
	client, err := azblob.NewClientWithSharedKeyCredential(serviceURL, credential, nil)
	if err != nil {
		return fmt.Errorf("create Azure blob client: %w", err)
	}

	if _, err := client.CreateContainer(ctx, container, nil); err != nil && !bloberror.HasCode(err, bloberror.ContainerAlreadyExists) {
		return fmt.Errorf("create Azure container %q: %w", container, err)
	}

	a.blobStorage = &azureBlobStorage{
		client:     client,
		credential: credential,
		account:    account,
		container:  container,
	}
	log.Printf("campaign artwork storage using Azure Blob (account=%s, container=%s)", account, container)
	return nil
}

func (a *app) storeCampaignImage(ctx context.Context, storedName, contentType string, content []byte) error {
	if a.blobStorage != nil {
		ctype := contentType
		_, err := a.blobStorage.client.UploadBuffer(
			ctx,
			a.blobStorage.container,
			storedName,
			content,
			&azblob.UploadBufferOptions{
				HTTPHeaders: &blob.HTTPHeaders{
					BlobContentType: &ctype,
				},
			},
		)
		if err != nil {
			return fmt.Errorf("upload image to Azure blob: %w", err)
		}
		return nil
	}

	targetPath := filepath.Join(a.campaignImageDir, storedName)
	if err := os.WriteFile(targetPath, content, 0o644); err != nil {
		return fmt.Errorf("write image to local storage: %w", err)
	}
	return nil
}

func (a *app) campaignImageReadURL(ctx context.Context, storedName, contentDisposition string) (string, bool, error) {
	if a.blobStorage == nil {
		return "", false, nil
	}

	containerClient := a.blobStorage.client.ServiceClient().NewContainerClient(a.blobStorage.container)
	blobClient := containerClient.NewBlobClient(storedName)
	if _, err := blobClient.GetProperties(ctx, nil); err != nil {
		if bloberror.HasCode(err, bloberror.BlobNotFound, bloberror.ResourceNotFound, bloberror.ContainerNotFound) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("get Azure blob properties: %w", err)
	}

	perms := sas.BlobPermissions{Read: true}
	start := time.Now().UTC().Add(-5 * time.Minute)
	expiry := time.Now().UTC().Add(45 * time.Minute)
	values := sas.BlobSignatureValues{
		Protocol:           sas.ProtocolHTTPS,
		StartTime:          start,
		ExpiryTime:         expiry,
		ContainerName:      a.blobStorage.container,
		BlobName:           storedName,
		Permissions:        perms.String(),
		ContentDisposition: strings.TrimSpace(contentDisposition),
	}
	queryParams, err := values.SignWithSharedKey(a.blobStorage.credential)
	if err != nil {
		return "", false, fmt.Errorf("sign Azure SAS URL: %w", err)
	}

	return blobClient.URL() + "?" + queryParams.Encode(), true, nil
}
