"""Подвесной унитаз с инсталляцией (Blender 4.3, bpy).

Модель: керамическая чаша D-образного профиля с реальной толщиной (непрерывная поверхность:
наружная стенка → ободок → внутренняя чаша), отдельные сиденье и крышка, петли, компактное
соединение со стеной, двухрежимная клавиша смыва на высоте 1,08 м, рама инсталляции и бачок в стене.

Габарит в плане 0,40 × 0,65 м (без скрытой инсталляции), низ чаши ≈0,20 м, верх крышки ≈0,47 м.
Оси Blender: X — ширина, −Y — перед (в браузере это локальная +Z), +Y — стена, Z — вверх.
Начало координат — центр габарита на полу.

Запуск: <python с bpy 4.3> scripts/blender/make_wc.py
Результат: assets-source/wall-hung-wc.blend, dist/assets/models/wall-hung-wc.glb
"""
import math
import os

import bpy
import bmesh  # noqa: E402 — модуль доступен после импорта bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WALL_Y = 0.325
N = 48


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough, metallic=0.0, clearcoat=0.0, cc_rough=0.1):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Coat Weight"].default_value = clearcoat
    b.inputs["Coat Roughness"].default_value = cc_rough
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def d_shape(t, half_w, front_y, back_y, n_exp=2.6, corner=0.035):
    """Точка D-образного контура по параметру t∈[0,1): передняя суперэллиптическая дуга и плоская спинка."""
    # Разбиение параметра: 0…0.62 — передняя дуга слева направо, 0.62…1 — плоская спинка справа налево.
    split = 0.62
    cy = back_y - corner - 0.0
    b = cy - front_y
    if t < split:
        th = math.pi + math.pi * (t / split)  # от π (лево) через 3π/2 (перед) к 2π (право)
        c, s = math.cos(th), math.sin(th)
        x = half_w * math.copysign(abs(c) ** (2 / n_exp), c)
        y = cy + b * math.copysign(abs(s) ** (2 / n_exp), s)
        return x, y
    # Спинка: правый скруглённый угол → прямая → левый угол.
    k = (t - split) / (1 - split)
    if k < 0.12:
        a = k / 0.12 * (math.pi / 2)
        return half_w - corner + corner * math.cos(a), cy + corner * math.sin(a)
    if k > 0.88:
        a = math.pi / 2 + (k - 0.88) / 0.12 * (math.pi / 2)
        return -half_w + corner + corner * math.cos(a), cy + corner * math.sin(a)
    x = (half_w - corner) - (k - 0.12) / 0.76 * 2 * (half_w - corner)
    return x, back_y


def ring(bm, z, half_w, front_y, back_y, n_exp=2.6, corner=0.035):
    return [bm.verts.new((*d_shape(i / N, half_w, front_y, back_y, n_exp, corner), z)) for i in range(N)]


def bridge(bm, r0, r1):
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((r0[i], r0[j], r1[j], r1[i]))


def cap(bm, r, flip=False):
    f = bm.faces.new(list(reversed(r)) if flip else r)
    return f


def finish(bm, name, material, subdiv=2, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    bpy.context.scene.collection.objects.link(ob)
    if subdiv:
        mod = ob.modifiers.new("subd", "SUBSURF")
        mod.levels = subdiv
        mod.render_levels = subdiv
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def bowl(ceramic):
    """Непрерывная керамическая оболочка: низ → наружная стенка → ободок → внутренняя чаша → сифон."""
    bm = bmesh.new()
    back = WALL_Y
    # (z, полуширина, перед, спинка) — наружная поверхность снизу вверх.
    outer = [
        (0.200, 0.120, -0.150, back - 0.10),
        (0.212, 0.150, -0.215, back - 0.04),
        (0.240, 0.172, -0.262, back),
        (0.290, 0.184, -0.288, back),
        (0.345, 0.189, -0.298, back),
        (0.392, 0.190, -0.300, back),
        (0.404, 0.186, -0.296, back),
    ]
    inner = [
        (0.406, 0.160, -0.268, back - 0.075),
        (0.398, 0.150, -0.255, back - 0.085),
        (0.360, 0.128, -0.222, back - 0.105),
        (0.320, 0.098, -0.178, back - 0.135),
        (0.285, 0.066, -0.120, back - 0.170),
        (0.268, 0.050, -0.080, back - 0.200),
    ]
    rings = [ring(bm, z, w, f, b) for z, w, f, b in outer] + [ring(bm, z, w, f, b, 2.4, 0.03) for z, w, f, b in inner]
    for a, b in zip(rings, rings[1:]):
        bridge(bm, a, b)
    cap(bm, rings[0], flip=True)  # низ чаши
    cap(bm, rings[-1])  # дно сифона (вода)
    ob = finish(bm, "wc_bowl", ceramic)
    return ob


def wall_block(ceramic):
    """Компактное соединение со стеной: скруглённая пластина за чашей."""
    bm = bmesh.new()
    rs = [ring(bm, z, 0.175, 0.2, WALL_Y, 4.0, 0.03) for z in (0.215, 0.235, 0.385, 0.40)]
    for a, b in zip(rs, rs[1:]):
        bridge(bm, a, b)
    cap(bm, rs[0], flip=True)
    cap(bm, rs[-1])
    return finish(bm, "wc_wall_block", ceramic, subdiv=1)


def seat_and_lid(plastic):
    bm = bmesh.new()
    back = WALL_Y - 0.045
    o0 = ring(bm, 0.408, 0.192, -0.310, back, 2.6, 0.03)
    o1 = ring(bm, 0.426, 0.194, -0.312, back, 2.6, 0.03)
    i1 = ring(bm, 0.426, 0.135, -0.245, back - 0.075, 2.4, 0.03)
    i0 = ring(bm, 0.408, 0.138, -0.250, back - 0.07, 2.4, 0.03)
    bridge(bm, o0, o1)
    bridge(bm, o1, i1)
    bridge(bm, i1, i0)
    bridge(bm, i0, o0)
    seat = finish(bm, "wc_seat", plastic)
    bm = bmesh.new()
    l0 = ring(bm, 0.430, 0.2018, -0.3277, back, 2.6, 0.03)
    l1 = ring(bm, 0.452, 0.20455, -0.3298, back, 2.6, 0.03)
    l2 = ring(bm, 0.466, 0.170, -0.290, back - 0.02, 2.6, 0.03)
    bridge(bm, l0, l1)
    bridge(bm, l1, l2)
    cap(bm, l0, flip=True)
    cap(bm, l2)
    lid = finish(bm, "wc_lid", plastic)
    return seat, lid


def box(name, size, loc, material, bevel=0.0, segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(material)
    if bevel:
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "NONE"
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def cylinder(name, r, depth, loc, rot, material, verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(material)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def main():
    reset()
    ceramic = mat("ceramic_glaze", srgb("#F3F1E9"), 0.26, clearcoat=0.6, cc_rough=0.05)
    plastic = mat("seat_duroplast", srgb("#F6F5F1"), 0.32, clearcoat=0.3, cc_rough=0.12)
    chrome = mat("chrome", (0.9, 0.9, 0.9), 0.14, metallic=1.0)
    plate = mat("flush_plate_white", srgb("#F4F4F2"), 0.18, clearcoat=0.5)
    steel = mat("installation_steel", (0.55, 0.57, 0.6), 0.45, metallic=0.85)
    tank = mat("installation_cistern", srgb("#6E8FA8"), 0.55)

    bowl(ceramic)
    wall_block(ceramic)
    seat_and_lid(plastic)
    for sx in (-0.11, 0.11):
        cylinder(f"wc_hinge_{'l' if sx < 0 else 'r'}", 0.011, 0.04, (sx, WALL_Y - 0.055, 0.432), (0, math.pi / 2, 0), chrome)
    # Двухрежимная клавиша смыва: рамка, большая и малая кнопки (центр 1,08 м).
    box("flush_frame", (0.246, 0.008, 0.164), (0, WALL_Y - 0.004, 1.08), chrome, bevel=0.003)
    box("flush_big", (0.132, 0.006, 0.146), (-0.047, WALL_Y - 0.009, 1.08), plate, bevel=0.004)
    box("flush_small", (0.080, 0.006, 0.146), (0.071, WALL_Y - 0.009, 1.08), plate, bevel=0.004)
    # Инсталляция внутри стены (за плоскостью грани, y > WALL_Y).
    inst = bpy.data.collections.new("installation")
    bpy.context.scene.collection.children.link(inst)
    parts = [
        box("installation_post_l", (0.04, 0.05, 1.12), (-0.21, WALL_Y + 0.05, 0.56), steel),
        box("installation_post_r", (0.04, 0.05, 1.12), (0.21, WALL_Y + 0.05, 0.56), steel),
        box("installation_rail", (0.46, 0.04, 0.04), (0, WALL_Y + 0.05, 0.25), steel),
        box("installation_cistern", (0.38, 0.08, 0.52), (0, WALL_Y + 0.055, 0.98), tank, bevel=0.01),
        cylinder("installation_pipe", 0.045, 0.6, (0, WALL_Y + 0.05, 0.52), (0, 0, 0), steel),
    ]
    for p in parts:
        for c in p.users_collection:
            c.objects.unlink(p)
        inst.objects.link(p)
    os.makedirs(os.path.join(ROOT, "assets-source"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "dist", "assets", "models"), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets-source", "wall-hung-wc.blend"), compress=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(ROOT, "dist", "assets", "models", "wall-hung-wc.glb"),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
    )
    # Контроль габаритов видимой части (без инсталляции): мировые вершины после модификаторов.
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or ob.name.startswith("installation"):
            continue
        ev = ob.evaluated_get(dg)
        for v in ev.to_mesh().vertices:
            w = ob.matrix_world @ v.co
            xs.append(w.x)
            ys.append(w.y)
            zs.append(w.z)
    print("Габарит X: %.4f, Y: %.4f, низ %.3f, верх крышки %.3f" % (max(xs) - min(xs), max(ys) - min(ys), min(zs), max(z for z in zs if z < 0.6)))


if __name__ == "__main__":
    main()
