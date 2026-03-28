# Calculator Explained

This document explains how FlowIQ now calculates campaign quantities.

## What drives the calculator now

The calculator no longer reads from the Excel workbook at runtime.

Instead, it uses tenant-scoped quantity mappings stored in PostgreSQL.

Each mapping defines:

- a market
- an asset
- an optional state
- a display label
- per-run quantities for each supported format

Admin and `super_admin` users can maintain those mappings in the app and can import the starting dataset from a JSON file.

## Simple domain terms

### Market

A city or region where the campaign runs.

### Asset

A specific site, display unit, or predefined bundle of display faces.

### Mapping

A saved quantity template for one asset in one market.

It answers:

> If this asset runs once, how many units of each format are required?

### Campaign schedule

A week-by-week plan showing which assets are active.

## Calculation flow

For every selected campaign line, the app does this:

1. Find the saved mapping for the selected asset.
2. Read the per-run quantity for each format.
3. Count how many weeks were selected.
4. Multiply each format quantity by the run count.
5. Total those values by market.
6. Build an all-markets grand total.
7. Derive poster, frame, special-format, and quote totals from the breakdown.

## Supported formats

The calculator tracks:

- `8-sheet`
- `6-sheet`
- `4-sheet`
- `2-sheet`
- `QA0`
- `Mega`
- `DOT M`
- `MP`

## Formulas used in the app

### Run count

`Run count = number of selected weeks`

### Line format total

`Line format total = saved mapping quantity x run count`

### Market format total

`Market format total = sum of all line totals for that format in the market`

### Poster total

`Poster total = 8-sheet + 6-sheet + 4-sheet + 2-sheet + QA0`

### Frame total

`Frames = (8-sheet / 4) + (6-sheet / 3) + (4-sheet / 2) + 2-sheet + (QA0 / 4)`

### Special-format total

`Special formats = Mega + DOT M + MP`

### Quote quantity

`Quote quantity = poster formats + special formats`

## Very simple example

Assume the saved mapping for `Sydney / FOCUS-A` says:

- `8-sheet = 116`
- `QA0 = 24`

If the asset runs in `3` weeks:

- `8-sheet total = 116 x 3 = 348`
- `QA0 total = 24 x 3 = 72`

Poster total:

`348 + 72 = 420`

Frame total:

- `348 / 4 = 87`
- `72 / 4 = 18`
- `Total frames = 105`

## What is still configured outside the mapping table

The mapping dataset only controls schedule quantity logic.

These PrintIQ-facing fields are still entered or selected in the app:

- product category
- stock code
- process selections
- sizes
- job and section operations
- contact details
- purchase order upload

## Initial data loading

The application does not seed calculator mappings automatically.

To load the first dataset:

1. Sign in as an `admin` or `super_admin`
2. Open the Mapping Admin page
3. Import the JSON file that contains the market and asset mapping template

After import, all users in that tenant can build schedules against that data.
