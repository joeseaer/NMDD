export const categories = { tops: '上衣', bottoms: '下装', outerwear: '外套', shoes: '鞋履', accessories: '配饰', other: '其他' };
export const colors = { black: '黑色', white: '白色', gray: '灰色', blue: '蓝色', brown: '棕色', beige: '米色', green: '绿色', red: '红色', yellow: '黄色', purple: '紫色', orange: '橙色', pink: '粉色', multicolor: '多色', other: '其他' };
export const seasons = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
export const occasions = { academic_conference: '学术会议', business_social: '商务社交', daily: '日常', other: '其他' };
export const fits = { slim: '修身', regular: '常规', straight: '直筒', relaxed: '宽松', oversized: '廓形', unknown: '待核验' };
export const patterns = { solid: '纯色', striped: '条纹', checked: '格纹', printed: '印花', other: '其他', unknown: '待核验' };
export type BundleItem = {
  external_id: string; name: string; category: keyof typeof categories; primary_color: string;
  subcategory?: string | null; color_family?: keyof typeof colors | null; fit?: keyof typeof fits | null; pattern?: keyof typeof patterns | null;
  seasons?: (keyof typeof seasons)[] | null; style_tags?: string[] | null; occasions?: (keyof typeof occasions)[] | null;
  formality?: number | null; brand?: string | null; size?: string | null; material?: string | null; notes?: string | null;
  status?: 'active' | 'archived' | null; needs_review?: boolean | null; image_path: string; image_sha256?: string | null;
};
export type WardrobeItem = BundleItem & { id: string; image_url: string; deleted_at?: string | null; updated_at: string };
export type Outfit = { id: string; name: string; occasion: keyof typeof occasions; notes: string | null; items: { item_id: string; position: number; item: WardrobeItem | null }[] };
export type OutfitInput = { name: string; occasion: keyof typeof occasions; notes: string; item_ids: string[] };
export type ImportReport = { created: number; skipped: number; updated: number; failed: number; errors: { index?: number; external_id?: string; message: string }[]; warnings?: unknown[] };
export type ItemList = { items: WardrobeItem[]; total: number; page: number; page_size: number; stats: { total: number; categories: number; needs_review: number } };
