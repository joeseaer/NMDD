import { createHash } from 'node:crypto';

export const STICKER_CATALOG_VERSION = 1;
export const ITEMS_PER_CATEGORY = 36;

export const STICKER_CATEGORY_SOURCE = Object.freeze([
  {
    id: 'business',
    label: '商务',
    keywords: ['briefcase', 'building', 'chart', 'factory', 'landmark', 'presentation', 'store', 'badge', 'award', 'clipboard', 'contact', 'network', 'goal', 'target', 'trophy', 'handshake', 'scale', 'stamp', 'package', 'warehouse', 'workflow', 'receipt'],
    palette: ['#E0F2FE', '#7DD3FC', '#075985'],
  },
  {
    id: 'planning',
    label: '计划',
    keywords: ['calendar', 'clock', 'timer', 'list', 'check', 'flag', 'milestone', 'route', 'map', 'notebook', 'pencil', 'pen', 'ruler', 'focus', 'scan', 'bookmark', 'pin', 'hourglass', 'history', 'repeat', 'refresh', 'gauge', 'activity'],
    palette: ['#EDE9FE', '#C4B5FD', '#5B21B6'],
  },
  {
    id: 'education',
    label: '教育',
    keywords: ['book', 'graduation', 'school', 'university', 'library', 'microscope', 'flask', 'atom', 'calculator', 'sigma', 'languages', 'brain', 'pencil', 'pen', 'notebook', 'ruler', 'spell', 'test', 'telescope', 'dna', 'binary', 'whole-word'],
    palette: ['#DCFCE7', '#86EFAC', '#166534'],
  },
  {
    id: 'ideas',
    label: '灵感',
    keywords: ['lightbulb', 'sparkle', 'wand', 'palette', 'puzzle', 'brain', 'shapes', 'gem', 'rocket', 'zap', 'flame', 'sun', 'aperture', 'brush', 'paint', 'drafting', 'origami', 'rainbow', 'swatch', 'focus', 'scan-eye', 'diamond'],
    palette: ['#FEF3C7', '#FCD34D', '#92400E'],
  },
  {
    id: 'communication',
    label: '沟通',
    keywords: ['message', 'mail', 'phone', 'send', 'radio', 'wifi', 'bell', 'megaphone', 'mic', 'video', 'speech', 'contact', 'inbox', 'rss', 'antenna', 'podcast', 'headphone', 'speaker', 'share', 'at-sign', 'voicemail', 'satellite'],
    palette: ['#DBEAFE', '#93C5FD', '#1E40AF'],
  },
  {
    id: 'people',
    label: '人物',
    keywords: ['user', 'person', 'baby', 'accessibility', 'hand', 'heart', 'smile', 'frown', 'angry', 'annoyed', 'laugh', 'meh', 'ear', 'eye', 'footprint', 'thumb', 'users', 'contact', 'parent', 'child', 'face', 'crown'],
    palette: ['#FCE7F3', '#F9A8D4', '#9D174D'],
  },
  {
    id: 'technology',
    label: '科技',
    keywords: ['laptop', 'monitor', 'smartphone', 'cpu', 'database', 'server', 'cloud', 'code', 'git', 'bot', 'circuit', 'hard-drive', 'keyboard', 'mouse', 'router', 'bluetooth', 'usb', 'terminal', 'webhook', 'binary', 'bug', 'plug', 'satellite', 'radio-tower', 'memory-stick'],
    palette: ['#E0E7FF', '#A5B4FC', '#3730A3'],
  },
  {
    id: 'finance',
    label: '财务',
    keywords: ['dollar', 'coins', 'banknote', 'wallet', 'credit-card', 'bitcoin', 'receipt', 'piggy-bank', 'badge-cent', 'badge-dollar', 'landmark', 'chart', 'trending', 'circle-dollar', 'circle-pound', 'circle-euro', 'circle-yen', 'hand-coins', 'vault', 'calculator', 'scale', 'percent'],
    palette: ['#D1FAE5', '#6EE7B7', '#065F46'],
  },
  {
    id: 'travel',
    label: '旅行',
    keywords: ['plane', 'car', 'bus', 'train', 'ship', 'sailboat', 'luggage', 'map', 'compass', 'navigation', 'hotel', 'tent', 'mountain', 'route', 'bike', 'tram', 'truck', 'caravan', 'fuel', 'ticket', 'palmtree', 'backpack', 'signpost', 'milestone'],
    palette: ['#FFEDD5', '#FDBA74', '#9A3412'],
  },
  {
    id: 'nature',
    label: '自然',
    keywords: ['tree', 'leaf', 'flower', 'sprout', 'cloud', 'sun', 'moon', 'snowflake', 'bird', 'fish', 'turtle', 'cat', 'dog', 'rabbit', 'squirrel', 'shell', 'waves', 'mountain', 'rainbow', 'wind', 'bug', 'bee', 'snail', 'paw', 'feather', 'clover', 'shrub'],
    palette: ['#ECFCCB', '#BEF264', '#3F6212'],
  },
  {
    id: 'food',
    label: '餐饮',
    keywords: ['coffee', 'utensils', 'cake', 'cookie', 'pizza', 'soup', 'wine', 'beer', 'apple', 'cherry', 'banana', 'grape', 'candy', 'croissant', 'donut', 'egg', 'beef', 'milk', 'salad', 'sandwich', 'popcorn', 'ice-cream', 'dessert', 'chef', 'cooking', 'wheat', 'cup-soda'],
    palette: ['#FFE4E6', '#FDA4AF', '#9F1239'],
  },
  {
    id: 'home',
    label: '生活',
    keywords: ['home', 'bed', 'bath', 'armchair', 'lamp', 'door', 'key', 'lock', 'hammer', 'wrench', 'paint-bucket', 'drill', 'fan', 'air-vent', 'washing', 'refrigerator', 'microwave', 'sofa', 'shower', 'toilet', 'house', 'heater', 'flashlight', 'shopping', 'shirt', 'glasses', 'umbrella'],
    palette: ['#F3E8FF', '#D8B4FE', '#6B21A8'],
  },
  {
    id: 'celebration',
    label: '庆祝',
    keywords: ['gift', 'party', 'cake', 'balloon', 'trophy', 'medal', 'crown', 'music', 'drum', 'piano', 'guitar', 'sparkle', 'star', 'heart', 'ticket', 'confetti', 'champagne', 'candy', 'laugh', 'smile', 'thumb', 'award', 'badge', 'flower', 'firework', 'wand'],
    palette: ['#FEF9C3', '#FDE047', '#854D0E'],
  },
]);

const EXCLUDED_ICON_PATTERN = /(?:brand|chrome|facebook|figma|github|gitlab|instagram|linkedin|lucide|messenger|paypal|reddit|skype|slack|twitch|twitter|youtube)/iu;
const CONTROL_ICON_PATTERN = /^(?:align|arrow-down-|arrow-left-|arrow-right-|arrow-up-|chevron|columns?|copy-minus|copy-plus|corner-|delete|diff|fold-|fullscreen|grip|indent|layout-|list-collapse|list-end|list-filter|list-minus|list-plus|list-restart|list-start|list-tree|loader|maximize|minimize|move-|panel-|redo|rotate-|rows?|shrink|sidebar|split|stretch|text-cursor|toggle|undo|unfold|unplug|zoom)/iu;

const kebabCase = (value) => value
  .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
  .replace(/([A-Z])([A-Z][a-z])/gu, '$1-$2')
  .replace(/([A-Za-z])([0-9])/gu, '$1-$2')
  .replace(/([0-9])([A-Za-z])/gu, '$1-$2')
  .toLocaleLowerCase('en-US');

const WORD_TRANSLATIONS = Object.freeze({
  accessibility: '无障碍', activity: '活动', air: '空气', alarm: '闹钟', album: '相册', ambulance: '救护车', anchor: '锚', angry: '生气', antenna: '天线', apple: '苹果', archive: '归档', armchair: '扶手椅', atom: '原子', award: '奖项', baby: '婴儿', backpack: '背包', badge: '徽章', banknote: '纸币', bath: '浴室', battery: '电池', bed: '床', beef: '牛肉', beer: '啤酒', bell: '铃铛', bike: '自行车', bird: '鸟', bitcoin: '比特币', blocks: '积木', bluetooth: '蓝牙', boat: '船', bone: '骨头', book: '书', bookmark: '书签', bot: '机器人', box: '盒子', brain: '大脑', briefcase: '公文包', brush: '画笔', bug: '昆虫', building: '建筑', bus: '公交车', cake: '蛋糕', calculator: '计算器', calendar: '日历', camera: '相机', candy: '糖果', car: '汽车', caravan: '房车', cat: '猫', check: '完成', chef: '厨师', cherry: '樱桃', circle: '圆形', clipboard: '剪贴板', clock: '时钟', cloud: '云', clover: '四叶草', code: '代码', coffee: '咖啡', coins: '硬币', compass: '指南针', computer: '电脑', contact: '联系人', cookie: '饼干', cooking: '烹饪', cpu: '处理器', credit: '信用', crown: '皇冠', database: '数据库', diamond: '钻石', dog: '狗', dollar: '美元', donut: '甜甜圈', door: '门', drill: '电钻', drum: '鼓', ear: '耳朵', earth: '地球', egg: '鸡蛋', factory: '工厂', fan: '风扇', feather: '羽毛', file: '文件', fish: '鱼', flag: '旗帜', flame: '火焰', flashlight: '手电筒', flask: '烧瓶', flower: '花朵', focus: '聚焦', folder: '文件夹', footprints: '脚印', fuel: '燃料', gamepad: '游戏手柄', gauge: '仪表', gem: '宝石', ghost: '幽灵', gift: '礼物', glasses: '眼镜', globe: '全球', graduation: '毕业', grape: '葡萄', hammer: '锤子', hand: '手', handshake: '握手', headphones: '耳机', heart: '爱心', help: '帮助', history: '历史', home: '家', hospital: '医院', hotel: '酒店', hourglass: '沙漏', image: '图片', inbox: '收件箱', info: '信息', key: '钥匙', keyboard: '键盘', lamp: '灯', landmark: '地标', languages: '语言', laptop: '笔记本电脑', leaf: '叶子', library: '图书馆', life: '生命', lightbulb: '灯泡', link: '链接', luggage: '行李', mail: '邮件', map: '地图', medal: '奖牌', megaphone: '扩音器', message: '消息', mic: '麦克风', microscope: '显微镜', milk: '牛奶', monitor: '显示器', moon: '月亮', mountain: '山峰', mouse: '鼠标', music: '音乐', navigation: '导航', network: '网络', newspaper: '报纸', notebook: '笔记本', package: '包裹', paint: '绘画', palette: '调色盘', party: '派对', pen: '钢笔', pencil: '铅笔', person: '人物', phone: '电话', piano: '钢琴', pizza: '披萨', plane: '飞机', plug: '插头', popcorn: '爆米花', presentation: '演示', printer: '打印机', puzzle: '拼图', radio: '收音机', receipt: '收据', rocket: '火箭', route: '路线', ruler: '尺子', sailboat: '帆船', school: '学校', search: '搜索', send: '发送', server: '服务器', settings: '设置', shapes: '形状', shell: '贝壳', shield: '盾牌', ship: '轮船', shopping: '购物', signal: '信号', smartphone: '手机', smile: '微笑', snowflake: '雪花', soup: '汤', sparkle: '闪光', speaker: '扬声器', sprout: '嫩芽', stamp: '印章', star: '星星', store: '商店', sun: '太阳', target: '目标', tent: '帐篷', thumbs: '点赞', ticket: '票券', timer: '计时器', train: '火车', tree: '树', trophy: '奖杯', truck: '卡车', turtle: '海龟', umbrella: '雨伞', university: '大学', user: '用户', users: '团队', utensils: '餐具', video: '视频', wallet: '钱包', wand: '魔法棒', watch: '手表', waves: '波浪', wifi: '无线网络', wine: '葡萄酒', wrench: '扳手', zap: '闪电',
});

const displayLabel = (iconName) => {
  const words = kebabCase(iconName).split('-');
  return words.map((word) => WORD_TRANSLATIONS[word] ?? word).join('·');
};

const deterministicScore = (seed, value) => createHash('sha256')
  .update(`${seed}\0${value}`)
  .digest()
  .readUInt32BE(0);

const keywordMatches = (kebabName, keyword) => (
  kebabName === keyword
  || kebabName.startsWith(`${keyword}-`)
  || kebabName.endsWith(`-${keyword}`)
  || kebabName.includes(`-${keyword}-`)
);

const scoreForCategory = (category, kebabName) => {
  const keywordScore = category.keywords.reduce(
    (score, keyword) => score + (keywordMatches(kebabName, keyword) ? 1 : 0),
    0,
  );
  return keywordScore * 0x1_0000_0000 + deterministicScore(category.id, kebabName);
};

const safeIconNames = (iconNames) => [...new Set(iconNames)]
  .filter((name) => typeof name === 'string' && /^[A-Z][A-Za-z0-9]+$/u.test(name))
  .filter((name) => {
    const kebabName = kebabCase(name);
    return !EXCLUDED_ICON_PATTERN.test(kebabName) && !CONTROL_ICON_PATTERN.test(kebabName);
  })
  .sort((left, right) => left.localeCompare(right, 'en-US'));

const specialLightbulb = Object.freeze({
  id: 'idea-lightbulb',
  label: '灵感灯泡',
  kind: 'sticker',
  categoryId: 'ideas',
  tags: ['灯泡', '灵感', '创意', 'idea', 'lightbulb'],
  fileName: 'nmdd-idea-lightbulb.png',
  mimeType: 'image/png',
  publicUrl: '/mindmap/stickers/lightbulb-84.png',
  defaultDisplaySize: { width: 84, height: 84 },
  intrinsicSize: { width: 84, height: 84 },
  provenance: 'licensed-lucide-isc-derived',
  sourceIconName: 'Lightbulb',
});

export const buildStickerCatalogSource = (iconNames) => {
  const available = safeIconNames(iconNames).filter((name) => name !== 'Lightbulb');
  const used = new Set();
  const descriptors = [];

  for (const category of STICKER_CATEGORY_SOURCE) {
    const containsSpecial = category.id === specialLightbulb.categoryId;
    const slots = ITEMS_PER_CATEGORY - (containsSpecial ? 1 : 0);
    const candidates = available
      .filter((name) => !used.has(name))
      .map((name) => ({ name, kebabName: kebabCase(name) }))
      .filter(({ kebabName }) => category.keywords.some((keyword) => keywordMatches(kebabName, keyword)))
      .sort((left, right) => scoreForCategory(category, right.kebabName) - scoreForCategory(category, left.kebabName));
    const selected = candidates.slice(0, slots);
    if (selected.length < slots) {
      const fallback = available
        .filter((name) => !used.has(name) && !selected.some((entry) => entry.name === name))
        .map((name) => ({ name, kebabName: kebabCase(name) }))
        .sort((left, right) => deterministicScore(category.id, left.kebabName) - deterministicScore(category.id, right.kebabName));
      selected.push(...fallback.slice(0, slots - selected.length));
    }
    if (selected.length !== slots) {
      throw new Error(`Not enough licensed icons to fill sticker category ${category.id}.`);
    }

    let position = 0;
    if (containsSpecial) {
      descriptors.push({ ...specialLightbulb, categoryPosition: position });
      position += 1;
    }
    for (const { name, kebabName } of selected) {
      used.add(name);
      const kind = position % 12 === 11 ? 'illustration' : 'sticker';
      const intrinsicSize = kind === 'illustration'
        ? { width: 256, height: 192 }
        : { width: 168, height: 168 };
      const defaultDisplaySize = kind === 'illustration'
        ? { width: 160, height: 120 }
        : { width: 84, height: 84 };
      const id = `${category.id}-${kebabName}`;
      descriptors.push({
        id,
        label: displayLabel(name),
        kind,
        categoryId: category.id,
        categoryPosition: position,
        tags: [category.label, category.id, kebabName, ...category.keywords.filter((keyword) => keywordMatches(kebabName, keyword))],
        fileName: `nmdd-${id}.png`,
        mimeType: 'image/png',
        publicUrl: `/mindmap/stickers/lucide/${id}.png`,
        defaultDisplaySize,
        intrinsicSize,
        provenance: 'licensed-lucide-isc-derived',
        sourceIconName: name,
      });
      position += 1;
    }
  }

  const expected = STICKER_CATEGORY_SOURCE.length * ITEMS_PER_CATEGORY;
  if (descriptors.length !== expected) {
    throw new Error(`Expected ${expected} sticker catalog entries, received ${descriptors.length}.`);
  }
  const ids = new Set(descriptors.map(({ id }) => id));
  if (ids.size !== descriptors.length) throw new Error('Generated sticker IDs must be unique.');
  return Object.freeze(descriptors.map(Object.freeze));
};

export const stickerCatalogFingerprint = (descriptors) => createHash('sha256')
  .update(JSON.stringify({ version: STICKER_CATALOG_VERSION, descriptors }))
  .digest('hex');

export const stickerCatalogKebabCase = kebabCase;
