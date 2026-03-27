# Calculator Explained

This document explains, in simple language, what the Excel workbook is calculating and how that logic was converted into the app.

## What the workbook is doing

The Excel workbook is mainly a schedule-to-quantity calculator.

Its main question is:

> Given which advertising locations are running, in which markets, and for how many weeks, how many printed posters and frames are required?

It is not mainly a pricing workbook. It is mainly calculating required print quantities.

## Simple domain terms

### Market

A city or region where the campaign runs.

Examples in the workbook:

- Sydney
- Melbourne
- Brisbane

### Asset

A specific advertising site, display unit, or predefined display group.

Examples in the workbook:

- `FOCUS-A`
- `FOCUS-K`
- `MEGASITE - Oxford St`
- `DOM - Ann St`

Think of an asset as:

> One named billboard/display location or one predefined bundle of display faces.

### Campaign

A planned advertising run across one or more assets over one or more weeks.

### Schedule

A week-by-week plan showing which assets are active.

### Poster

The printed sheet that gets installed on a display.

### Frame

The physical display frame or display slot that holds posters.

Some display formats need multiple posters to fill one frame.

### Formats

The workbook tracks these formats:

- `8-sheet`
- `6-sheet`
- `4-sheet`
- `2-sheet`
- `QA0`
- `Mega`
- `DOT M`
- `MP`

## Workbook logic in plain language

The workbook has a lookup table that says:

> If this asset runs once, it needs this many posters of each format.

Then the schedule says:

> This asset is active in week 1, week 2, week 3, and so on.

So the workbook does this:

1. Find the selected asset in the lookup table.
2. Get the quantity for each format for one run of that asset.
3. Count how many weeks that asset is active.
4. Multiply the one-run quantities by the number of active weeks.
5. Sum those totals by market.
6. Convert poster totals into frame totals using fixed divisors.

## Plain-English formula list for values shown in the app

## Schedule step

These are user inputs, not workbook calculations.

### Campaign start date

User enters the starting date of the campaign.

Formula:

`No calculation. User input only.`

### Number of weeks

User enters how many weeks are available for scheduling.

Formula:

`No calculation. User input only.`

### Line

One schedule row in the app.

Formula:

`No calculation. User input only.`

### Market

The selected city/region for the line.

Formula:

`No calculation. User input only.`

### Asset

The selected display site or display group.

Formula:

`No calculation. User input only.`

### Active weeks

The weeks where this asset is active.

Formula:

`No calculation. User input only.`

## Review step

These values are calculated using the workbook logic.

### Run count

How many weeks were selected for that line.

Formula:

`Run count = number of selected weeks`

### Format quantity for one line

For each format, the app calculates the total quantity for that line.

Formula:

`Line format total = lookup quantity for asset x run count`

Example:

If an asset requires `116` x `8-sheet` posters for one run and you selected `3` weeks:

`8-sheet total = 116 x 3 = 348`

### Market totals by format

For each market, the app totals each format across all selected lines in that market.

Formulas:

- `Market 8-sheet total = sum of 8-sheet totals for all selected lines in that market`
- `Market 6-sheet total = sum of 6-sheet totals for all selected lines in that market`
- `Market 4-sheet total = sum of 4-sheet totals for all selected lines in that market`
- `Market 2-sheet total = sum of 2-sheet totals for all selected lines in that market`
- `Market QA0 total = sum of QA0 totals for all selected lines in that market`
- `Market Mega total = sum of Mega totals for all selected lines in that market`
- `Market DOT M total = sum of DOT M totals for all selected lines in that market`
- `Market MP total = sum of MP totals for all selected lines in that market`

### Posters

Total standard poster units for a market.

Formula:

`Poster total = 8-sheet + 6-sheet + 4-sheet + 2-sheet + QA0`

### Frames

Derived from poster counts using the same logic as the workbook.

Formula:

`Frames = (8-sheet / 4) + (6-sheet / 3) + (4-sheet / 2) + (2-sheet / 1) + (QA0 / 4)`

Why:

- one frame of `8-sheet` uses 4 posters
- one frame of `6-sheet` uses 3 posters
- one frame of `4-sheet` uses 2 posters
- one frame of `2-sheet` uses 1 poster
- one frame of `QA0` uses 4 posters

### Special-format units

Total special-format units in a market.

Formula:

`Special formats = Mega + DOT M + MP`

### All Markets totals

Grand totals across every market.

Formula:

`Grand total for each format = sum of that format across all markets`

## Finalise step

Some values here are user-entered. The app also carries the calculated total units into the quote quantity field when totals are reviewed.

### Quote quantity

This is the quantity sent to PrintIQ.

When totals are reviewed, the app uses:

Formula:

`Quote quantity = 8-sheet + 6-sheet + 4-sheet + 2-sheet + QA0 + Mega + DOT M + MP`

### Customer code

Formula:

`No calculation. User input only.`

### Customer reference

Formula:

`No calculation. User input only.`

### Job title

Formula:

`No calculation. User input only.`

### Kind name / SKU

Formula:

`No calculation. User input only.`

### Finish width / height

Formula:

`No calculation. User input only.`

### Stock code

Formula:

`No calculation. User input only.`

### Front process / Reverse process

Formula:

`No calculation. User input only.`

### Target freight price

Formula:

`No calculation. User input only.`

### Job description

Can be generated from the calculated totals.

Formula:

Build description text using:

- campaign start
- number of weeks
- substrate/stock
- print mode
- total posters
- total frames
- total special formats

### Job operations

Formula:

`No calculation. User selection only.`

### Section operations

Formula:

`No calculation. User selection only.`

### Contact details

Formula:

`No calculation. User input only.`

### Purchase order upload

The final step also uploads the purchase order file before the quote is submitted.

Formula:

`No calculation. File upload only.`

## How the workbook was converted into the app

The Excel workbook hides the logic inside cells and formulas.

The app converts that logic into structured data and code.

### In Excel

The workbook uses:

- `Schedule` sheet for weekly planning
- `V-LOOKUP` sheet for asset quantity lookup
- `Print Quantities` sheet for totals and frame conversions

### In the app

The app converts this into:

1. Market and asset selection in the UI
2. Week selection in the UI
3. Backend lookup of asset quantities from the workbook
4. Multiplication by number of active weeks
5. Totalling by market and across all markets
6. Frame calculations using the same workbook rules
7. Populate the quote quantity from the calculated total units
8. Upload the purchase order and submit the PrintIQ quote

## Very simple example

Assume:

- Market = Sydney
- Asset = `FOCUS-A`
- Selected weeks = Week 1, Week 2, Week 3
- Workbook gives:
  - `8-sheet = 116`
  - `QA0 = 24`

Then:

- `Run count = 3`
- `8-sheet total = 116 x 3 = 348`
- `QA0 total = 24 x 3 = 72`

Poster total:

`348 + 72 = 420`

Frame total:

- `8-sheet frames = 348 / 4 = 87`
- `QA0 frames = 72 / 4 = 18`
- `Total frames = 105`

## What the workbook does not currently calculate

The workbook does not appear to define full quote pricing logic such as:

- material cost
- print cost
- finishing cost
- freight pricing
- margin pricing

So the app currently automates the quantity side fully, while the PrintIQ job setup still includes manual user inputs plus the final purchase-order upload step.
