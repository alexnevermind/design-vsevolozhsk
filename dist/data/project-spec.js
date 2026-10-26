// Сгенерировано scripts/build-spec.mjs — не редактировать вручную.
export default {
 "model": "house-plan-12x68",
 "approximate": true,
 "axes": {
  "X": "вправо по плану (на восток условного севера)",
  "Z": "вниз по плану; отрицательный Z — верхняя сторона листа",
  "Y": "вверх; чистый пол Y = 0, земля Y = −0,70",
  "fromDrawingMm": "X = (x − 6000) / 1000; Z = (z − 3400) / 1000",
  "sideRule": "side = 1 — нормаль [−dz, dx]; side = −1 — противоположная"
 },
 "house": {
  "outer": {
   "x0": -6,
   "x1": 6,
   "z0": -3.4,
   "z1": 3.4
  },
  "size": [
   12,
   6.8
  ],
  "terrace": {
   "x0": 6,
   "x1": 9,
   "z0": -3.4,
   "z1": 3.4
  },
  "wingEndX": 7.5,
  "roomsArea": 72,
  "terraceArea": 20,
  "footprintArea": 81.6
 },
 "heights": {
  "floorY": 0,
  "groundY": -0.7,
  "ceilingEdge": 2.3,
  "ceilingRidge": 2.7,
  "ridgeZ": 0,
  "halfSpan": 3.25,
  "slope": 0.12307691999999999,
  "formula": "ceilingHeight(z) = 2.70 − slope × |z − ridgeZ|, slope = 0.40 / 3.25"
 },
 "roof": {
  "structureDepth": 0.3,
  "baseThickness": 0.075,
  "overhang": 0.23,
  "coversWings": true,
  "x0": -6,
  "x1": 7.5,
  "seamSpacing": 0.43,
  "tile": {
   "wavePitch": 0.183,
   "rowPitch": 0.35,
   "waveHeight": 0.036,
   "step": 0.012
  }
 },
 "terrace": {
  "topY": -0.02,
  "boardWidth": 0.14,
  "boardLength": 3.4
 },
 "walls": {
  "exteriorThickness": 0.15,
  "snapInset": "половина толщины стены от оси (0,075 для 150 мм, 0,05 для 100 мм, 0,10 для 200 мм)",
  "claddingBoard": 0.145,
  "baseboard": 0.065,
  "cutHeight": 0.72
 },
 "floors": {
  "board": {
   "width": 0.18,
   "length": 1.8,
   "seam": 0.0016
  },
  "tile": {
   "size": 0.6,
   "seam": 0.0024
  }
 },
 "doors": {
  "leafThickness": 0.042,
  "leafHeight": 2.045,
  "leafNarrower": 0.065,
  "trimTop": 2.16
 },
 "floorGroups": {
  "wood": [
   "001",
   "002",
   "003",
   "004",
   "005"
  ],
  "wet": [
   "006",
   "007"
  ],
  "terrace": [
   "008"
  ]
 },
 "paintedRooms": [
  "001",
  "002",
  "003",
  "004",
  "005",
  "006"
 ],
 "rooms": [
  {
   "id": "001",
   "name": "Кабинет",
   "area": 6.1,
   "kind": "room",
   "polygon": [
    [
     -2.6,
     -3.25
    ],
    [
     0.45,
     -3.25
    ],
    [
     0.45,
     -1.25
    ],
    [
     -2.6,
     -1.25
    ]
   ],
   "center": [
    -1.075,
    -2.25
   ],
   "polygonArea": 6.1
  },
  {
   "id": "002",
   "name": "Спальня 1",
   "area": 9.8,
   "kind": "room",
   "polygon": [
    [
     -5.85,
     -3.25
    ],
    [
     -2.75,
     -3.25
    ],
    [
     -2.75,
     -0.1
    ],
    [
     -5.85,
     -0.1
    ]
   ],
   "center": [
    -4.3,
    -1.675
   ],
   "polygonArea": 9.765
  },
  {
   "id": "003",
   "name": "Спальня 2",
   "area": 9.8,
   "kind": "room",
   "polygon": [
    [
     -5.85,
     0.1
    ],
    [
     -2.75,
     0.1
    ],
    [
     -2.75,
     3.25
    ],
    [
     -5.85,
     3.25
    ]
   ],
   "center": [
    -4.3,
    1.675
   ],
   "polygonArea": 9.765
  },
  {
   "id": "004",
   "name": "Прихожая",
   "area": 4.1,
   "kind": "entry",
   "polygon": [
    [
     4.526,
     -3.25
    ],
    [
     5.85,
     -3.25
    ],
    [
     5.85,
     -0.15
    ],
    [
     4.526,
     -0.15
    ]
   ],
   "center": [
    5.188,
    -1.7
   ],
   "polygonArea": 4.1044
  },
  {
   "id": "005",
   "name": "Кухня-гостиная",
   "area": 33.2,
   "kind": "room",
   "kitchen": true,
   "polygon": [
    [
     -2.6,
     -1.1
    ],
    [
     -1.42,
     -1.1
    ],
    [
     -1.42,
     0.1
    ],
    [
     -1.32,
     0.1
    ],
    [
     -1.32,
     -1.1
    ],
    [
     0.45,
     -1.1
    ],
    [
     0.45,
     0.1
    ],
    [
     0.55,
     0.1
    ],
    [
     0.55,
     -0.65
    ],
    [
     4.376,
     -0.65
    ],
    [
     4.376,
     0
    ],
    [
     5.85,
     0
    ],
    [
     5.85,
     3.25
    ],
    [
     -2.6,
     3.25
    ]
   ],
   "center": [
    2.15,
    1.5
   ],
   "polygonArea": 33.1744
  },
  {
   "id": "006",
   "name": "Санузел",
   "area": 4.5,
   "kind": "wet",
   "polygon": [
    [
     2.538,
     -3.25
    ],
    [
     4.376,
     -3.25
    ],
    [
     4.376,
     -0.8
    ],
    [
     2.538,
     -0.8
    ]
   ],
   "center": [
    3.457,
    -2.025
   ],
   "polygonArea": 4.5031
  },
  {
   "id": "007",
   "name": "Парная",
   "area": 4.5,
   "kind": "sauna",
   "polygon": [
    [
     0.55,
     -3.25
    ],
    [
     2.388,
     -3.25
    ],
    [
     2.388,
     -0.8
    ],
    [
     0.55,
     -0.8
    ]
   ],
   "center": [
    1.469,
    -2.025
   ],
   "polygonArea": 4.5031
  },
  {
   "id": "008",
   "name": "Терраса",
   "area": 20,
   "kind": "terrace",
   "polygon": [
    [
     6,
     -3.25
    ],
    [
     7.5,
     -3.25
    ],
    [
     7.5,
     -3.4
    ],
    [
     9,
     -3.4
    ],
    [
     9,
     3.4
    ],
    [
     7.5,
     3.4
    ],
    [
     7.5,
     3.25
    ],
    [
     6,
     3.25
    ]
   ],
   "center": [
    7.95,
    0
   ],
   "polygonArea": 19.95
  }
 ],
 "wallList": [
  {
   "id": "north-002",
   "a": [
    -6,
    -3.325
   ],
   "b": [
    -2.675,
    -3.325
   ],
   "t": 0.15,
   "left": "002",
   "right": null,
   "facade": "north",
   "openings": [
    {
     "id": "W1",
     "type": "window",
     "from": 1.88,
     "to": 2.68,
     "low": 0.8,
     "high": 2.1
    }
   ]
  },
  {
   "id": "north-001",
   "a": [
    -2.675,
    -3.325
   ],
   "b": [
    0.5,
    -3.325
   ],
   "t": 0.15,
   "left": "001",
   "right": null,
   "facade": "north",
   "openings": [
    {
     "id": "W2",
     "type": "window",
     "from": 0.325,
     "to": 1.125,
     "low": 0.8,
     "high": 2.1
    }
   ]
  },
  {
   "id": "north-007",
   "a": [
    0.5,
    -3.325
   ],
   "b": [
    2.463,
    -3.325
   ],
   "t": 0.15,
   "left": "007",
   "right": null,
   "facade": "north",
   "openings": [
    {
     "id": "W3",
     "type": "window",
     "from": 0.3,
     "to": 0.9,
     "low": 1.2,
     "high": 2.1
    }
   ]
  },
  {
   "id": "north-006",
   "a": [
    2.463,
    -3.325
   ],
   "b": [
    4.451,
    -3.325
   ],
   "t": 0.15,
   "left": "006",
   "right": null,
   "facade": "north",
   "openings": [
    {
     "id": "W4",
     "type": "window",
     "from": 0.225,
     "to": 0.825,
     "low": 1.2,
     "high": 2.1
    }
   ]
  },
  {
   "id": "north-004",
   "a": [
    4.451,
    -3.325
   ],
   "b": [
    6,
    -3.325
   ],
   "t": 0.15,
   "left": "004",
   "right": null,
   "facade": "north",
   "openings": []
  },
  {
   "id": "north-wing",
   "a": [
    6,
    -3.325
   ],
   "b": [
    7.5,
    -3.325
   ],
   "t": 0.15,
   "left": "008",
   "right": null,
   "facade": "north",
   "wing": true,
   "openings": []
  },
  {
   "id": "south-003",
   "a": [
    -6,
    3.325
   ],
   "b": [
    -2.675,
    3.325
   ],
   "t": 0.15,
   "left": null,
   "right": "003",
   "facade": "south",
   "openings": [
    {
     "id": "W5",
     "type": "window",
     "from": 0.75,
     "to": 2.75,
     "low": 0.6,
     "high": 2.1,
     "mullions": 1
    }
   ]
  },
  {
   "id": "south-005",
   "a": [
    -2.675,
    3.325
   ],
   "b": [
    6,
    3.325
   ],
   "t": 0.15,
   "left": null,
   "right": "005",
   "facade": "south",
   "openings": [
    {
     "id": "W6",
     "type": "window",
     "from": 3.275,
     "to": 5.275,
     "low": 0.6,
     "high": 2.1,
     "mullions": 1
    }
   ]
  },
  {
   "id": "south-wing",
   "a": [
    6,
    3.325
   ],
   "b": [
    7.5,
    3.325
   ],
   "t": 0.15,
   "left": null,
   "right": "008",
   "facade": "south",
   "wing": true,
   "openings": []
  },
  {
   "id": "west-002",
   "a": [
    -5.925,
    -3.25
   ],
   "b": [
    -5.925,
    0
   ],
   "t": 0.15,
   "left": null,
   "right": "002",
   "facade": "west",
   "openings": [
    {
     "id": "W7",
     "type": "window",
     "from": 0.525,
     "to": 2.675,
     "low": 0.9,
     "high": 2.1,
     "mullions": 1
    }
   ]
  },
  {
   "id": "west-003",
   "a": [
    -5.925,
    0
   ],
   "b": [
    -5.925,
    3.25
   ],
   "t": 0.15,
   "left": null,
   "right": "003",
   "facade": "west",
   "openings": [
    {
     "id": "W8",
     "type": "window",
     "from": 0.575,
     "to": 2.725,
     "low": 0.9,
     "high": 2.1,
     "mullions": 1
    }
   ]
  },
  {
   "id": "east-004",
   "a": [
    5.925,
    -3.25
   ],
   "b": [
    5.925,
    -0.075
   ],
   "t": 0.15,
   "left": "004",
   "right": "008",
   "facade": "east",
   "openings": [
    {
     "id": "D-entry",
     "type": "entry",
     "from": 0.75,
     "to": 1.65,
     "low": 0,
     "high": 2.12,
     "hinge": "from",
     "swing": -1
    }
   ]
  },
  {
   "id": "east-005",
   "a": [
    5.925,
    -0.075
   ],
   "b": [
    5.925,
    3.25
   ],
   "t": 0.15,
   "left": "005",
   "right": "008",
   "facade": "east",
   "openings": [
    {
     "id": "G1",
     "type": "glazing",
     "from": 0.655,
     "to": 2.955,
     "low": 0,
     "high": 2.12,
     "slidingPart": "from",
     "mullions": 1
    }
   ]
  },
  {
   "id": "part-002-001",
   "a": [
    -2.675,
    -3.25
   ],
   "b": [
    -2.675,
    -1.175
   ],
   "t": 0.15,
   "left": "002",
   "right": "001",
   "openings": []
  },
  {
   "id": "part-002-005",
   "a": [
    -2.675,
    -1.175
   ],
   "b": [
    -2.675,
    0
   ],
   "t": 0.15,
   "left": "002",
   "right": "005",
   "openings": [
    {
     "id": "D-002",
     "type": "door",
     "from": 0.175,
     "to": 0.975,
     "low": 0,
     "high": 2.12,
     "hinge": "to",
     "swing": 1
    }
   ]
  },
  {
   "id": "part-003-005",
   "a": [
    -2.675,
    0
   ],
   "b": [
    -2.675,
    3.25
   ],
   "t": 0.15,
   "left": "003",
   "right": "005",
   "openings": [
    {
     "id": "D-003",
     "type": "door",
     "from": 0.2,
     "to": 1,
     "low": 0,
     "high": 2.12,
     "hinge": "from",
     "swing": 1
    }
   ]
  },
  {
   "id": "bedroom-divider",
   "a": [
    -5.85,
    0
   ],
   "b": [
    -2.75,
    0
   ],
   "t": 0.2,
   "left": "003",
   "right": "002",
   "openings": []
  },
  {
   "id": "south-001",
   "a": [
    -2.6,
    -1.175
   ],
   "b": [
    0.45,
    -1.175
   ],
   "t": 0.15,
   "left": "005",
   "right": "001",
   "openings": [
    {
     "id": "D-001",
     "type": "door",
     "from": 0.19,
     "to": 0.99,
     "low": 0,
     "high": 2.12,
     "hinge": "from",
     "swing": -1
    }
   ]
  },
  {
   "id": "w-001-007",
   "a": [
    0.5,
    -3.25
   ],
   "b": [
    0.5,
    -1.175
   ],
   "t": 0.1,
   "left": "001",
   "right": "007",
   "openings": []
  },
  {
   "id": "w-niche-007",
   "a": [
    0.5,
    -1.175
   ],
   "b": [
    0.5,
    -0.725
   ],
   "t": 0.1,
   "left": "005",
   "right": "007",
   "openings": []
  },
  {
   "id": "w-niche-east",
   "a": [
    0.5,
    -0.725
   ],
   "b": [
    0.5,
    0.1
   ],
   "t": 0.1,
   "left": "005",
   "right": "005",
   "openings": []
  },
  {
   "id": "w-niche-west",
   "a": [
    -1.37,
    -1.1
   ],
   "b": [
    -1.37,
    0.1
   ],
   "t": 0.1,
   "left": "005",
   "right": "005",
   "openings": []
  },
  {
   "id": "kitchen-007",
   "a": [
    0.55,
    -0.725
   ],
   "b": [
    2.463,
    -0.725
   ],
   "t": 0.15,
   "left": "005",
   "right": "007",
   "openings": []
  },
  {
   "id": "kitchen-006",
   "a": [
    2.463,
    -0.725
   ],
   "b": [
    4.376,
    -0.725
   ],
   "t": 0.15,
   "left": "005",
   "right": "006",
   "openings": []
  },
  {
   "id": "w-007-006",
   "a": [
    2.463,
    -3.25
   ],
   "b": [
    2.463,
    -0.8
   ],
   "t": 0.15,
   "left": "007",
   "right": "006",
   "openings": [
    {
     "id": "D-007",
     "type": "door",
     "from": 0.7,
     "to": 1.5,
     "low": 0,
     "high": 2.12,
     "hinge": "from",
     "swing": -1,
     "leaf": "glass"
    }
   ]
  },
  {
   "id": "w-006-004",
   "a": [
    4.451,
    -3.25
   ],
   "b": [
    4.451,
    -0.725
   ],
   "t": 0.15,
   "left": "006",
   "right": "004",
   "openings": [
    {
     "id": "D-006",
     "type": "door",
     "from": 0.7,
     "to": 1.5,
     "low": 0,
     "high": 2.12,
     "hinge": "from",
     "swing": -1
    }
   ]
  },
  {
   "id": "w-005-004",
   "a": [
    4.451,
    -0.725
   ],
   "b": [
    4.451,
    0
   ],
   "t": 0.15,
   "left": "005",
   "right": "004",
   "openings": []
  },
  {
   "id": "south-004",
   "a": [
    4.526,
    -0.075
   ],
   "b": [
    5.85,
    -0.075
   ],
   "t": 0.15,
   "left": "005",
   "right": "004",
   "openings": [
    {
     "id": "D-004",
     "type": "door",
     "from": 0.264,
     "to": 1.064,
     "low": 0,
     "high": 2.12,
     "hinge": "to",
     "swing": 1
    }
   ]
  }
 ],
 "builtins": [
  {
   "id": "sauna-bench-upper",
   "type": "saunaBench",
   "room": "007",
   "rect": [
    0.55,
    -3.25,
    1.34,
    -0.8
   ],
   "top": 0.95,
   "label": "Верхний полок"
  },
  {
   "id": "sauna-bench-lower",
   "type": "saunaBench",
   "room": "007",
   "rect": [
    1.34,
    -1.58,
    2.388,
    -0.8
   ],
   "top": 0.45,
   "label": "Нижний полок"
  },
  {
   "id": "sauna-stove",
   "type": "saunaStove",
   "room": "007",
   "rect": [
    1.905,
    -3.18,
    2.335,
    -2.75
   ],
   "top": 0.82,
   "label": "Печь-каменка"
  },
  {
   "id": "hall-closet",
   "type": "coatNiche",
   "room": "004",
   "rect": [
    4.526,
    -3.25,
    5.85,
    -2.64
   ],
   "top": 1.88,
   "label": "Вешалка с полкой"
  }
 ],
 "exteriorFixtures": {
  "wallLamps": [
   {
    "wall": "east-004",
    "u": 0.33,
    "y": 2,
    "side": -1
   },
   {
    "wall": "east-004",
    "u": 2.21,
    "y": 2,
    "side": -1
   },
   {
    "wall": "east-005",
    "u": 3.11,
    "y": 2,
    "side": -1
   }
  ],
  "roofVents": [
   {
    "x": 1.47,
    "z": -2.1,
    "d": 0.11
   },
   {
    "x": 3.46,
    "z": -2.1,
    "d": 0.11
   }
  ],
  "terraceStair": {
   "edge": "east",
   "x": 9,
   "center": 0,
   "width": 2.55,
   "treads": 4,
   "rise": 0.14,
   "run": 0.3
  }
 },
 "walk": {
  "start": {
   "room": "004",
   "x": 5.19,
   "z": -1.05,
   "yaw": 3.141592653589793
  },
  "eyeHeight": 1.6,
  "personHeight": 1.75,
  "radius": 0.22,
  "speed": 1.4,
  "fastSpeed": 2.6,
  "fov": 68,
  "near": 0.06,
  "maxStep": 0.04,
  "doorReach": 1.6,
  "initialInteriorAngle": -90,
  "initialEntryAngle": 80
 },
 "solarDefaults": {
  "latitude": 59.94,
  "longitude": 30.31,
  "utcOffset": 3,
  "date": "2026-06-21",
  "hour": 10.5,
  "northAngle": 0,
  "orientationConfirmed": false
 }
};
