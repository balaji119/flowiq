package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type campaignObjectStorage struct {
	client   *s3.Client
	presign  *s3.PresignClient
	bucket   string
	endpoint string
}

func (a *app) initCampaignObjectStorage(ctx context.Context) error {
	accessKey := strings.TrimSpace(os.Getenv("DO_SPACES_KEY"))
	secretKey := strings.TrimSpace(os.Getenv("DO_SPACES_SECRET"))
	region := strings.TrimSpace(os.Getenv("DO_SPACES_REGION"))
	bucket := strings.TrimSpace(os.Getenv("DO_SPACES_BUCKET"))
	rawEndpoint := strings.TrimSpace(os.Getenv("DO_SPACES_ENDPOINT"))

	if accessKey == "" && secretKey == "" && region == "" && bucket == "" && rawEndpoint == "" {
		return nil
	}
	if accessKey == "" || secretKey == "" || region == "" || bucket == "" {
		return fmt.Errorf("DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_REGION, and DO_SPACES_BUCKET must all be set")
	}

	endpoint, err := normalizeSpacesEndpoint(rawEndpoint, region)
	if err != nil {
		return err
	}

	awsCfg, err := config.LoadDefaultConfig(
		ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		return fmt.Errorf("load AWS-compatible config for DigitalOcean Spaces: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
	})

	if _, err := client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(bucket)}); err != nil {
		return fmt.Errorf("access DigitalOcean Space %q: %w", bucket, err)
	}

	a.objectStorage = &campaignObjectStorage{
		client:   client,
		presign:  s3.NewPresignClient(client),
		bucket:   bucket,
		endpoint: endpoint,
	}
	log.Printf("campaign artwork storage using DigitalOcean Spaces (bucket=%s, endpoint=%s)", bucket, endpoint)
	return nil
}

func (a *app) storeCampaignImage(ctx context.Context, storedName, contentType string, content []byte) error {
	if a.objectStorage != nil {
		ctype := contentType
		_, err := a.objectStorage.client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:      aws.String(a.objectStorage.bucket),
			Key:         aws.String(storedName),
			Body:        bytes.NewReader(content),
			ContentType: aws.String(ctype),
		})
		if err != nil {
			return fmt.Errorf("upload image to DigitalOcean Spaces: %w", err)
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
	if a.objectStorage == nil {
		return "", false, nil
	}

	if _, err := a.objectStorage.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(a.objectStorage.bucket),
		Key:    aws.String(storedName),
	}); err != nil {
		if isMissingObjectStorageObject(err) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("get DigitalOcean Spaces object metadata: %w", err)
	}

	input := &s3.GetObjectInput{
		Bucket: aws.String(a.objectStorage.bucket),
		Key:    aws.String(storedName),
	}
	if disposition := strings.TrimSpace(contentDisposition); disposition != "" {
		input.ResponseContentDisposition = aws.String(disposition)
	}

	presigned, err := a.objectStorage.presign.PresignGetObject(ctx, input, func(po *s3.PresignOptions) {
		po.Expires = 45 * time.Minute
	})
	if err != nil {
		return "", false, fmt.Errorf("sign DigitalOcean Spaces URL: %w", err)
	}

	return presigned.URL, true, nil
}

func (a *app) deleteCampaignImage(ctx context.Context, storedName string) error {
	if a.objectStorage != nil {
		if _, err := a.objectStorage.client.HeadObject(ctx, &s3.HeadObjectInput{
			Bucket: aws.String(a.objectStorage.bucket),
			Key:    aws.String(storedName),
		}); err != nil {
			if isMissingObjectStorageObject(err) {
				return os.ErrNotExist
			}
			return fmt.Errorf("check DigitalOcean Spaces object before delete: %w", err)
		}

		if _, err := a.objectStorage.client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(a.objectStorage.bucket),
			Key:    aws.String(storedName),
		}); err != nil {
			return fmt.Errorf("delete image from DigitalOcean Spaces: %w", err)
		}
		return nil
	}

	targetPath := filepath.Join(a.campaignImageDir, storedName)
	if err := os.Remove(targetPath); err != nil {
		return err
	}
	return nil
}

func normalizeSpacesEndpoint(rawEndpoint, region string) (string, error) {
	endpoint := strings.TrimSpace(rawEndpoint)
	if endpoint == "" {
		endpoint = fmt.Sprintf("%s.digitaloceanspaces.com", strings.TrimSpace(region))
	}
	if endpoint == "" {
		return "", errors.New("DigitalOcean Spaces endpoint is required")
	}
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		endpoint = "https://" + endpoint
	}
	return strings.TrimRight(endpoint, "/"), nil
}

func isMissingObjectStorageObject(err error) bool {
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return false
	}

	switch strings.ToLower(strings.TrimSpace(apiErr.ErrorCode())) {
	case "nosuchkey", "nosuchbucket", "notfound":
		return true
	}
	status, parseErr := strconv.Atoi(strings.TrimSpace(apiErr.ErrorCode()))
	return parseErr == nil && status == 404
}
