# Wardrobe V1 fixtures

- `mock-ten.zip`: 10 deterministic, distinct PNG raster illustrations, 6 categories, Chinese names, review flags and SHA-256 values. These colored garment silhouettes are **mock data**, not private photographs or actual clothing records. Every image is 96×112 pixels. The source label and each item's notes identify them as mocks.
- `provided-demo.zip`: unchanged copy of the user-provided `yichu/nmdd-wardrobe-v1-demo.zip` (1 mock item). Its source text already contains Unicode replacement characters; tests preserve those bytes and do not invent corrected clothing descriptions.

Both follow `manifest.json` + `items.json` + `images/` and are exercised by actual bundle parsing. Only mocks belong in this directory. Do not add private wardrobe photos.
