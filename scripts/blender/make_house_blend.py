"""Сборка house.blend из фактической браузерной архитектуры (Blender 4.3, bpy).

Источник — artifacts/house-architecture.glb, который пишет `npm run export:glb`: та же геометрия,
что строит конфигуратор из PROJECT_SPEC.json (стены, проёмы, окна, двери, полы, потолок по скатам,
кровля, терраса, сваи, водостоки, шторы) плюс исходная расстановка мебели с декором из
INITIAL_PROJECT_STATE.json и участок у дома (мангальная зона, гравийные дорожки, столбики).
Скрипт импортирует GLB, раскладывает части по коллекциям, упаковывает карты, ставит солнце,
камеры фасада и интерьера и сохраняет assets-source/house.blend.
С ключом --render дополнительно делает контрольный кадр Cycles (artifacts/screenshots/blender-cycles-facade.png),
это рендер Blender, а не снимок браузера.

Запуск: <python с bpy 4.3> scripts/blender/make_house_blend.py [--render]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GLB = os.path.join(ROOT, "artifacts", "house-architecture.glb")
OUT = os.path.join(ROOT, "assets-source", "house.blend")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def main():
    if not os.path.exists(GLB):
        sys.exit("Нет artifacts/house-architecture.glb — сначала npm run export:glb")
    reset()
    bpy.ops.import_scene.gltf(filepath=GLB)
    scene = bpy.context.scene
    root = next(o for o in scene.objects if o.name.startswith("VSEMDOM_house"))
    groups = {}
    for child in root.children:
        key = child.name.split(".")[0]
        title = key.replace("arch_", "Архитектура · ").replace("furniture_initial", "Мебель · исходная расстановка").replace("site", "Участок · мангальная зона и дорожки")
        coll = collection(title)
        groups[key] = coll
        for o in [child, *child.children_recursive]:
            for c in o.users_collection:
                c.objects.unlink(o)
            coll.objects.link(o)
    bpy.ops.file.pack_all()

    # Солнце: азимут 200°, высота 38° (как дневной кадр по умолчанию), небо — Nishita.
    sun_data = bpy.data.lights.new("Солнце", "SUN")
    sun_data.energy = 3.0
    sun_data.angle = math.radians(0.53)
    sun = bpy.data.objects.new("Солнце", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(90 - 38), 0, math.radians(200))
    world = bpy.data.worlds.new("Небо")
    world.use_nodes = True
    sky = world.node_tree.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(38)
    sky.sun_rotation = math.radians(200)
    sky.sun_disc = False  # солнце даёт отдельный источник; диск неба удвоил бы освещённость
    world.node_tree.links.new(sky.outputs["Color"], world.node_tree.nodes["Background"].inputs["Color"])
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
    scene.world = world
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = -1.6

    # Газон участка: земля на 0,70 м ниже чистого пола (браузерная Y = −0,70 → Blender Z = −0,70).
    bpy.ops.mesh.primitive_plane_add(size=90, location=(1.5, 0, -0.7))
    ground = bpy.context.active_object
    ground.name = "Газон"
    gm = bpy.data.materials.new("Газон")
    gm.use_nodes = True
    gb = gm.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = (0.11, 0.16, 0.06, 1)
    gb.inputs["Roughness"].default_value = 1.0
    ground.data.materials.append(gm)

    # Камеры. glTF Y-up → Blender Z-up: браузерная (x, y, z) = Blender (x, −z, y).
    def camera(name, pos, target, lens):
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        cam.data.lens = lens
        scene.collection.objects.link(cam)
        p = Vector((pos[0], -pos[2], pos[1]))
        t = Vector((target[0], -target[2], target[1]))
        cam.location = p
        cam.rotation_euler = (t - p).to_track_quat("-Z", "Y").to_euler()
        return cam

    facade = camera("Камера · фасад", (1.8 + 20.5 * 0.8, 4.4 - 0.6, 27 * 0.8), (1.6, 0.8, 0), 35)
    camera("Камера · кухня-гостиная", (3.6, 2.3, 1.9), (-1.5, 1.4, -1.2), 20)
    camera("Камера · мангальная зона", (17.4, 1.6, 17.2), (11.6, -0.15, 10.4), 30)
    # Свет костра для вечерних кадров (в рендере выключен — включается вручную).
    fire_data = bpy.data.lights.new("Костёр", "POINT")
    fire_data.energy = 180
    fire_data.color = (1.0, 0.55, 0.22)
    fire_data.shadow_soft_size = 0.25
    fire = bpy.data.objects.new("Костёр", fire_data)
    fire.location = (12.2, -11.0, -0.7 + 0.5)
    fire.hide_render = True
    scene.collection.objects.link(fire)
    scene.camera = facade
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.unit_settings.system = "METRIC"

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    meshes = sum(1 for o in scene.objects if o.type == "MESH")
    print(f"assets-source/house.blend: {meshes} объектов-сеток, коллекции: {', '.join(c.name for c in groups.values())}")

    if "--render" in sys.argv:
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = int(os.environ.get("CYCLES_SAMPLES", "48"))
        scene.cycles.use_denoising = True
        scene.render.resolution_percentage = 50
        scene.render.filepath = os.path.join(ROOT, "artifacts", "screenshots", "blender-cycles-facade.png")
        bpy.ops.render.render(write_still=True)
        print("Cycles:", scene.render.filepath)


main()
