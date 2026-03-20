# Business User Guide

This guide is for business users who already understand print campaign operations and need to use the app to build a campaign and create a PrintIQ quote.

## What this app is for

FlowIQ helps you:

1. Build a campaign schedule by market, asset, and week
2. Calculate required poster quantities and frame totals using the workbook logic
3. Use those totals to prepare and submit a PrintIQ quote

## Before you start

You should know:

- which markets are included in the campaign
- which assets are running
- which weeks each asset is active
- the PrintIQ job setup details needed for the quote

## App flow

The app has three steps:

1. `Schedule`
2. `Totals`
3. `Quote`

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

### Calculate totals

When the schedule is complete, click:

`Calculate Totals`

The app will use the workbook logic to calculate required poster quantities and frame counts.

## Step 2: Totals

Use this step to review the calculated output.

### What you will see

For each market, the app shows:

- quantities by format
- poster total
- frame total
- special-format total where applicable

It also shows an `All Markets` total.

### Optional action

If you want the overall calculated quantity to be used in the PrintIQ quote, click:

`Use Total Units For Quote Quantity`

This copies the calculated total into the quote quantity field in the next step.

## Step 3: Quote

Use this step to complete the PrintIQ quote setup.

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
- current step

On smaller screens, the summary appears below the main form area.

## Logging and debugging

Every PrintIQ quote request is logged on the server side for troubleshooting.

Log file:

[printiq-payloads.log](C:/Users/BKanagaraju/Documents/FlowIQ/logs/printiq-payloads.log)

The log includes:

- request payload
- response payload
- error responses
- timestamps

## Recommended usage pattern

For clean operation:

1. Finish the full campaign schedule first
2. Run totals
3. Confirm the totals
4. Copy total units into quote quantity if appropriate
5. Complete the PrintIQ fields
6. Submit the quote

## Notes

- The app uses workbook logic for quantity calculation.
- The `Installs` sheet is not currently used.
- PrintIQ job configuration fields are still controlled in the app.
- If a quote fails, review the response shown in the app and check the server log.
