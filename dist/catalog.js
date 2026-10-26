// Типы предметов: расчётные габариты (м), правила привязки и допустимые помещения.
// w — ширина по локальной X, d — глубина по локальной Z (перед модели смотрит в +Z), h — высота для проверок.

export const ROOM_KINDS_FOR_FURNITURE = ['room', 'terrace'];

export const ITEM_TYPES = {
  bed: {
    label: 'Кровать 140 × 200', short: 'Кровать', w: 1.46, d: 2.08, h: 0.9, catalog: true, snap: 'align',
    rooms: ['room'], icon: 'bed',
  },
  wardrobe: {
    label: 'Компактный шкаф', short: 'Шкаф', w: 0.8, d: 0.6, h: 2.0, catalog: true, snap: 'back', access: 0.6,
    tall: true, rooms: ['room'], icon: 'wardrobe',
  },
  sofa: {
    label: 'Диван', short: 'Диван', w: 1.9, d: 0.85, h: 0.92, catalog: true, snap: 'align',
    rooms: ['room', 'terrace'], icon: 'sofa',
  },
  dining: {
    label: 'Обеденный стол', short: 'Стол', w: 1.2, d: 0.75, h: 0.78, catalog: true, snap: 'free',
    rooms: ['room', 'terrace'], icon: 'table',
  },
  chair: {
    label: 'Стул', short: 'Стул', w: 0.48, d: 0.5, h: 0.86, catalog: true, snap: 'free',
    rooms: ['room', 'terrace'], icon: 'chair',
  },
  tv: {
    label: 'Настенный телевизор 55″', short: 'Телевизор', w: 1.22, d: 0.055, h: 0.71, catalog: true, mount: 'wall',
    rooms: ['room'], icon: 'tv', defaultY: 1.05,
  },
  // Предметы исходной расстановки (в компактный каталог не входят).
  bedSingle: { label: 'Кровать 90 × 190', short: 'Кровать', w: 0.96, d: 1.98, h: 0.9, snap: 'align', rooms: ['room'] },
  desk: { label: 'Письменный стол', short: 'Стол', w: 1.2, d: 0.6, h: 0.75, snap: 'align', rooms: ['room'] },
  coffee: { label: 'Журнальный стол', short: 'Журнальный стол', w: 0.8, d: 0.5, h: 0.43, snap: 'free', rooms: ['room', 'terrace'] },
  mediaUnit: { label: 'Тумба', short: 'Тумба', w: 1.8, d: 0.42, h: 0.55, snap: 'align', rooms: ['room'] },
  kitchenSink: { label: 'Кухня · мойка', short: 'Мойка', w: 0.925, d: 0.68, h: 2.08, snap: 'back', dock: 'kitchen', tall: true, rooms: ['kitchen'] },
  kitchenHob: { label: 'Кухня · плита', short: 'Плита', w: 0.825, d: 0.68, h: 2.08, snap: 'back', dock: 'kitchen', tall: true, rooms: ['kitchen'] },
  kitchenCabinet: { label: 'Кухня · шкаф', short: 'Кухонный шкаф', w: 0.825, d: 0.68, h: 2.08, snap: 'back', dock: 'kitchen', tall: true, rooms: ['kitchen'] },
  fridge: { label: 'Холодильник', short: 'Холодильник', w: 0.52, d: 0.64, h: 1.97, snap: 'back', dock: 'kitchen', tall: true, rooms: ['kitchen'] },
  toilet: { label: 'Унитаз', short: 'Унитаз', w: 0.4, d: 0.65, h: 1.2, snap: 'back', rooms: ['wet'] },
  vanity: { label: 'Раковина', short: 'Раковина', w: 0.72, d: 0.48, h: 1.73, snap: 'back', tall: true, rooms: ['wet'] },
  shower: { label: 'Душевая', short: 'Душевая', w: 0.91, d: 0.93, h: 1.98, snap: 'back', tall: true, rooms: ['wet'] },
  washer: { label: 'Стиральная машина', short: 'Стиральная машина', w: 0.6, d: 0.64, h: 0.85, snap: 'back', rooms: ['wet'] },
};

// Порядок карточек компактного каталога — ровно шесть типов.
export const CATALOG_ORDER = ['bed', 'wardrobe', 'sofa', 'dining', 'chair', 'tv'];

// Высота, начиная с которой предмет считается высоким и закрывает окно с низким подоконником.
export const TALL_HEIGHT = 1.2;

export const KITCHEN_DOCK_GAP = 0.003;

export function typeInfo(type) {
  return ITEM_TYPES[type] || null;
}

export function isWallItem(type) {
  return ITEM_TYPES[type]?.mount === 'wall';
}

export function isTall(type) {
  const t = ITEM_TYPES[type];
  return !!t && (t.tall || t.h >= TALL_HEIGHT);
}

// Может ли тип стоять в помещении данного вида. Кухонные модули — только в кухне-гостиной.
export function roomAllowsType(room, type) {
  const t = ITEM_TYPES[type];
  if (!t || !room) return false;
  if (room.kind === 'entry' || room.kind === 'sauna') return false;
  return t.rooms.some((r) => {
    if (r === 'kitchen') return room.kitchen === true;
    if (r === 'room') return room.kind === 'room';
    return r === room.kind;
  });
}
