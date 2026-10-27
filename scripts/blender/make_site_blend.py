"""Сборка vsevolozhsk-site.blend из фактической сцены приложения участка (Blender 4.3, bpy).

Источник — artifacts/vsevolozhsk-site.glb и artifacts/vsevolozhsk-site.json (`npm run export:site`): та же
геометрия, что строит приложение (постройки по листам с интерьерами и исходной расстановкой мебели, оба
варианта фасада, рельеф, благоустройство, деревья по плану, фонари), виды камер, солнце для Всеволожска
и точки ночного света. Скрипт раскладывает части по коллекциям, делает две сцены — «День · 21 июня 13:00»
и «Ночь · 23:15» (общие коллекции; ночью — фонари, свет помещений и огонь), ставит камеры видов
приложения и сохраняет assets-source/vsevolozhsk-site.blend. Фасад «Штукатурка и кирпич» — коллекция
«Фасад 2», выключенная по умолчанию (включить её и выключить «Фасад 1 · доска»).
С ключом --render дополнительно делает контрольные кадры Cycles (artifacts/screenshots/blender-site-*.png) —
это рендер Blender, а не снимок браузера.

Запуск: <python с bpy 4.3> scripts/blender/make_site_blend.py [--render]
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GLB = os.path.join(ROOT, "artifacts", "vsevolozhsk-site.glb")
META = os.path.join(ROOT, "artifacts", "vsevolozhsk-site.json")
OUT = os.path.join(ROOT, "assets-source", "vsevolozhsk-site.blend")

# glTF Y-up → Blender Z-up: точка приложения (x, y, z) = Blender (x, −z, y); север — +Y, восток — +X.
def bl(p):
    return Vector((p[0], -p[2], p[1]))


def move_tree(obj, coll):
    for o in [obj, *obj.children_recursive]:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)


def new_collection(name, parent):
    c = bpy.data.collections.new(name)
    parent.children.link(c)
    return c


def camera(scene_coll, name, view):
    # Угол зрения — как у камеры приложения (вертикальный).
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(view.get("fov", 45))
    cam.data.clip_start = 0.05
    cam.data.clip_end = 800
    p, t = bl(view["pos"]), bl(view["target"])
    cam.location = p
    cam.rotation_euler = (t - p).to_track_quat("-Z", "Y").to_euler()
    scene_coll.objects.link(cam)
    return cam


def sun_lamp(name, d, energy):
    data = bpy.data.lights.new(name, "SUN")
    data.energy = energy
    data.angle = math.radians(0.53)
    sun = bpy.data.objects.new(name, data)
    sun.rotation_euler = bl(d).normalized().to_track_quat("Z", "Y").to_euler()
    return sun


def world(name, elevation, rotation, strength, night=False):
    w = bpy.data.worlds.new(name)
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    if night:
        bg.inputs["Color"].default_value = (0.004, 0.006, 0.014, 1)
        bg.inputs["Strength"].default_value = 1.0
        return w
    sky = w.node_tree.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = elevation
    sky.sun_rotation = rotation
    sky.sun_disc = False  # солнце даёт отдельный источник; диск неба удвоил бы освещённость
    w.node_tree.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    return w


def main():
    for f in (GLB, META):
        if not os.path.exists(f):
            sys.exit("Нет artifacts/vsevolozhsk-site.glb/json — сначала npm run export:site")
    meta = json.load(open(META, encoding="utf-8"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    day = bpy.context.scene
    day.name = "День · 21 июня 13:00"
    bpy.ops.import_scene.gltf(filepath=GLB)
    root = next(o for o in day.objects if o.name.startswith("Vsevolozhsk_site"))
    master = new_collection("Участок · Всеволожск", day.collection)
    by = {c.name.split(".")[0]: c for c in root.children}
    colls = {}

    # Мебель (узлы item:постройка:id) — отдельной коллекцией, остальное — по постройкам.
    furniture = new_collection("Мебель · по листам", master)
    titles = {"guest": "Гостевой дом-баня", "grill": "Гриль-дом", "garage": "Навес с хоз.блоком"}
    builds = new_collection("Постройки", master)
    for b in by["buildings"].children:
        bid = b.name.split(".")[0].replace("building_", "")
        c = new_collection(f"Постройка · {titles.get(bid, bid)}", builds)
        items = [o for o in b.children_recursive if o.name.startswith("item:")]
        move_tree(b, c)
        for it in items:
            if it.parent and it.parent.name.startswith("item:"):
                continue
            move_tree(it, furniture)
    colls["board"] = new_collection("Фасад 1 · доска", master)
    move_tree(by["facade_board"], colls["board"])
    colls["plaster"] = new_collection("Фасад 2 · штукатурка и кирпич", master)
    move_tree(by["facade_plaster"], colls["plaster"])
    for key, title in (("ground", "Рельеф и газон"), ("landscape", "Благоустройство"),
                       ("fire_zones", "Очаг гриль-дома"), ("trees", "Деревья по плану"), ("backdrop", "Фон · лес за забором"),
                       ("lamps", "Фонари и столбики")):
        if key in by:
            move_tree(by[key], new_collection(title, master))
    # Корень и пустые узлы групп (родители) — в общую коллекцию, чтобы иерархия была в обеих сценах.
    for o in [root, *root.children]:
        if day.collection in o.users_collection:
            day.collection.objects.unlink(o)
            master.objects.link(o)
    bpy.ops.file.pack_all()

    # Камеры видов приложения.
    cams = new_collection("Камеры", master)
    names = {"site": "общий вид", "guest": "гостевой дом", "grill": "гриль-дом", "garage": "хоз.блок и навес", "entry": "от калитки",
             "fire": "кострище", "pond": "пруд и купель", "dining": "обеденная площадка", "living": "гостиная", "kitchen": "кухня и лестница",
             "mansard": "мансарда", "rest": "комната отдыха", "grill-inside": "гриль-дом внутри"}
    cam = {k: camera(cams, f"Камера · {names.get(k, k)}", v) for k, v in meta["views"].items()}
    # Деревья, которые приложение на этом виде скрывает (заслоняют постройку), — свойство камеры;
    # при рендере --render они не рисуются (тени остаются).
    for k, v in meta["views"].items():
        cam[k]["скрыть_деревья"] = ", ".join(v.get("hiddenTrees", []))

    # День: солнце 21 июня 13:00 (из приложения: высота ≈ 53°, юг), небо Nishita.
    s = meta["sun"]["13"]
    d = bl(s["dir"]).normalized()
    sun = sun_lamp("Солнце · 13:00", s["dir"], 4.5)
    day.collection.objects.link(sun)
    day.world = world("Небо · день", math.radians(s["elevation"]), math.atan2(-d.x, d.y), 0.45)

    # Ночь: те же коллекции, фонари, светильники помещений и огонь очага и кострища.
    night = bpy.data.scenes.new("Ночь · 23:15")
    night.collection.children.link(master)
    lights = bpy.data.collections.new("Ночной свет")
    night.collection.children.link(lights)
    for i, L in enumerate(meta["lamps"]):
        data = bpy.data.lights.new(f"Свет {i + 1}", "POINT")
        data.energy = 18 * L["intensity"] * L["radius"] / 4
        data.color = L["color"][:3]
        data.shadow_soft_size = 0.06
        o = bpy.data.objects.new(f"Свет {i + 1}", data)
        o.location = bl(L["pos"])
        lights.objects.link(o)
    for f in meta["fires"]:
        data = bpy.data.lights.new(f"Огонь · {f['name']}", "POINT")
        data.energy = 220
        data.color = (1.0, 0.55, 0.22)
        data.shadow_soft_size = 0.25
        o = bpy.data.objects.new(data.name, data)
        o.location = bl(f["pos"])
        lights.objects.link(o)
    night.world = world("Небо · ночь", 0, 0, 1, night=True)

    for sc, c, ev in ((day, cam["guest"], -0.6), (night, cam["guest"], 0.6)):
        sc.camera = c
        sc.render.resolution_x = 1600
        sc.render.resolution_y = 1000
        sc.unit_settings.system = "METRIC"
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.exposure = ev
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = 128
        sc.cycles.use_denoising = True
    # Вариант фасада «штукатурка» выключен в обеих сценах.
    def layer(lc, coll):
        if lc.collection == coll:
            return lc
        for ch in lc.children:
            r = layer(ch, coll)
            if r:
                return r
        return None

    for sc in (day, night):
        layer(sc.view_layers[0].layer_collection, colls["plaster"]).exclude = True

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    meshes = sum(1 for o in bpy.data.objects if o.type == "MESH")
    print(f"assets-source/vsevolozhsk-site.blend: {meshes} объектов-сеток, {len(cam)} камер, {len(meta['lamps'])} ночных светильников; "
          f"коллекции: {', '.join(c.name for c in master.children)}")

    if "--render" in sys.argv:
        shots = os.path.join(ROOT, "artifacts", "screenshots")
        os.makedirs(shots, exist_ok=True)
        samples = int(os.environ.get("CYCLES_SAMPLES", "32"))
        pct = int(os.environ.get("CYCLES_PERCENT", "50"))
        # Сцена, вид, имя кадра, поправка экспозиции (в помещении глаз привыкает к меньшему свету), фасад 2.
        jobs = [(day, "guest", "day-guest", 0, False), (day, "guest", "day-guest-plaster", 0, True), (day, "site", "day-site", 0, False),
                (day, "grill", "day-grill", 0, False), (day, "living", "day-living", 3.8, False), (day, "kitchen", "day-kitchen", 3.8, False),
                (night, "guest", "night-guest", 0, False)]
        only = os.environ.get("CYCLES_ONLY")
        base_ev = {day.name: day.view_settings.exposure, night.name: night.view_settings.exposure}
        for sc, view, name, ev, plaster in jobs:
            if only and name not in only.split(","):
                continue
            layer(sc.view_layers[0].layer_collection, colls["plaster"]).exclude = not plaster
            layer(sc.view_layers[0].layer_collection, colls["board"]).exclude = plaster
            sc.view_settings.exposure = base_ev[sc.name] + ev
            sc.camera = cam[view]
            hide = set(meta["views"][view].get("hiddenTrees", []))
            for o in bpy.data.objects:
                if o.name.split("_")[0] in hide and o.type == "MESH":
                    o.visible_camera = False
            sc.cycles.samples = samples
            sc.render.resolution_percentage = pct
            sc.render.filepath = os.path.join(shots, f"blender-site-{name}.png")
            bpy.ops.render.render(write_still=True, scene=sc.name)
            for o in bpy.data.objects:
                o.visible_camera = True
            layer(sc.view_layers[0].layer_collection, colls["plaster"]).exclude = True
            layer(sc.view_layers[0].layer_collection, colls["board"]).exclude = False
            sc.view_settings.exposure = base_ev[sc.name]
            print("Cycles:", sc.render.filepath)


main()
