# Business User Guide

This guide is for business users who already understand print campaign operations and need to use the app to build a campaign and create a PrintIQ quote.

## What this app is for

FlowIQ helps you:

1. Build a campaign schedule by market, asset, and week
2. Review required poster quantities and frame totals using the workbook logic
3. Upload the purchase order and submit a PrintIQ quote

## Before you start

You should know:

- which markets are included in the campaign
- which assets are running
- which weeks each asset is active
- the PrintIQ job setup details needed for the quote

## App flow

The app has three steps:

1. `Schedule`
2. `Review`
3. `Finalise`

## Step 1: Schedule

Use this step to define the campaign run plan.

### Enter campaign timing

- Set the campaign start date
- Enter the number of weeks in the campaign

### Add campaign lines

Each line represents one asset in one market.

For each line:

1. Select the market
2. Search for and select the asset
3. Select the active weeks for that asset

Repeat for every asset in the campaign.

### Continue to review

When the schedule is complete, click:

`Calculate Campaign Totals`

The app will use the workbook logic to calculate required poster quantities and frame counts.

## Step 2: Review

Use this step to review the calculated output.

### What you will see

For each market, the app shows:

- quantities by format
- poster total
- frame total
- special-format total where applicable

It also shows an `All Markets` total and a live campaign summary.

## Step 3: Finalise

Use this step to upload the purchase order and create the quote.

### Enter or confirm quote details

Complete or review:

- customer code
- customer reference
- job title
- kind name / SKU
- quote quantity
- finish size
- stock code
- front process
- reverse process
- freight target if needed
- job description
- notes
- job operations
- section operations
- contact details
- purchase order file

### Upload the purchase order

Click:

`Upload Purchase Order`

The file is sent to the FlowIQ API and stored in the backend upload area before the quote is submitted.

### Generate description if needed

Click:

`Generate Description`

This creates a description using the campaign timing and calculated totals.

### Create the quote

Click:

`Create Quote In PrintIQ`

The app will:

1. build the PrintIQ payload
2. get a PrintIQ login token through the backend
3. send the quote request to PrintIQ
4. display the response in the app

## Live summary panel

The side summary helps you monitor:

- number of configured lines
- total posters
- total frames
- total special formats
- current quote quantity
- current step progress

On smaller screens, the summary appears below the main form area.

## Logging and debugging

Every PrintIQ quote request is logged on the server side for troubleshooting.

Log file location:

[printiq-payloads.log](/C:/Users/BKanagaraju/.codex/worktrees/1cf3/FlowIQ/apps/api/storage/logs/printiq-payloads.log)

The log includes:

- request payload
- response payload
- error responses
- timestamps

## Recommended usage pattern

For clean operation:

1. Finish the full campaign schedule first
2. Review the totals
3. Confirm the totals
4. Complete the PrintIQ fields
5. Upload the purchase order
6. Submit the quote

## Notes

- The app uses workbook logic for quantity calculation.
- The `Installs` sheet is not currently used.
- PrintIQ job configuration fields are still controlled in the app.
- If a quote fails, review the response shown in the app and check the server log.
