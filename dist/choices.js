// Палитры конфигуратора и допустимые значения для каждого слота отделки.

export const INTERIOR_PAINTS = [
  { id: 'tk-F497', code: 'F497', label: 'Paper', hex: '#F1F1EC' },
  { id: 'tk-H484', code: 'H484', label: 'Mulberry', hex: '#DDD4C9' },
  { id: 'tk-V484', code: 'V484', label: 'Driftwood', hex: '#C3B6A7' },
  { id: 'tk-G500', code: 'G500', label: 'Bungalow', hex: '#DCDFE0' },
  { id: 'tk-L447', code: 'L447', label: 'Sepal', hex: '#82856C' },
  { id: 'tk-N464', code: 'N464', label: 'Alexandrite', hex: '#624E46' },
  { id: 'tk-X499', code: 'X499', label: 'Licorice', hex: '#484A4A' },
];

export const FACADE_PAINTS = [
  { id: 'ext-Q854', code: 'Q854', label: 'Белый', hex: '#EBEBE8' },
  { id: 'ext-Q803', code: 'Q803', label: 'Серый', hex: '#938E85' },
  { id: 'ext-D129', code: 'D129', label: 'Графит', hex: '#3C3C3D' },
  { id: 'ext-Q707', code: 'Q707', label: 'Шоколад', hex: '#514943' },
  { id: 'ext-D110', code: 'D110', label: 'Винный', hex: '#65413F' },
  { id: 'ext-D105', code: 'D105', label: 'Охра', hex: '#BC8647' },
  { id: 'ext-Q451', code: 'Q451', label: 'Серо-голубой', hex: '#7F93A1' },
];

export const DOOR_FINISHES = [
  { id: 'door-light', label: 'Светлый', hex: '#dedbd2' },
  { id: 'door-grey', label: 'Серый', hex: '#858a87' },
  { id: 'door-dark', label: 'Тёмный', hex: '#343b3c' },
];

export const WOODS = [
  { id: 'oak', label: 'Медовый дуб', hex: '#c5a174', family: 'wood' },
  { id: 'whiteoak', label: 'Светлый дуб', hex: '#ddd0ad', family: 'wood' },
  { id: 'walnut', label: 'Орех', hex: '#775038', family: 'wood' },
  { id: 'smoked', label: 'Копчёный дуб', hex: '#625044', family: 'wood' },
  { id: 'ash', label: 'Чёрный ясень', hex: '#393933', family: 'wood' },
];

export const STONES = [
  { id: 'terrazzo', label: 'Терраццо', hex: '#e0d5bd', family: 'terrazzo' },
  { id: 'travertine', label: 'Травертин', hex: '#d8c5a3', family: 'travertine' },
  { id: 'slate', label: 'Сланец', hex: '#454d4c', family: 'slate' },
];

export const FABRICS = [
  { id: 'boucle', label: 'Букле', hex: '#e4ddd0', family: 'fabric' },
  { id: 'linen', label: 'Лён', hex: '#d9d1c1', family: 'fabric' },
  { id: 'sage', label: 'Шалфей', hex: '#9aa38c', family: 'fabric' },
  { id: 'rust', label: 'Ржавчина', hex: '#a2543a', family: 'fabric' },
  { id: 'ink', label: 'Индиго', hex: '#3a4656', family: 'fabric' },
  { id: 'sand', label: 'Песок', hex: '#c9b28f', family: 'fabric' },
];

export const ROOF_TYPES = [
  { id: 'standingSeam', label: 'Кликфальц' },
  { id: 'metalTile', label: 'Металлочерепица' },
];

export const CEILING_TYPES = [
  { id: 'timber', label: 'Имитация бруса' },
  { id: 'stretch', label: 'Матовый натяжной' },
];

export const WALL_LAYOUTS = [
  { id: 'vertical', label: 'Вертикальная' },
  { id: 'horizontal', label: 'Горизонтальная' },
  { id: 'smooth', label: 'Гладкая окраска' },
];

const byId = (list) => Object.fromEntries(list.map((m) => [m.id, m]));
export const MATERIALS = {
  ...byId(INTERIOR_PAINTS),
  ...byId(FACADE_PAINTS),
  ...byId(DOOR_FINISHES),
  ...byId(WOODS),
  ...byId(STONES),
  ...byId(FABRICS),
};

// Допустимые значения слотов. Слоты фасада — четыре логические стороны геометрии.
export const SLOT_OPTIONS = {
  facade: FACADE_PAINTS.map((m) => m.id),
  wall: INTERIOR_PAINTS.map((m) => m.id),
  ceiling: INTERIOR_PAINTS.map((m) => m.id),
  floorWood: ['oak', 'whiteoak', 'walnut'],
  floorWet: STONES.map((m) => m.id),
  terrace: WOODS.map((m) => m.id),
  interiorDoors: DOOR_FINISHES.map((m) => m.id),
  joinery: ['oak', 'whiteoak', 'walnut', 'ash'],
  upholstery: ['boucle', 'linen', 'sage', 'ink', 'sand'],
  accent: ['rust', 'sage', 'ink', 'sand'],
  bedding: ['linen', 'boucle', 'sage', 'sand'],
  counter: ['travertine', 'terrazzo', 'slate', 'walnut'],
};

export const FACADE_SIDES = ['north', 'east', 'south', 'west'];
export const FACADE_SIDE_LABELS = { north: 'Северный', east: 'Восточный (терраса)', south: 'Южный', west: 'Западный' };

export function hexOf(id) {
  return MATERIALS[id]?.hex || '#cccccc';
}

export function labelOf(id) {
  const m = MATERIALS[id];
  if (!m) return id;
  return m.code ? `${m.code} ${m.label}` : m.label;
}
