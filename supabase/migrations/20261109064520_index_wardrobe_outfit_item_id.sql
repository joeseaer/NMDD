-- Cover the item foreign key when finding outfits containing an item.
BEGIN;
CREATE INDEX IF NOT EXISTS wardrobe_outfit_items_item_id
  ON public.wardrobe_outfit_items(item_id);
COMMIT;
