// Исходные данные новой планировки в миллиметрах — единственный ручной ввод геометрии дома.
// Система координат чертежа: x — от наружной грани западной (левой) стены вправо,
// z — от наружной грани северной (верхней) стены вниз. Всё остальное
// (PROJECT_SPEC.json, INITIAL_PROJECT_STATE.json, HOUSE_PLAN.svg, dist/data/*.js)
// генерируется scripts/build-spec.mjs и проверяется тестами.

// Подписи размерных цепочек ровно так, как они напечатаны на листах.
export const DRAWING_LABELS = {
  overall: { length: 12000, depth: 6800, terrace: 3000 },
  // Верхняя наружная цепочка (по северному фасаду) и продолжение над террасой.
  north: [1880, 800, 970, 800, 2350, 600, 1288, 600, 4263, 1500],
  // Нижняя наружная цепочка (южный фасад).
  south: [750, 2000, 3850, 2000, 4950, 1500],
  // Левая цепочка (западный торец), сверху вниз.
  west: [675, 2200, 1150, 2200, 675],
  // Правая цепочка (восточный торец у террасы), сверху вниз.
  east: [900, 900, 2180, 2400, 520],
  // Внутренние цепочки.
  interiorTop: [3100, 150, 3050, 100, 1838, 150, 1838, 150, 1325],
  interiorBottom: [3100, 150, 8450],
  interiorLeft: [3150, 200, 3150],
  interiorRight: [3100, 150, 3250],
  corridor: [1180, 100, 1770, 100, 3825, 415, 800, 260],
  room001South: [190, 800, 2060],
  partition: [2250, 800, 100, 200, 100, 800, 2250],
  wetZoneWall: [700, 800, 950],
  roomAreas: { '001': 6.1, '002': 9.8, '003': 9.8, '004': 4.1, '005': 33.2, '006': 4.5, '007': 4.5, '008': 20.0 },
};

// Принятые исправления противоречивых подписей (подробно — docs/ASSUMPTIONS.md).
// Каждое исправление подтверждено промером пикселей чертежа (масштаб 0,0772 px/мм).
export const CORRECTIONS = [
  {
    id: 'C1',
    chain: 'west',
    printed: [675, 2200, 1150, 2200, 675],
    used: [675, 2150, 1150, 2150, 675],
    reason: 'Сумма напечатанной цепочки 6900 ≠ габариту 6800. Промер: окна ≈2150 мм, поля 680/650, простенок ≈1167.',
  },
  {
    id: 'C2',
    chain: 'east',
    printed: [900, 900, 2180, 2400, 520],
    used: [900, 900, 2180, 2300, 520],
    reason: 'Сумма 6900 ≠ 6800. Промер остекления 3972…6304 мм ≈ 2330; ширина остекления принята 2300.',
  },
  {
    id: 'C3',
    chain: 'north/south',
    printed: [4263, 4950],
    used: [4212, 4900],
    reason: 'Стенки-крылья террасы по цепочкам заканчиваются на 13 550, но терраса делится 1500 + 1500 и промер даёт ≈13 470. Длина крыльев принята 1500.',
  },
  {
    id: 'C4',
    chain: 'interiorTop',
    printed: [1325],
    used: [1324],
    reason: 'Сумма внутренней цепочки с наружными стенами 150 даёт 12 001; ширина прихожей принята 1324.',
  },
];

export const HOUSE = { length: 12000, depth: 6800, outerWall: 150, terraceDepth: 3000, wingLength: 1500 };

// Помещения. rects — объединение прямоугольников [x0, z0, x1, z1] по чистовым граням стен.
export const ROOMS = [
  { id: '001', name: 'Кабинет', area: 6.1, kind: 'room', rects: [[3400, 150, 6450, 2150]] },
  { id: '002', name: 'Спальня 1', area: 9.8, kind: 'room', rects: [[150, 150, 3250, 3300]] },
  { id: '003', name: 'Спальня 2', area: 9.8, kind: 'room', rects: [[150, 3500, 3250, 6650]] },
  { id: '004', name: 'Прихожая', area: 4.1, kind: 'entry', rects: [[10526, 150, 11850, 3250]] },
  {
    id: '005',
    name: 'Кухня-гостиная',
    area: 33.2,
    kind: 'room',
    // Контур по часовой стрелке (z вниз): коридор у спален, ниша 1770×1200, кухня, гостиная.
    polygon: [
      [3400, 2300], [4580, 2300], [4580, 3500], [4680, 3500], [4680, 2300], [6450, 2300],
      [6450, 3500], [6550, 3500], [6550, 2750], [10376, 2750], [10376, 3400], [11850, 3400],
      [11850, 6650], [3400, 6650],
    ],
    label: [8150, 4900],
  },
  { id: '006', name: 'Санузел', area: 4.5, kind: 'wet', rects: [[8538, 150, 10376, 2600]] },
  { id: '007', name: 'Парная', area: 4.5, kind: 'sauna', rects: [[6550, 150, 8388, 2600]] },
  {
    id: '008',
    name: 'Терраса',
    area: 20.0,
    kind: 'terrace',
    polygon: [
      [12000, 150], [13500, 150], [13500, 0], [15000, 0], [15000, 6800], [13500, 6800], [13500, 6650], [12000, 6650],
    ],
    label: [13950, 3400],
  },
];

// Стены: ось a→b, толщина t. Направление всегда +x или +z.
// side=1 (left) — нормаль [-dz, dx]: у горизонтальной стены это юг (+z), у вертикальной — запад (−x).
// Проёмы: from/to — расстояние вдоль оси от a, low/high — отметки от чистого пола, мм.
// hinge: 'from' | 'to' — у какого края петли; swing: 1 | -1 — в сторону side.
export const WALLS = [
  // Северный фасад (ось z = 75)
  { id: 'north-002', a: [0, 75], b: [3325, 75], t: 150, left: '002', right: null, facade: 'north',
    openings: [{ id: 'W1', type: 'window', from: 1880, to: 2680, low: 800, high: 2100 }] },
  { id: 'north-001', a: [3325, 75], b: [6500, 75], t: 150, left: '001', right: null, facade: 'north',
    openings: [{ id: 'W2', type: 'window', from: 325, to: 1125, low: 800, high: 2100 }] },
  { id: 'north-007', a: [6500, 75], b: [8463, 75], t: 150, left: '007', right: null, facade: 'north',
    openings: [{ id: 'W3', type: 'window', from: 300, to: 900, low: 1200, high: 2100 }] },
  { id: 'north-006', a: [8463, 75], b: [10451, 75], t: 150, left: '006', right: null, facade: 'north',
    openings: [{ id: 'W4', type: 'window', from: 225, to: 825, low: 1200, high: 2100 }] },
  { id: 'north-004', a: [10451, 75], b: [12000, 75], t: 150, left: '004', right: null, facade: 'north', openings: [] },
  { id: 'north-wing', a: [12000, 75], b: [13500, 75], t: 150, left: '008', right: null, facade: 'north', wing: true, openings: [] },
  // Южный фасад (ось z = 6725)
  { id: 'south-003', a: [0, 6725], b: [3325, 6725], t: 150, left: null, right: '003', facade: 'south',
    openings: [{ id: 'W5', type: 'window', from: 750, to: 2750, low: 600, high: 2100, mullions: 1 }] },
  { id: 'south-005', a: [3325, 6725], b: [12000, 6725], t: 150, left: null, right: '005', facade: 'south',
    openings: [{ id: 'W6', type: 'window', from: 3275, to: 5275, low: 600, high: 2100, mullions: 1 }] },
  { id: 'south-wing', a: [12000, 6725], b: [13500, 6725], t: 150, left: null, right: '008', facade: 'south', wing: true, openings: [] },
  // Западный торец (ось x = 75)
  { id: 'west-002', a: [75, 150], b: [75, 3400], t: 150, left: null, right: '002', facade: 'west',
    openings: [{ id: 'W7', type: 'window', from: 525, to: 2675, low: 900, high: 2100, mullions: 1 }] },
  { id: 'west-003', a: [75, 3400], b: [75, 6650], t: 150, left: null, right: '003', facade: 'west',
    openings: [{ id: 'W8', type: 'window', from: 575, to: 2725, low: 900, high: 2100, mullions: 1 }] },
  // Восточный торец у террасы (ось x = 11925)
  { id: 'east-004', a: [11925, 150], b: [11925, 3325], t: 150, left: '004', right: '008', facade: 'east',
    openings: [{ id: 'D-entry', type: 'entry', from: 750, to: 1650, low: 0, high: 2120, hinge: 'from', swing: -1 }] },
  { id: 'east-005', a: [11925, 3325], b: [11925, 6650], t: 150, left: '005', right: '008', facade: 'east',
    openings: [{ id: 'G1', type: 'glazing', from: 655, to: 2955, low: 0, high: 2120, slidingPart: 'from', mullions: 1 }] },
  // Перегородка спален / кабинета и кухни-гостиной (ось x = 3325)
  { id: 'part-002-001', a: [3325, 150], b: [3325, 2225], t: 150, left: '002', right: '001', openings: [] },
  { id: 'part-002-005', a: [3325, 2225], b: [3325, 3400], t: 150, left: '002', right: '005',
    openings: [{ id: 'D-002', type: 'door', from: 175, to: 975, low: 0, high: 2120, hinge: 'to', swing: 1 }] },
  { id: 'part-003-005', a: [3325, 3400], b: [3325, 6650], t: 150, left: '003', right: '005',
    openings: [{ id: 'D-003', type: 'door', from: 200, to: 1000, low: 0, high: 2120, hinge: 'from', swing: 1 }] },
  // Перегородка между спальнями 200 мм (ось z = 3400)
  { id: 'bedroom-divider', a: [150, 3400], b: [3250, 3400], t: 200, left: '003', right: '002', openings: [] },
  // Южная стена кабинета (ось z = 2225)
  { id: 'south-001', a: [3400, 2225], b: [6450, 2225], t: 150, left: '005', right: '001',
    openings: [{ id: 'D-001', type: 'door', from: 190, to: 990, low: 0, high: 2120, hinge: 'from', swing: -1 }] },
  // Стена кабинет/ниша | парная/кухня (ось x = 6500, 100 мм)
  { id: 'w-001-007', a: [6500, 150], b: [6500, 2225], t: 100, left: '001', right: '007', openings: [] },
  { id: 'w-niche-007', a: [6500, 2225], b: [6500, 2675], t: 100, left: '005', right: '007', openings: [] },
  { id: 'w-niche-east', a: [6500, 2675], b: [6500, 3500], t: 100, left: '005', right: '005', openings: [] },
  // Левая стенка ниши (ось x = 4630, 100 мм)
  { id: 'w-niche-west', a: [4630, 2300], b: [4630, 3500], t: 100, left: '005', right: '005', openings: [] },
  // Стена мокрой зоны за кухней (ось z = 2675)
  { id: 'kitchen-007', a: [6550, 2675], b: [8463, 2675], t: 150, left: '005', right: '007', openings: [] },
  { id: 'kitchen-006', a: [8463, 2675], b: [10376, 2675], t: 150, left: '005', right: '006', openings: [] },
  // Парная | санузел (ось x = 8463)
  { id: 'w-007-006', a: [8463, 150], b: [8463, 2600], t: 150, left: '007', right: '006',
    openings: [{ id: 'D-007', type: 'door', from: 700, to: 1500, low: 0, high: 2120, hinge: 'from', swing: -1, leaf: 'glass' }] },
  // Санузел | прихожая (ось x = 10451)
  { id: 'w-006-004', a: [10451, 150], b: [10451, 2675], t: 150, left: '006', right: '004',
    openings: [{ id: 'D-006', type: 'door', from: 700, to: 1500, low: 0, high: 2120, hinge: 'from', swing: -1 }] },
  { id: 'w-005-004', a: [10451, 2675], b: [10451, 3400], t: 150, left: '005', right: '004', openings: [] },
  // Южная стена прихожей (ось z = 3325)
  { id: 'south-004', a: [10526, 3325], b: [11850, 3325], t: 150, left: '005', right: '004',
    openings: [{ id: 'D-004', type: 'door', from: 264, to: 1064, low: 0, high: 2120, hinge: 'to', swing: 1 }] },
];

// Встроенное оборудование (не переставляется): полки и печь парной, вешалка прихожей.
export const BUILTINS = [
  { id: 'sauna-bench-upper', type: 'saunaBench', room: '007', rect: [6550, 150, 7340, 2600], top: 950, label: 'Верхний полок' },
  { id: 'sauna-bench-lower', type: 'saunaBench', room: '007', rect: [7340, 1820, 8388, 2600], top: 450, label: 'Нижний полок' },
  { id: 'sauna-stove', type: 'saunaStove', room: '007', rect: [7905, 220, 8335, 650], top: 820, label: 'Печь-каменка' },
  { id: 'hall-closet', type: 'coatNiche', room: '004', rect: [10526, 150, 11850, 760], top: 1880, label: 'Вешалка с полкой' },
];

// Исходная расстановка: центр footprint в мм, угол в градусах (перед модели — локальная +Z).
export const ITEMS = [
  { id: 1, type: 'bed', room: '002', x: 1190, z: 1725, ry: 90, anchor: { wall: 'west-002', side: -1 } },
  { id: 2, type: 'bed', room: '003', x: 1190, z: 5075, ry: 90, anchor: { wall: 'west-003', side: -1 } },
  { id: 3, type: 'bedSingle', room: '001', x: 5970, z: 1140, ry: 0, anchor: { wall: 'north-001', side: 1 } },
  { id: 4, type: 'desk', room: '001', x: 4000, z: 450, ry: 0 },
  { id: 5, type: 'chair', room: '001', x: 4000, z: 1020, ry: 180 },
  { id: 6, type: 'wardrobe', room: '005', x: 5165, z: 2600, ry: 0, anchor: { wall: 'south-001', side: 1 } },
  { id: 7, type: 'wardrobe', room: '005', x: 5970, z: 2600, ry: 0, anchor: { wall: 'south-001', side: 1 } },
  { id: 8, type: 'kitchenHob', room: '005', x: 7684.5, z: 3090, ry: 0, anchor: { wall: 'kitchen-007', side: 1 } },
  { id: 9, type: 'kitchenCabinet', room: '005', x: 8512.5, z: 3090, ry: 0, anchor: { wall: 'kitchen-006', side: 1 } },
  { id: 10, type: 'kitchenSink', room: '005', x: 9390.5, z: 3090, ry: 0, anchor: { wall: 'kitchen-006', side: 1 } },
  { id: 11, type: 'fridge', room: '005', x: 10116, z: 3070, ry: 0, anchor: { wall: 'kitchen-006', side: 1 } },
  { id: 12, type: 'sofa', room: '005', x: 4140, z: 5525, ry: 90 },
  { id: 13, type: 'coffee', room: '005', x: 5200, z: 5525, ry: 90 },
  { id: 14, type: 'mediaUnit', room: '005', x: 6300, z: 5525, ry: -90 },
  { id: 15, type: 'dining', room: '005', x: 9900, z: 5620, ry: 0 },
  { id: 16, type: 'chair', room: '005', x: 9030, z: 5620, ry: 90 },
  { id: 17, type: 'chair', room: '005', x: 10770, z: 5620, ry: -90 },
  { id: 18, type: 'chair', room: '005', x: 9900, z: 4975, ry: 0 },
  { id: 19, type: 'chair', room: '005', x: 9900, z: 6265, ry: 180 },
  { id: 20, type: 'toilet', room: '006', x: 9050, z: 2275, ry: 180, anchor: { wall: 'kitchen-006', side: -1 } },
  { id: 21, type: 'shower', room: '006', x: 9921, z: 2135, ry: 180, anchor: { wall: 'kitchen-006', side: -1 } },
  { id: 22, type: 'vanity', room: '006', x: 9700, z: 390, ry: 0, anchor: { wall: 'north-006', side: 1 } },
  { id: 23, type: 'washer', room: '006', x: 8858, z: 470, ry: 90, anchor: { wall: 'w-007-006', side: -1 } },
];

// Фасадные светильники (3 на торце у террасы) и вентиляционные выводы на кровле.
export const EXTERIOR_FIXTURES = {
  wallLamps: [
    { wall: 'east-004', u: 330, y: 2000, side: -1 },
    { wall: 'east-004', u: 2210, y: 2000, side: -1 },
    { wall: 'east-005', u: 3110, y: 2000, side: -1 },
  ],
  // Вентиляция парной и санузла — северный скат.
  roofVents: [
    { x: 7470, z: 1300, d: 110 },
    { x: 9460, z: 1300, d: 110 },
  ],
  // Ступени террасы: 4 промежуточные проступи по 0,30 м, подступенок 0,14 м, ширина 2,55 м.
  terraceStair: { edge: 'east', center: 3400, width: 2550, treads: 4, rise: 140, run: 300 },
};
