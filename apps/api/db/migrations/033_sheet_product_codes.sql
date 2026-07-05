ALTER TABLE sheet_name_overrides
ADD COLUMN product_codes JSONB NOT NULL DEFAULT '{"2-sheet":"2SheetTest"}'::jsonb;

UPDATE campaigns
SET form_data = (form_data - 'productCategory')
  || jsonb_build_object('productCode', form_data->'productCategory')
WHERE form_data ? 'productCategory'
  AND NOT form_data ? 'productCode';
