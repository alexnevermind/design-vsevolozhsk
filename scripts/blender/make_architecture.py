"""Архитектурная библиотека профилей (Blender 4.3): имитация бруса, половая доска, фальц кровли,
волна металлочерепицы, ступенчатая оконная рама, плинтус.

Сечения задаются здесь в метрах и сохраняются:
  * assets-source/house-architecture.blend — профили как кривые + образцы погонного метра с материалами;
  * dist/assets/profiles.json — те же полилинии для браузерной сборки архитектуры из плана.
Оси Blender (Z вверх) приводятся к браузерным (Y вверх) экспортёром glTF; профили в JSON — 2D.

Запуск: <python с bpy 4.3> scripts/blender/make_architecture.py
"""
import json
import math
import os

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEX = os.path.join(ROOT, "dist", "assets", "textures")

# s — координата поперёк доски, d — смещение от лицевой плоскости (минус — вглубь).
BOARD_145 = [
    (0.0, -0.0055), (0.0012, -0.0055), (0.0032, -0.0022), (0.0058, -0.0004), (0.0085, 0.0),
    (0.1365, 0.0), (0.1392, -0.0004), (0.1418, -0.0022), (0.1438, -0.0055), (0.145, -0.0055),
]
FLOOR_180 = [
    (0.0, -0.004), (0.0008, -0.004), (0.0012, -0.0009), (0.0019, -0.0002), (0.0026, 0.0),
    (0.1774, 0.0), (0.1781, -0.0002), (0.1788, -0.0009), (0.1792, -0.004), (0.18, -0.004),
]
# Кликфальц: модуль 430 мм, гребень 25 мм по центру и два ребра жёсткости в поле.
SEAM_430 = [
    (0.0, 0.0), (0.095, 0.0), (0.100, 0.0012), (0.105, 0.0), (0.325, 0.0), (0.330, 0.0012), (0.335, 0.0),
    (0.2055, 0.0), (0.2075, 0.002), (0.2085, 0.024), (0.2105, 0.0275), (0.2195, 0.0275), (0.2215, 0.024),
    (0.2225, 0.002), (0.2245, 0.0), (0.43, 0.0),
]
SEAM_430 = sorted(SEAM_430)
# Металлочерепица: поперечная волна (шаг 183 мм, размах 36 мм) и продольный ряд (350 мм, ступень 12 мм).
TILE_WAVE = [(i / 24 * 0.183, 0.018 * (1 - math.cos(2 * math.pi * i / 24)) * (0.5 + 0.5 * (1 - abs(math.sin(math.pi * i / 24)) ** 4))) for i in range(25)]
TILE_ROW = [(0.0, 0.012), (0.012, 0.0), (0.05, 0.0035), (0.30, 0.0105), (0.338, 0.012), (0.35, 0.012)]
# Ступенчатая оконная рама: (w — от наружной кромки коробки к стеклу, d — глубина от наружной плоскости).
WINDOW_FRAME = [
    (0.0, 0.0), (0.0, 0.070), (0.034, 0.070), (0.034, 0.058), (0.046, 0.058), (0.046, 0.050),
    (0.058, 0.050), (0.058, 0.040), (0.072, 0.040), (0.072, 0.026), (0.062, 0.026), (0.062, 0.014),
    (0.040, 0.014), (0.040, 0.006), (0.020, 0.006), (0.020, 0.0),
]
# Плинтус 65 мм: (d — от стены, y — от пола).
BASEBOARD = [(0.0, 0.0), (0.012, 0.0), (0.012, 0.050), (0.0108, 0.056), (0.0085, 0.0605), (0.0052, 0.0635), (0.002, 0.065), (0.0, 0.065)]

PROFILES = {
    "board145": {"points": BOARD_145, "period": 0.145, "axes": ["s", "d"], "note": "имитация бруса, доска 145 мм с фасками и V-стыком"},
    "floor180": {"points": FLOOR_180, "period": 0.18, "axes": ["s", "d"], "note": "половая доска 180 мм, шов ≈1,6 мм"},
    "seam430": {"points": SEAM_430, "period": 0.43, "axes": ["s", "h"], "note": "кликфальц, шаг 430 мм, фальц 25 мм"},
    "tileWave": {"points": TILE_WAVE, "period": 0.183, "axes": ["s", "h"], "note": "металлочерепица, волна 183 мм, размах 36 мм"},
    "tileRow": {"points": TILE_ROW, "period": 0.35, "axes": ["t", "h"], "note": "ряд 350 мм, ступень 12 мм"},
    "windowFrame": {"points": WINDOW_FRAME, "axes": ["w", "d"], "note": "ступенчатая коробка+створка, 72 × 70 мм"},
    "baseboard": {"points": BASEBOARD, "axes": ["d", "y"], "note": "плинтус 12 × 65 мм"},
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def image(name, colorspace):
    path = os.path.join(TEX, name + ".webp")
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    img.pack()
    return img


def pbr_material(name, color, rough, albedo=None, normal=None, roughmap=None, metallic=0.0, normal_strength=0.3):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if albedo:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image(albedo, "sRGB")
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = (*color, 1)
        nt.links.new(t.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    if normal:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image(normal, "Non-Color")
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if roughmap:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image(roughmap, "Non-Color")
        nt.links.new(t.outputs["Color"], b.inputs["Roughness"])
    return m


def profile_curve(name, pts, closed=False, location=(0, 0, 0)):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, (a, b) in zip(sp.points, pts):
        p.co = (a, b, 0, 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    ob.location = location
    bpy.context.scene.collection.objects.link(ob)
    return ob


def extrude_sample(name, pts, period, count, length, mat, location, closed_bottom=-0.02):
    """Погонный образец: профиль, повторённый count раз по s и вытянутый на length по Y (Blender)."""
    import bmesh

    bm = bmesh.new()
    row0, row1 = [], []
    for k in range(count):
        for s, d in pts:
            x = k * period + s
            row0.append(bm.verts.new((x, 0.0, d)))
            row1.append(bm.verts.new((x, length, d)))
    for i in range(len(row0) - 1):
        bm.faces.new((row0[i], row0[i + 1], row1[i + 1], row1[i]))
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = (co.y / 2.4, co.x / 0.6)  # метрический UV: 2,4 м вдоль волокон
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    ob.location = location
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main():
    reset()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    wood = pbr_material("arch_wood_painted", (0.92, 0.92, 0.9), 0.94, "arch_paint_albedo", "arch_normal", "arch_rough", normal_strength=0.2)
    natural = pbr_material("arch_wood_linden", (1, 1, 1), 0.8, "arch_natural_albedo", "arch_normal", "arch_rough")
    floor = pbr_material("floor_oak", (0.77, 0.63, 0.45), 0.82, "floor_albedo", "floor_normal", "floor_rough", normal_strength=0.38)
    metal = pbr_material("roof_metal_graphite", (0.045, 0.047, 0.05), 0.72, None, "metal_normal", "metal_rough", metallic=0.12)
    frame = pbr_material("window_frame_graphite", (0.05, 0.052, 0.055), 0.6)
    base = pbr_material("baseboard_paint", (0.85, 0.83, 0.8), 0.6)

    y = 0.0
    for key, spec in PROFILES.items():
        pts = spec["points"]
        closed = key in ("windowFrame", "baseboard")
        profile_curve(f"profile_{key}", pts, closed=closed, location=(-0.6, y, 0))
        y += 0.25
    extrude_sample("sample_wall_vertical_boards", BOARD_145, 0.145, 6, 1.0, wood, (0, 0, 0))
    extrude_sample("sample_sauna_linden", BOARD_145, 0.145, 6, 1.0, natural, (1.0, 0, 0))
    extrude_sample("sample_floor_oak", FLOOR_180, 0.18, 4, 1.8, floor, (2.0, 0, 0))
    extrude_sample("sample_roof_seam", SEAM_430, 0.43, 3, 1.0, metal, (3.0, 0, 0))
    extrude_sample("sample_roof_tile_wave", TILE_WAVE, 0.183, 6, 1.05, metal, (4.5, 0, 0))
    profile_curve("sample_window_frame", WINDOW_FRAME, closed=True, location=(0, -0.6, 0)).data.extrude = 0.0
    wf = bpy.data.objects["sample_window_frame"]
    wf.data.materials.append(frame)
    bb = profile_curve("sample_baseboard", BASEBOARD, closed=True, location=(0.5, -0.6, 0))
    bb.data.materials.append(base)

    os.makedirs(os.path.join(ROOT, "assets-source"), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets-source", "house-architecture.blend"), compress=True)
    out = {"generator": "scripts/blender/make_architecture.py", "blender": bpy.app.version_string, "units": "m", "profiles": {}}
    for k, v in PROFILES.items():
        out["profiles"][k] = {**v, "points": [[round(a, 6), round(b, 6)] for a, b in v["points"]]}
    with open(os.path.join(ROOT, "dist", "assets", "profiles.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    js = "// Сгенерировано scripts/blender/make_architecture.py — профили архитектуры (м).\nexport default " + json.dumps(out, ensure_ascii=False) + ";\n"
    with open(os.path.join(ROOT, "dist", "data", "profiles.js"), "w", encoding="utf-8") as f:
        f.write(js)
    print("Профили:", ", ".join(PROFILES))


if __name__ == "__main__":
    main()
