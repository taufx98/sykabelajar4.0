-- Add image_urls array to ad_banner_requests for multi-slot uploads
-- Run in Supabase SQL Editor

-- Add image_urls column (array of text URLs)
ALTER TABLE ad_banner_requests
  ADD COLUMN IF NOT EXISTS image_urls text[] DEFAULT ARRAY[]::text[];

-- Migrate existing single image_url into image_urls array
UPDATE ad_banner_requests
  SET image_urls = ARRAY[image_url]
  WHERE image_urls IS NULL OR array_length(image_urls, 1) IS NULL;

-- Add image_urls column to ad_banners as well
ALTER TABLE ad_banners
  ADD COLUMN IF NOT EXISTS image_urls text[] DEFAULT ARRAY[]::text[];

UPDATE ad_banners
  SET image_urls = ARRAY[image_url]
  WHERE image_urls IS NULL OR array_length(image_urls, 1) IS NULL;
