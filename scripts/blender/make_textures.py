"""Изготовление PBR-карт в Blender 4.3 (bpy): бесшовные альбедо / нормали / шероховатость.

Бесшовность обеспечивается периодическим процедурным шумом (спектральный синтез на торе),
поэтому любая карта повторяется без швов. Хвоя рендерится Cycles из объёмных иголок.
Газон опирается на цвета лужайки с фотографии фасада владельца (references/facade-photo-1.webp).

Запуск: <python с модулем bpy 4.3> scripts/blender/make_textures.py
Результат: dist/assets/textures/*.webp и dist/assets/textures/manifest.json
"""
import json
import math
import os
import sys

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "dist", "assets", "textures")
os.makedirs(OUT, exist_ok=True)
MANIFEST = {}


# ---------- периодический шум ----------
def fnoise(n, seed, beta=2.0, fmin=1.0, fmax=None, aniso=(1.0, 1.0)):
    """Периодический фрактальный шум n×n (строки — v, столбцы — u), нормирован к [-1, 1]."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((n, n))
    fu = np.fft.fftfreq(n) * n
    fv = np.fft.fftfreq(n) * n
    FV, FU = np.meshgrid(fv, fu, indexing="ij")
    f = np.sqrt((FU * aniso[0]) ** 2 + (FV * aniso[1]) ** 2)
    f[0, 0] = 1.0
    amp = 1.0 / f ** (beta / 2.0)
    amp[f < fmin] = 0.0
    if fmax is not None:
        amp[f > fmax] = 0.0
    amp[0, 0] = 0.0
    field = np.real(np.fft.ifft2(np.fft.fft2(white) * amp))
    field -= field.mean()
    m = np.abs(field).max()
    return field / (m if m > 0 else 1.0)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def grid(n):
    v, u = np.meshgrid(np.arange(n) / n, np.arange(n) / n, indexing="ij")
    return u, v


def normal_from_height(h, strength):
    """Касательные нормали OpenGL (Y вверх). Строка 0 — верх изображения (+v)."""
    du = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dv = -(np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -du * strength
    ny = -dv * strength
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], axis=-1)


def worley_periodic(n, cells, seed, jitter=1.0, stretch=(1.0, 1.0)):
    """F1/F2 периодического клеточного шума (для коры, терраццо, травертина)."""
    rng = np.random.default_rng(seed)
    cu, cv = cells
    pts = []
    for i in range(cv):
        for j in range(cu):
            pts.append(((j + 0.5 + (rng.random() - 0.5) * jitter) / cu, (i + 0.5 + (rng.random() - 0.5) * jitter) / cv))
    pts = np.array(pts)
    u, v = grid(n)
    f1 = np.full((n, n), 9.0)
    f2 = np.full((n, n), 9.0)
    ids = np.zeros((n, n), dtype=np.int32)
    for k, (pu, pv) in enumerate(pts):
        du = np.abs(u - pu)
        du = np.minimum(du, 1 - du) * stretch[0]
        dv = np.abs(v - pv)
        dv = np.minimum(dv, 1 - dv) * stretch[1]
        d = np.sqrt(du * du + dv * dv)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        ids = np.where(closer, k, ids)
        f1 = np.where(closer, d, f1)
    return f1, f2, ids, len(pts)


# ---------- запись через Blender ----------
def save(name, arr, kind, quality=90, meta=None):
    """arr: (n, n, 3|4) в [0,1]; kind: color|data. Пишем сырые значения (Non-Color), строки снизу вверх."""
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], axis=2)
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.ascontiguousarray(np.clip(arr[::-1], 0, 1).astype(np.float32)).ravel())
    path = os.path.join(OUT, name + ".webp")
    img.filepath_raw = path
    img.file_format = "WEBP"
    img.save(quality=quality)
    bpy.data.images.remove(img)
    MANIFEST[name] = {"file": name + ".webp", "size": w, "kind": kind, **(meta or {})}
    print("  ", name, os.path.getsize(path) // 1024, "KB")


def gray3(x):
    return np.repeat(x[..., None], 3, axis=2)


# ---------- древесина ----------
def periodic_1d(n, seed, beta, fmax):
    """Периодическая 1D-функция по v (одинакова во всех столбцах)."""
    rng = np.random.default_rng(seed)
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.arange(spec.size, dtype=float)
    f[0] = 1
    amp = 1 / f ** (beta / 2)
    amp[0] = 0
    amp[fmax:] = 0
    line = np.fft.irfft(spec * amp, n)
    line /= np.abs(line).max()
    return np.repeat(line[:, None], n, axis=1)


def wood_maps(n, seed, rings, ring_sharp, pores, rays, fibers):
    u, v = grid(n)
    # Неравномерный шаг годичных слоёв: фаза = rings·v + медленная 1D-добавка + слабый изгиб.
    spacing = periodic_1d(n, seed + 10, 1.6, 40) * 2.2
    warp = fnoise(n, seed, beta=3.4, fmin=1, fmax=16, aniso=(7.0, 1.0)) * 0.010
    warp2 = fnoise(n, seed + 1, beta=2.4, fmin=2, fmax=60, aniso=(12.0, 1.0)) * 0.0025
    phase = rings * (v + warp + warp2) + spacing
    ring = 0.5 + 0.5 * np.sin(2 * np.pi * phase)
    late = smoothstep(1 - ring_sharp, 1.0, ring) * (0.55 + 0.45 * (periodic_1d(n, seed + 11, 1.0, 120) * 0.5 + 0.5))
    fib = fnoise(n, seed + 2, beta=1.1, fmin=6, fmax=n // 2, aniso=(32.0, 1.0))
    fib = smoothstep(-0.3, 0.9, fib)
    blot = fnoise(n, seed + 3, beta=3.0, fmin=1, fmax=10, aniso=(3.0, 1.0))
    pore = np.zeros((n, n))
    if pores:
        p = fnoise(n, seed + 4, beta=0.3, fmin=n // 8, fmax=n // 2, aniso=(7.0, 1.0))
        pore = smoothstep(0.5, 0.78, p) * (0.35 + 0.65 * late)
    ray = np.zeros((n, n))
    if rays:
        r = fnoise(n, seed + 5, beta=0.8, fmin=n // 16, fmax=n // 3, aniso=(1.0, 12.0))
        ray = smoothstep(0.7, 0.92, r)
    tone = 0.80 - 0.16 * late - fibers * 0.06 * fib + 0.06 * blot - 0.14 * pore + 0.04 * ray
    height = 0.5 * late + 0.3 * fib * fibers - 0.6 * pore + 0.08 * blot
    rough = 0.80 + 0.07 * late - 0.04 * ray + 0.04 * fib
    return tone, height, rough


def make_woods():
    print("Древесина")
    n = 1024
    # Архитектурная доска (имитация бруса): тайл 2,4 × 0,6 м, мелкий рисунок ели.
    tone, height, rough = wood_maps(n, 7101, rings=46, ring_sharp=0.28, pores=False, rays=False, fibers=1.0)
    paint = 0.93 + 0.07 * (tone - tone.mean()) / (tone.std() * 3)  # окраска поверх дерева: рисунок едва виден
    save("arch_paint_albedo", gray3(np.clip(paint, 0, 1)), "color", meta={"tile": [2.4, 0.6], "mean": float(paint.mean())})
    natural = 0.86 + 0.6 * (tone - tone.mean())
    save("arch_natural_albedo", np.stack([natural * 1.0, natural * 0.92, natural * 0.78], -1), "color", meta={"tile": [2.4, 0.6], "mean": float(natural.mean())})
    save("arch_normal", normal_from_height(height, 6.0), "data", meta={"tile": [2.4, 0.6]})
    save("arch_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [2.4, 0.6]})
    # Половая доска дуба: тайл 1,8 × 0,72 м (4 доски по 180 мм получают разные смещения).
    tone, height, rough = wood_maps(n, 7202, rings=34, ring_sharp=0.35, pores=True, rays=True, fibers=1.0)
    save("floor_albedo", gray3(np.clip(tone / tone.mean() * 0.8, 0, 1)), "color", meta={"tile": [1.8, 0.72], "mean": 0.8})
    save("floor_normal", normal_from_height(height, 7.0), "data", meta={"tile": [1.8, 0.72]})
    save("floor_rough", gray3(np.clip(rough - 0.02, 0, 1)), "data", meta={"tile": [1.8, 0.72]})
    # Древесина мебели: тайл 1,6 × 0,4 м.
    n2 = 512
    tone, height, rough = wood_maps(n2, 7303, rings=22, ring_sharp=0.3, pores=True, rays=False, fibers=0.8)
    save("furniture_albedo", gray3(np.clip(tone / tone.mean() * 0.8, 0, 1)), "color", meta={"tile": [1.6, 0.4], "mean": 0.8})
    save("furniture_normal", normal_from_height(height, 4.0), "data", meta={"tile": [1.6, 0.4]})


# ---------- ткань ----------
def make_fabric():
    print("Ткань")
    n = 512
    u, v = grid(n)
    threads = 96  # нитей на тайл 0,24 м → 2,5 мм
    wu = 0.5 + 0.5 * np.sin(2 * np.pi * u * threads)
    wv = 0.5 + 0.5 * np.sin(2 * np.pi * v * threads)
    checker = np.sign(np.sin(np.pi * u * threads)) * np.sign(np.sin(np.pi * v * threads))
    weave = np.where(checker > 0, wu, wv)
    slub = fnoise(n, 8101, beta=1.6, fmin=2, fmax=80, aniso=(1.0, 8.0)) * 0.5 + fnoise(n, 8102, beta=1.6, fmin=2, fmax=80, aniso=(8.0, 1.0)) * 0.5
    loops = smoothstep(0.2, 0.9, fnoise(n, 8103, beta=0.6, fmin=24, fmax=140))
    height = 0.6 * weave + 0.25 * slub + 0.35 * loops
    tone = 0.84 + 0.06 * slub + 0.05 * weave - 0.06 * loops
    save("fabric_albedo", gray3(np.clip(tone, 0, 1)), "color", meta={"tile": [0.24, 0.24], "mean": float(tone.mean())})
    save("fabric_normal", normal_from_height(height, 5.0), "data", meta={"tile": [0.24, 0.24]})


# ---------- камень ----------
def make_stones():
    print("Камень")
    n = 512
    u, v = grid(n)
    # Терраццо: светлая матрица с угловатой крошкой (ячейки Вороного).
    f1, f2, ids, k = worley_periodic(n, (34, 34), 9101, jitter=1.0)
    rng = np.random.default_rng(9102)
    chip_sel = rng.random(k) < 0.7
    chip_tone = rng.choice([1.08, 1.02, 0.96, 0.82, 0.62, 0.45], size=k, p=[0.25, 0.25, 0.2, 0.15, 0.1, 0.05])
    inner = smoothstep(0.004, 0.009, f2 - f1)
    is_chip = chip_sel[ids] * inner
    matrix = 0.9 + 0.04 * fnoise(n, 9103, beta=2.0, fmin=2, fmax=60) + 0.03 * fnoise(n, 9105, beta=0.5, fmin=60, fmax=250)
    tone = matrix * (1 - is_chip) + is_chip * chip_tone[ids] * 0.9
    height = 0.15 * is_chip + 0.05 * fnoise(n, 9104, beta=1.0, fmin=40, fmax=200)
    save("terrazzo_albedo", gray3(np.clip(tone, 0, 1)), "color", meta={"tile": [0.6, 0.6], "mean": float(tone.mean())})
    save("terrazzo_normal", normal_from_height(height, 2.0), "data", meta={"tile": [0.6, 0.6]})
    # Травертин: слоистые полосы и поры.
    band = fnoise(n, 9201, beta=3.0, fmin=1, fmax=40, aniso=(8.0, 1.0))
    pores = smoothstep(0.55, 0.85, fnoise(n, 9202, beta=0.8, fmin=20, fmax=160, aniso=(3.0, 1.0)))
    tone = 0.86 + 0.08 * band - 0.22 * pores
    height = -0.6 * pores + 0.1 * band
    save("travertine_albedo", gray3(np.clip(tone, 0, 1)), "color", meta={"tile": [0.6, 0.6], "mean": float(tone.mean())})
    save("travertine_normal", normal_from_height(height, 3.0), "data", meta={"tile": [0.6, 0.6]})
    # Сланец: колотые слои.
    layers = fnoise(n, 9301, beta=2.6, fmin=1, fmax=60, aniso=(1.0, 4.0))
    cleft = fnoise(n, 9302, beta=1.8, fmin=3, fmax=120)
    tone = 0.82 + 0.1 * layers + 0.06 * cleft
    height = 0.5 * layers + 0.4 * cleft
    save("slate_albedo", gray3(np.clip(tone, 0, 1)), "color", meta={"tile": [0.6, 0.6], "mean": float(tone.mean())})
    save("slate_normal", normal_from_height(height, 4.0), "data", meta={"tile": [0.6, 0.6]})
    rough = 0.55 + 0.25 * smoothstep(-0.4, 0.6, cleft)
    save("stone_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [0.6, 0.6]})


# ---------- окрашенный металл ----------
def make_metal():
    print("Окрашенный металл")
    n = 512
    peel = fnoise(n, 10101, beta=1.4, fmin=12, fmax=140)
    streak = fnoise(n, 10102, beta=2.0, fmin=1, fmax=30, aniso=(1.0, 14.0))
    save("metal_normal", normal_from_height(0.6 * peel + 0.2 * streak, 1.6), "data", meta={"tile": [0.5, 0.5]})
    rough = 0.70 + 0.05 * peel + 0.04 * streak
    save("metal_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [0.5, 0.5]})


# ---------- кора сосны ----------
def make_bark():
    print("Кора")
    n = 512
    f1, f2, ids, k = worley_periodic(n, (6, 14), 11101, jitter=0.9, stretch=(1.0, 0.32))
    crack = smoothstep(0.0, 0.03, f2 - f1) * (0.75 + 0.25 * smoothstep(-0.5, 0.5, fnoise(n, 11104, beta=1.2, fmin=10, fmax=120)))
    rng = np.random.default_rng(11102)
    plate = rng.uniform(0.75, 1.05, k)[ids]
    det = fnoise(n, 11103, beta=1.4, fmin=8, fmax=200, aniso=(1.0, 3.0))
    tone = (0.25 + 0.55 * crack * plate) * (0.9 + 0.1 * det)
    rgb = np.stack([tone * 0.62, tone * 0.40, tone * 0.29], -1)
    save("bark_albedo", rgb, "color", meta={"tile": [0.6, 1.2]})
    save("bark_normal", normal_from_height(1.2 * crack + 0.3 * det, 6.0), "data", meta={"tile": [0.6, 1.2]})


# ---------- газон по фотографии владельца ----------
def make_grass():
    print("Газон")
    photo = bpy.data.images.load(os.path.join(ROOT, "references", "facade-photo-1.webp"))
    w, h = photo.size
    px = np.array(photo.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, :3]
    bpy.data.images.remove(photo)
    # Квадратные участки травы перед домом (без дорожек и светильников).
    patches = [px[392:440, 560:608], px[396:444, 640:688], px[392:440, 1060:1108], px[400:448, 860:908]]
    sample = np.concatenate([p.reshape(-1, 3) for p in patches])
    lum = sample.mean(1)
    qs = [np.quantile(lum, q) for q in (0.1, 0.5, 0.9)]
    pal = [sample[np.abs(lum - q) < 0.03].mean(0) for q in qs]
    n = 512
    rng = np.random.default_rng(12101)
    height = np.zeros((n, n))
    shade = np.zeros((n, n))
    # Травинки: короткие штрихи с разной ориентацией, периодическая укладка.
    for _ in range(26000):
        x0, y0 = rng.uniform(0, n, 2)
        ang = rng.normal(-np.pi / 2, 0.55)
        length = rng.uniform(5, 15)
        tone = rng.uniform(0, 1)
        for t in np.linspace(0, 1, int(length)):
            xi = int(x0 + np.cos(ang) * length * t) % n
            yi = int(y0 + np.sin(ang) * length * t) % n
            height[yi, xi] = max(height[yi, xi], t * 0.6 + 0.4)
            shade[yi, xi] = tone
    low = fnoise(n, 12102, beta=2.6, fmin=1, fmax=12)
    height = height + 0.15 * fnoise(n, 12103, beta=1.0, fmin=40, fmax=250)
    t = np.clip(shade * 0.7 + 0.3 * (low * 0.5 + 0.5), 0, 1)
    c_lo, c_mid, c_hi = (np.array(c) for c in pal)
    rgb = np.where(t[..., None] < 0.5, c_lo + (c_mid - c_lo) * (t[..., None] * 2), c_mid + (c_hi - c_mid) * (t[..., None] * 2 - 1))
    gaps = height < 0.05
    rgb = np.where(gaps[..., None], c_lo * 0.7, rgb)
    save("grass_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [1.2, 1.2], "palette": [list(map(float, c)) for c in pal]})
    save("grass_normal", normal_from_height(height, 3.0), "data", meta={"tile": [1.2, 1.2]})


# ---------- хвоя: рендер Cycles из объёмных иголок ----------
def make_needles():
    print("Хвоя (Cycles)")
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    rng = np.random.default_rng(13101)
    needle_mat = bpy.data.materials.new("needle")
    needle_mat.use_nodes = True
    bsdf = needle_mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.11, 0.2, 0.07, 1)
    bsdf.inputs["Roughness"].default_value = 0.55
    stem_mat = bpy.data.materials.new("stem")
    stem_mat.use_nodes = True
    stem_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.22, 0.13, 0.07, 1)
    import bmesh

    bm = bmesh.new()
    stems = bmesh.new()

    def add_cone(bmx, p0, p1, r0, r1, seg=5):
        d = np.array(p1) - np.array(p0)
        L = np.linalg.norm(d)
        d = d / L
        a = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
        b1 = np.cross(d, a)
        b1 /= np.linalg.norm(b1)
        b2 = np.cross(d, b1)
        ring0, ring1 = [], []
        for i in range(seg):
            ang = 2 * np.pi * i / seg
            off = np.cos(ang) * b1 + np.sin(ang) * b2
            ring0.append(bmx.verts.new(tuple(np.array(p0) + off * r0)))
            ring1.append(bmx.verts.new(tuple(np.array(p1) + off * r1)))
        for i in range(seg):
            j = (i + 1) % seg
            bmx.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))

    # Веер из семи веточек (карточка 0,40 м): пары иголок 5–8 см, густое опушение к концу побега.
    for twig in range(7):
        base = np.array([0.0, -0.19, 0.0])
        ang = (twig - 3) * 0.24 + rng.normal(0, 0.04)
        direction = np.array([np.sin(ang), np.cos(ang), 0.0])
        length = 0.30 + rng.uniform(-0.04, 0.03) - abs(twig - 3) * 0.02
        tip = base + direction * length
        add_cone(stems, tuple(base), tuple(tip), 0.0032, 0.0015, 6)
        steps = 90
        for s in range(steps):
            t = 0.18 + 0.82 * s / steps
            p = base + direction * length * t
            for pair in range(3):
                around = rng.uniform(0, 2 * np.pi)
                lean = rng.uniform(0.6, 1.05)
                side = np.array([np.cos(around) * direction[1], -np.cos(around) * direction[0], np.sin(around)])
                nd = direction * np.cos(lean) + side * np.sin(lean)
                nd /= np.linalg.norm(nd)
                nl = rng.uniform(0.05, 0.08) * (0.75 + 0.25 * (1 - t))
                add_cone(bm, tuple(p), tuple(p + nd * nl), 0.0013, 0.0003, 4)
    me = bpy.data.meshes.new("needles")
    bm.to_mesh(me)
    ob = bpy.data.objects.new("needles", me)
    ob.data.materials.append(needle_mat)
    scene.collection.objects.link(ob)
    me2 = bpy.data.meshes.new("stems")
    stems.to_mesh(me2)
    ob2 = bpy.data.objects.new("stems", me2)
    ob2.data.materials.append(stem_mat)
    scene.collection.objects.link(ob2)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.4
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, 0, 2)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (0.5, 0.3, 0.2)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.65, 0.7, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.render.film_transparent = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    tmp = os.path.join(OUT, "_needles.png")
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(512, 512, 4)[::-1]
    bpy.data.images.remove(img)
    os.remove(tmp)
    # Альфа с заливкой цвета за краями (без тёмной каймы при фильтрации).
    rgb = arr[..., :3]
    a = arr[..., 3:4]
    mean = (rgb * a).sum((0, 1)) / max(a.sum(), 1e-6)
    rgb = np.where(a > 0.02, rgb / np.maximum(a, 1e-3), mean)
    save("needles_rgba", np.concatenate([np.clip(rgb, 0, 1), a], -1), "color", quality=92, meta={"alpha": True, "card": [0.4, 0.4]})


# ---------- листва кустов: рендер Cycles из объёмных листочков (самшит) ----------
def make_leaves():
    print("Листва (Cycles)")
    import bmesh

    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    rng = np.random.default_rng(14101)
    leaf_mat = bpy.data.materials.new("leaf")
    leaf_mat.use_nodes = True
    lb = leaf_mat.node_tree.nodes["Principled BSDF"]
    lb.inputs["Base Color"].default_value = (0.07, 0.16, 0.05, 1)
    lb.inputs["Roughness"].default_value = 0.38
    twig_mat = bpy.data.materials.new("twig")
    twig_mat.use_nodes = True
    twig_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.07, 0.04, 1)
    bm = bmesh.new()
    tw = bmesh.new()
    col = bm.loops.layers.color.new("tone")

    def leaf(center, direction, normal, length, width, tone):
        d = np.array(direction) / np.linalg.norm(direction)
        n = np.array(normal) / np.linalg.norm(normal)
        side = np.cross(n, d)
        side /= np.linalg.norm(side)
        pts = []
        for i in range(9):
            t = i / 8
            w = math.sin(math.pi * t) ** 0.8 * width
            cup = (t - 0.5) ** 2 * 0.15 * length
            pts.append((t, w, cup))
        verts = []
        for t, w, cup in pts:
            base = np.array(center) + d * (t - 0.5) * length - n * cup
            verts.append(bm.verts.new(tuple(base + side * w)))
        for t, w, cup in reversed(pts[1:-1]):
            base = np.array(center) + d * (t - 0.5) * length - n * cup
            verts.append(bm.verts.new(tuple(base - side * w)))
        f = bm.faces.new(verts)
        for loop in f.loops:
            loop[col] = (tone, tone * (0.95 + 0.1 * rng.random()), tone * 0.85, 1.0)

    def stick(p0, p1, r):
        d = np.array(p1) - np.array(p0)
        L = np.linalg.norm(d)
        d = d / L
        a = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
        b1 = np.cross(d, a)
        b1 /= np.linalg.norm(b1)
        b2 = np.cross(d, b1)
        r0, r1 = [], []
        for i in range(5):
            ang = 2 * math.pi * i / 5
            off = math.cos(ang) * b1 + math.sin(ang) * b2
            r0.append(tw.verts.new(tuple(np.array(p0) + off * r)))
            r1.append(tw.verts.new(tuple(np.array(p1) + off * r * 0.5)))
        for i in range(5):
            j = (i + 1) % 5
            tw.faces.new((r0[i], r0[j], r1[j], r1[i]))

    # Карточка 0,30 м: плотный веер ветвящихся побегов, мутовки по 3–4 листа 12–22 мм.
    def shoot_from(base, direction, length, depth):
        stick(tuple(base), tuple(base + direction * length), 0.0011 if depth else 0.0015)
        nodes = int(length / 0.008)
        for k in range(nodes):
            t = 0.08 + 0.92 * k / nodes
            p = base + direction * length * t
            for j in range(3 + (k % 2)):
                around = 2 * math.pi * j / 3.5 + k * 0.9 + rng.uniform(-0.3, 0.3)
                perp1 = np.cross(direction, np.array([0, 0, 1.0]))
                perp1 /= np.linalg.norm(perp1)
                perp2 = np.cross(direction, perp1)
                side = perp1 * math.cos(around) + perp2 * math.sin(around)
                ld = direction * 0.45 + side * 0.9
                normal = side * 0.3 + np.array([0, 0, 1.0])
                size = rng.uniform(0.012, 0.022) * (1.15 - 0.35 * t)
                c = p + ld / np.linalg.norm(ld) * size * 0.5
                leaf(tuple(c), tuple(ld), tuple(normal), size, size * 0.36, rng.uniform(0.7, 1.2))
            if depth == 0 and k % 5 == 3:
                bd = direction + np.array([rng.normal(0, 0.6), rng.normal(0, 0.2), rng.normal(0, 0.3)])
                bd /= np.linalg.norm(bd)
                shoot_from(p, bd, length * (1 - t) * 0.7, 1)

    for shoot in range(19):
        base = np.array([rng.normal(0, 0.025), -0.15, rng.normal(0, 0.01)])
        ang = (shoot - 9) * 0.12 + rng.normal(0, 0.06)
        direction = np.array([math.sin(ang), math.cos(ang), rng.normal(0, 0.15)])
        direction /= np.linalg.norm(direction)
        length = 0.2 + rng.uniform(0, 0.09) - abs(shoot - 9) * 0.006
        shoot_from(base, direction, length, 0)
    me = bpy.data.meshes.new("leaves")
    bm.to_mesh(me)
    ob = bpy.data.objects.new("leaves", me)
    ob.data.materials.append(leaf_mat)
    attr = leaf_mat.node_tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "tone"
    mul = leaf_mat.node_tree.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    mul.inputs[6].default_value = (0.07, 0.16, 0.05, 1)
    leaf_mat.node_tree.links.new(attr.outputs["Color"], mul.inputs[7])
    leaf_mat.node_tree.links.new(mul.outputs[2], lb.inputs["Base Color"])
    scene.collection.objects.link(ob)
    me2 = bpy.data.meshes.new("twigs")
    tw.to_mesh(me2)
    ob2 = bpy.data.objects.new("twigs", me2)
    ob2.data.materials.append(twig_mat)
    scene.collection.objects.link(ob2)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.3
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, 0, 2)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (0.45, 0.35, 0.2)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.65, 0.7, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.render.film_transparent = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    tmp = os.path.join(OUT, "_leaves.png")
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(512, 512, 4)[::-1]
    bpy.data.images.remove(img)
    os.remove(tmp)
    rgb = arr[..., :3]
    a = arr[..., 3:4]
    mean = (rgb * a).sum((0, 1)) / max(a.sum(), 1e-6)
    rgb = np.where(a > 0.02, rgb / np.maximum(a, 1e-3), mean)
    save("leaves_rgba", np.concatenate([np.clip(rgb, 0, 1), a], -1), "color", quality=92, meta={"alpha": True, "card": [0.3, 0.3]})


# ---------- лесная подстилка: опавшая хвоя, мох, мелкие шишки ----------
def make_forest_floor():
    print("Лесная подстилка")
    n = 512
    rng = np.random.default_rng(15101)
    height = np.zeros((n, n))
    rgb = np.zeros((n, n, 3))
    moss = smoothstep(0.1, 0.55, fnoise(n, 15102, beta=2.8, fmin=1, fmax=10))
    soil = 0.5 + 0.5 * fnoise(n, 15103, beta=1.6, fmin=4, fmax=120)
    base = np.stack([0.20 + 0.06 * soil, 0.15 + 0.04 * soil, 0.09 + 0.03 * soil], -1)
    mossc = np.stack([0.17 + 0.05 * soil, 0.23 + 0.06 * soil, 0.08 + 0.02 * soil], -1)
    rgb[:] = base * (1 - moss[..., None]) + mossc * moss[..., None]
    height += 0.3 * moss + 0.1 * soil
    # Опавшая хвоя: тонкие короткие штрихи рыже-коричневых и серых оттенков.
    for _ in range(14000):
        x0, y0 = rng.uniform(0, n, 2)
        ang = rng.uniform(0, math.pi)
        length = rng.uniform(10, 22)
        tone = rng.uniform(0, 1)
        c = np.array([0.40, 0.24, 0.11]) * (0.6 + 0.5 * tone) if tone < 0.8 else np.array([0.27, 0.24, 0.19]) * (0.8 + 0.3 * tone)
        lift = rng.uniform(0.4, 1.0)
        for t in np.linspace(0, 1, int(length)):
            xi = int(x0 + math.cos(ang) * length * t) % n
            yi = int(y0 + math.sin(ang) * length * t) % n
            if moss[yi, xi] > 0.75 and rng.random() < 0.7:
                continue
            rgb[yi, xi] = c
            height[yi, xi] = max(height[yi, xi], 0.5 + 0.5 * lift)
    # Мелкие шишки.
    for _ in range(7):
        cx, cy = rng.uniform(0, n, 2)
        r = rng.uniform(6, 9)
        u, v = grid(n)
        du = np.minimum(np.abs(u * n - cx), n - np.abs(u * n - cx))
        dv = np.minimum(np.abs(v * n - cy), n - np.abs(v * n - cy))
        d = np.sqrt((du / 1.6) ** 2 + dv ** 2)
        m = d < r
        rgb[m] = np.array([0.30, 0.19, 0.10]) * (0.8 + 0.4 * (1 - d[m] / r))[..., None]
        height[m] = np.maximum(height[m], 1.2 * (1 - (d[m] / r) ** 2))
    save("forest_floor_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [2.0, 2.0]})
    save("forest_floor_normal", normal_from_height(height, 2.5), "data", meta={"tile": [2.0, 2.0]})


# ---------- дорожки и мангальная зона ----------
def make_gravel():
    """Гранитный гравий 5–20 мм (тайл 0,8 м): два слоя окатанных зёрен, тени в зазорах, пёстрые тона."""
    print("Гравий")
    n = 1024
    height = np.full((n, n), -0.4)
    rgb = np.zeros((n, n, 3))
    palette = np.array([[0.66, 0.64, 0.61], [0.58, 0.56, 0.53], [0.74, 0.70, 0.64], [0.50, 0.48, 0.46],
                        [0.70, 0.61, 0.55], [0.44, 0.43, 0.42], [0.80, 0.78, 0.74], [0.63, 0.57, 0.50]])
    for layer, (cells, seed, lift) in enumerate([((44, 44), 16101, 0.0), ((64, 64), 16102, -0.12), ((30, 30), 16103, 0.08)]):
        f1, f2, ids, k = worley_periodic(n, cells, seed, jitter=1.0)
        rng = np.random.default_rng(seed + 50)
        size = 1.0 / cells[0]
        # Купол зерна: высота от расстояния до центра, край — по разности F2 − F1.
        r = rng.uniform(0.32, 0.5, k)[ids] * size
        dome = np.sqrt(np.clip(1 - (f1 / r) ** 2, 0, 1))
        edge = smoothstep(0.0, size * 0.08, f2 - f1)
        h = (dome * edge) * rng.uniform(0.7, 1.1, k)[ids] + lift
        present = rng.random(k)[ids] < (1.0 if layer == 0 else 0.55)
        h = np.where(present & (dome > 0), h, -1.0)
        tone = palette[rng.integers(0, len(palette), k)][ids] * rng.uniform(0.85, 1.12, k)[ids][..., None]
        speck = 0.9 + 0.2 * fnoise(n, seed + 7, beta=0.4, fmin=n // 6, fmax=n // 2)
        tone = tone * speck[..., None] * (0.82 + 0.18 * dome[..., None])
        top = h > height
        rgb = np.where(top[..., None], tone, rgb)
        height = np.maximum(height, h)
    # Зазоры: тёмная пыль и мелкая крошка.
    gap = height < 0
    fines = 0.40 + 0.08 * fnoise(n, 16110, beta=0.6, fmin=60, fmax=n // 2)
    rgb[gap] = np.stack([fines * 1.0, fines * 0.97, fines * 0.92], -1)[gap]
    ao = smoothstep(-0.4, 0.5, height)
    rgb = rgb * (0.72 + 0.28 * ao[..., None])
    save("gravel_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [0.8, 0.8], "mean": float(rgb.mean())})
    save("gravel_normal", normal_from_height(np.maximum(height, -0.4), 7.0), "data", meta={"tile": [0.8, 0.8]})
    rough = 0.62 + 0.3 * (1 - ao) + 0.06 * fnoise(n, 16111, beta=1.0, fmin=10, fmax=200)
    save("gravel_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [0.8, 0.8]})


def make_flagstone():
    """Природный плитняк (песчаник): слоистость, железистые пятна, сколы, лишайник (тайл 1,0 м)."""
    print("Плитняк")
    n = 1024
    strata = fnoise(n, 17101, beta=2.8, fmin=1, fmax=50, aniso=(1.0, 5.0))
    cleft = fnoise(n, 17102, beta=1.7, fmin=3, fmax=220)
    grain = fnoise(n, 17103, beta=0.3, fmin=n // 5, fmax=n // 2)
    rust = smoothstep(0.1, 0.7, fnoise(n, 17104, beta=3.0, fmin=1, fmax=14))
    lichen = smoothstep(0.62, 0.8, fnoise(n, 17105, beta=1.4, fmin=6, fmax=90)) * smoothstep(-0.2, 0.4, fnoise(n, 17106, beta=3.0, fmin=1, fmax=8))
    tone = 0.74 + 0.07 * strata + 0.05 * cleft + 0.04 * grain
    base = np.stack([tone * 1.0, tone * 0.93, tone * 0.82], -1)
    warm = np.stack([tone * 0.96, tone * 0.78, tone * 0.58], -1)
    rgb = base * (1 - rust[..., None] * 0.55) + warm * rust[..., None] * 0.55
    lich = np.array([0.72, 0.74, 0.62])
    rgb = rgb * (1 - lichen[..., None] * 0.7) + lich * lichen[..., None] * 0.7
    pits = smoothstep(0.7, 0.9, fnoise(n, 17107, beta=0.8, fmin=30, fmax=300))
    rgb = rgb * (1 - 0.25 * pits[..., None])
    height = 0.6 * strata + 0.5 * cleft + 0.12 * grain - 0.4 * pits + 0.15 * lichen
    save("flagstone_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [1.0, 1.0], "mean": float(rgb.mean())})
    save("flagstone_normal", normal_from_height(height, 5.0), "data", meta={"tile": [1.0, 1.0]})
    rough = 0.78 + 0.12 * smoothstep(-0.5, 0.5, cleft) - 0.1 * lichen
    save("flagstone_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [1.0, 1.0]})


def make_endgrain():
    """Торец полена: годичные кольца, тёмное ядро, радиальные трещины, кора по краю (карта на диск)."""
    print("Торец полена")
    n = 512
    u, v = grid(n)
    x = (u - 0.5) * 2
    y = (v - 0.5) * 2
    warp = fnoise(n, 18101, beta=3.0, fmin=1, fmax=8) * 0.05
    r = np.sqrt(x * x + y * y) + warp
    ang = np.arctan2(y, x)
    rings = 0.5 + 0.5 * np.sin(r * 2 * np.pi * 15 + fnoise(n, 18102, beta=2.5, fmin=1, fmax=20) * 2.0)
    late = smoothstep(0.65, 1.0, rings)
    heart = smoothstep(0.55, 0.25, r)
    saw = fnoise(n, 18103, beta=1.0, fmin=8, fmax=200, aniso=(1.0, 6.0))
    tone = 0.72 - 0.16 * late - 0.08 * heart + 0.04 * saw
    rgb = np.stack([tone * 1.0, tone * 0.80, tone * 0.58], -1)
    # Радиальные трещины усушки.
    crack = np.zeros((n, n))
    rng = np.random.default_rng(18104)
    for a0 in rng.uniform(-np.pi, np.pi, 5):
        da = np.abs(np.arctan2(np.sin(ang - a0), np.cos(ang - a0)))
        w = 0.012 * (1.2 - r)
        crack = np.maximum(crack, smoothstep(w, 0.0, da * np.maximum(r, 0.05)) * smoothstep(0.15, 0.5, r) * smoothstep(0.98, 0.7, r))
    rgb = rgb * (1 - 0.75 * crack[..., None])
    # Камбий и кора по краю.
    bark_ring = smoothstep(0.86, 0.9, r)
    cambium = smoothstep(0.8, 0.86, r) * (1 - bark_ring)
    rgb = rgb * (1 - 0.25 * cambium[..., None])
    bark = np.stack([0.16 + 0.05 * saw, 0.11 + 0.03 * saw, 0.07 + 0.02 * saw], -1)
    rgb = rgb * (1 - bark_ring[..., None]) + bark * bark_ring[..., None]
    height = 0.3 * late - 1.0 * crack + 0.2 * saw - 0.3 * bark_ring
    save("endgrain_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [1.0, 1.0]})
    save("endgrain_normal", normal_from_height(height, 4.0), "data", meta={"tile": [1.0, 1.0]})


def make_birch():
    """Берёзовая кора для дров: белая с горизонтальными чечевичками и чёрными трещинами (тайл 0,5 × 0,5 м по развёртке)."""
    print("Береста")
    n = 512
    rng = np.random.default_rng(19101)
    u, v = grid(n)
    base = 0.86 + 0.05 * fnoise(n, 19102, beta=2.0, fmin=1, fmax=40) + 0.03 * fnoise(n, 19103, beta=0.6, fmin=40, fmax=200)
    rgb = np.stack([base * 0.98, base * 0.96, base * 0.9], -1)
    height = np.zeros((n, n))
    # Чечевички: короткие тёмные штрихи вдоль окружности (по u).
    for _ in range(900):
        cx, cy = rng.uniform(0, n, 2)
        L = rng.uniform(6, 34)
        th = rng.uniform(1.0, 2.6)
        du = np.minimum(np.abs(u * n - cx), n - np.abs(u * n - cx))
        dv = np.minimum(np.abs(v * n - cy), n - np.abs(v * n - cy))
        m = (du < L / 2) & (dv < th * (1 - (du / (L / 2)) ** 2))
        dark = rng.uniform(0.15, 0.45)
        rgb[m] = rgb[m] * dark
        height[m] -= 0.6
    # Чёрные растрескавшиеся пятна у основания и сучков.
    blot = smoothstep(0.55, 0.8, fnoise(n, 19104, beta=2.2, fmin=2, fmax=30, aniso=(1.0, 2.5)))
    cracks = smoothstep(0.6, 0.85, np.abs(fnoise(n, 19105, beta=1.2, fmin=6, fmax=120, aniso=(0.4, 1.0))))
    black = np.clip(blot * (0.6 + 0.4 * cracks), 0, 1)
    rgb = rgb * (1 - 0.88 * black[..., None])
    # Отслоения: тёплые розоватые полосы.
    peel = smoothstep(0.7, 0.85, fnoise(n, 19106, beta=2.0, fmin=2, fmax=40, aniso=(0.3, 1.0)))
    rgb = rgb * (1 - 0.3 * peel[..., None]) + np.array([0.78, 0.6, 0.48]) * 0.3 * peel[..., None]
    height += -0.8 * black + 0.3 * peel
    save("birch_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [0.5, 0.5], "mean": float(rgb.mean())})
    save("birch_normal", normal_from_height(height, 3.0), "data", meta={"tile": [0.5, 0.5]})


# ---------- участок во Всеволожске: отделка построек и покрытия ----------
def make_facade_board():
    """Вертикальная фасадная доска 120 мм с V-швом 8 мм под полупрозрачной покраской (тайл 0,96 × 0,96 м)."""
    print("Фасадная доска")
    n = 1024
    u, v = grid(n)
    boards = 8
    x = u * boards
    k = np.floor(x).astype(int) % boards
    f = x - np.floor(x)
    rng = np.random.default_rng(21101)
    shift = rng.uniform(0, 1, boards)[k]
    # Волокна вдоль доски (по v), сучки — редкие пятна; каждая доска — свой рисунок.
    fib = fnoise(n, 21102, beta=1.2, fmin=4, fmax=n // 2, aniso=(1.0, 40.0))
    fib = np.roll(fib, 37, axis=1) * 0.5 + fib * 0.5
    grain = np.sin(2 * np.pi * (u * boards * 9 + 0.6 * fnoise(n, 21103, beta=3.0, fmin=1, fmax=12, aniso=(1.0, 6.0)) + shift * 3))
    knots = smoothstep(0.82, 0.95, fnoise(n, 21104, beta=0.9, fmin=20, fmax=120))
    tone_b = rng.uniform(0.95, 1.04, boards)[k]
    # Профиль: V-шов 8 мм (≈ 1/15 ширины доски) и лёгкое закругление кромок.
    gw = 0.035
    edge = np.minimum(f, 1 - f)
    groove = 1 - smoothstep(0.0, gw, edge)
    crown = np.sqrt(np.clip(1 - ((f - 0.5) / 0.5) ** 8, 0, 1))
    height = 0.55 * crown - 1.2 * groove + 0.05 * fib + 0.03 * grain - 0.05 * knots
    paint = (0.93 + 0.025 * fib + 0.015 * grain - 0.05 * knots) * tone_b
    paint = paint * (1 - 0.55 * groove)
    save("facade_albedo", gray3(np.clip(paint, 0, 1)), "color", meta={"tile": [0.96, 0.96], "mean": float(paint.mean())})
    save("facade_normal", normal_from_height(height, 9.0), "data", meta={"tile": [0.96, 0.96]})
    rough = 0.78 + 0.08 * groove + 0.04 * fib
    save("facade_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [0.96, 0.96]})


def make_pavers():
    """Серая бетонная тротуарная плитка 200 × 100 мм, перевязка в полкирпича, фаска, песок в швах (тайл 0,8 м)."""
    print("Тротуарная плитка")
    n = 1024
    u, v = grid(n)
    rows = 8
    r = np.floor(v * rows).astype(int)
    fv = v * rows - r
    cols = 4
    xu = u * cols + 0.5 * (r % 2)
    c = np.floor(xu).astype(int) % cols
    fu = xu - np.floor(xu)
    pid = r * cols + c
    rng = np.random.default_rng(22101)
    tone = rng.uniform(0.9, 1.08, rows * cols)[pid]
    warm = rng.uniform(-0.025, 0.025, rows * cols)[pid]
    # Края: фаска 4 мм, шов 3 мм (в долях кирпича 200 × 100).
    eu = np.minimum(fu, 1 - fu) * 200
    ev = np.minimum(fv, 1 - fv) * 100
    e = np.minimum(eu, ev)
    joint = 1 - smoothstep(1.2, 1.8, e)
    bevel = smoothstep(1.5, 5.5, e)
    pores = smoothstep(0.55, 0.85, fnoise(n, 22102, beta=0.2, fmin=n // 6, fmax=n // 2))
    mott = fnoise(n, 22103, beta=2.2, fmin=2, fmax=60)
    aggr = fnoise(n, 22104, beta=0.5, fmin=n // 10, fmax=n // 2)
    base = (0.58 + 0.04 * mott + 0.03 * aggr - 0.06 * pores) * tone
    rgb = np.stack([base * (1 + warm), base, base * (1 - warm) * 0.98], -1)
    sand = np.array([0.50, 0.47, 0.42]) * (0.9 + 0.1 * aggr[..., None])
    rgb = rgb * (0.86 + 0.14 * bevel[..., None])
    rgb = rgb * (1 - joint[..., None]) + sand * joint[..., None]
    height = 0.8 * bevel - 0.6 * joint + 0.04 * aggr - 0.05 * pores
    save("pavers_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [0.8, 0.8], "mean": float(rgb.mean())})
    save("pavers_normal", normal_from_height(height, 6.0), "data", meta={"tile": [0.8, 0.8]})
    rough = 0.86 + 0.06 * joint - 0.05 * mott
    save("pavers_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [0.8, 0.8]})


def make_stucco():
    """Цокольная штукатурка «шуба» мелкой фракции (тайл 1,0 м)."""
    print("Штукатурка цоколя")
    n = 1024
    grains = fnoise(n, 23101, beta=0.4, fmin=n // 8, fmax=n // 2)
    lumps = fnoise(n, 23102, beta=1.6, fmin=20, fmax=200)
    trowel = fnoise(n, 23103, beta=3.0, fmin=1, fmax=10, aniso=(3.0, 1.0))
    height = 0.6 * smoothstep(-0.2, 0.9, grains) + 0.35 * lumps + 0.15 * trowel
    tone = 0.80 + 0.04 * lumps + 0.03 * trowel - 0.06 * (1 - smoothstep(-0.6, 0.2, grains))
    save("stucco_albedo", gray3(np.clip(tone, 0, 1)), "color", meta={"tile": [1.0, 1.0], "mean": float(tone.mean())})
    save("stucco_normal", normal_from_height(height, 4.0), "data", meta={"tile": [1.0, 1.0]})


def make_rubber():
    """Резиновая крошка спортплощадки: серые гранулы EPDM 1–3 мм (тайл 0,5 м)."""
    print("Резиновая крошка")
    n = 1024
    f1, f2, ids, k = worley_periodic(n, (120, 120), 24101, jitter=1.0)
    rng = np.random.default_rng(24102)
    t = rng.uniform(0.32, 0.5, k)[ids]
    speck = (rng.random(k) < 0.06)[ids]
    tone = np.where(speck, 0.62, t)
    edge = smoothstep(0.0, 0.004, f2 - f1)
    tone = tone * (0.7 + 0.3 * edge)
    height = edge * rng.uniform(0.6, 1.0, k)[ids]
    save("rubber_albedo", gray3(np.clip(tone, 0, 1)), "color", meta={"tile": [0.5, 0.5], "mean": float(tone.mean())})
    save("rubber_normal", normal_from_height(height, 3.0), "data", meta={"tile": [0.5, 0.5]})


def make_water():
    """Рябь воды для пруда и купели: периодический шум (тайл 2,0 м)."""
    print("Вода")
    n = 512
    h = fnoise(n, 25101, beta=3.2, fmin=2, fmax=40) + 0.3 * fnoise(n, 25102, beta=2.0, fmin=8, fmax=120)
    save("water_normal", normal_from_height(h, 2.5), "data", meta={"tile": [2.0, 2.0]})


def make_plaster():
    """Декоративная фасадная штукатурка «короед»: бороздки от зерна в разных направлениях и мелкая
    зернистость (тайл 0,96 м — как у фасадной доски, развёртка стен общая)."""
    print("Декоративная штукатурка")
    n = 1024
    u, v = grid(n)
    rng = np.random.default_rng(26101)
    # Бороздки: короткие штрихи (след зерна под тёркой) — сумма анизотропных шумов в нескольких направлениях.
    grooves = np.zeros((n, n))
    for i, ang in enumerate([0.0, 0.7, 1.4, 2.1, 2.8]):
        f = fnoise(n, 26110 + i, beta=0.9, fmin=n // 24, fmax=n // 3, aniso=(1.0 + 5.0 * abs(math.cos(ang)), 1.0 + 5.0 * abs(math.sin(ang))))
        grooves = np.minimum(grooves, -smoothstep(0.35, 0.75, f)) if i else -smoothstep(0.35, 0.75, f)
    grain = fnoise(n, 26120, beta=0.3, fmin=n // 6, fmax=n // 2)
    lumps = fnoise(n, 26121, beta=1.8, fmin=6, fmax=80)
    height = 0.9 * grooves + 0.25 * grain + 0.2 * lumps
    tone = 0.94 + 0.02 * lumps + 0.012 * grain + 0.08 * grooves
    rgb = np.stack([tone, tone * 0.985, tone * 0.965], -1)
    save("plaster_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [0.96, 0.96], "mean": float(rgb.mean())})
    save("plaster_normal", normal_from_height(height, 7.0), "data", meta={"tile": [0.96, 0.96]})
    rough = 0.9 + 0.05 * grooves - 0.02 * lumps
    save("plaster_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [0.96, 0.96]})
    del u, v, rng


def make_brick():
    """Облицовочный кирпич цоколя: красно-коричневый, 4 кирпича по ширине и 13 рядов на 1 м (кирпич
    240 × 67, шов 10 мм), перевязка в полкирпича, утопленный светлый шов (тайл 1,0 м)."""
    print("Кирпич цоколя")
    n = 1024
    u, v = grid(n)
    rows, cols = 13, 4
    r = np.floor(v * rows).astype(int)
    fv = v * rows - r
    xu = u * cols + 0.5 * (r % 2)
    c = np.floor(xu).astype(int) % cols
    fu = xu - np.floor(xu)
    pid = r * cols + c
    rng = np.random.default_rng(27101)
    k = rows * cols
    tone = rng.uniform(0.82, 1.12, k)[pid]
    hue = rng.uniform(-0.05, 0.05, k)[pid]
    burnt = (rng.random(k) < 0.12)[pid]
    # Шов 10 мм: по ширине модуля 250 мм — 0,04; по высоте модуля 76,9 мм — 0,13.
    eu = np.minimum(fu, 1 - fu) * 250
    ev = np.minimum(fv, 1 - fv) * 76.9
    e = np.minimum(eu, ev)
    joint = 1 - smoothstep(4.0, 5.5, e)
    edge = smoothstep(5.0, 9.0, e)
    mott = fnoise(n, 27102, beta=1.8, fmin=4, fmax=90)
    sand = fnoise(n, 27103, beta=0.3, fmin=n // 8, fmax=n // 2)
    base = np.stack([0.50 + hue, 0.29 + hue * 0.4, 0.20 - hue * 0.3], -1) * (tone * (0.92 + 0.08 * mott + 0.04 * sand))[..., None]
    base = np.where(burnt[..., None], base * np.array([0.72, 0.68, 0.70]), base)
    base = base * (0.9 + 0.1 * edge[..., None])
    mortar = np.array([0.70, 0.66, 0.60]) * (0.92 + 0.08 * sand[..., None])
    rgb = base * (1 - joint[..., None]) + mortar * joint[..., None]
    height = 0.7 * edge - 0.9 * joint + 0.06 * mott + 0.05 * sand
    save("brick_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [1.0, 1.0], "mean": float(rgb.mean())})
    save("brick_normal", normal_from_height(height, 7.0), "data", meta={"tile": [1.0, 1.0]})
    rough = 0.82 + 0.1 * joint - 0.04 * mott
    save("brick_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [1.0, 1.0]})


def make_timber_lining():
    """Имитация бруса (вагонка под брус) вертикально: ламель 140 мм с полукруглыми фасками и узким швом,
    светлая сосна под прозрачным лаком (тайл 0,84 м — 6 ламелей)."""
    print("Имитация бруса")
    n = 1024
    u, v = grid(n)
    boards = 6
    x = u * boards
    k = np.floor(x).astype(int) % boards
    f = x - np.floor(x)
    rng = np.random.default_rng(28101)
    shift = rng.uniform(0, 1, boards)[k]
    tone_b = rng.uniform(0.93, 1.06, boards)[k]
    # Годичные слои вдоль ламели (по v) с волной, сучки, поры.
    # Тангенциальный распил: «арки» годичных слоев вдоль ламели (фаза — парабола по ширине), шаг неравный.
    wav = 0.9 * fnoise(n, 28102, beta=3.2, fmin=1, fmax=8, aniso=(1.0, 4.0))
    cen = 0.5 + 0.25 * (shift - 0.5)
    arch = (np.abs(f - cen) * 2.2) ** 1.6
    ph = 5.5 * arch + 2.0 * np.sin(2 * np.pi * (v * (1 + (k % 3)) + shift)) + wav * 1.5 + shift * 7
    rings = np.sin(2 * np.pi * ph) * 0.5 + 0.5 * np.sin(2 * np.pi * ph * 1.97 + 1.3)
    late = smoothstep(0.45, 0.95, rings) * (0.6 + 0.4 * smoothstep(-0.5, 0.5, fnoise(n, 28105, beta=2.0, fmin=2, fmax=30)))
    fib = fnoise(n, 28103, beta=1.1, fmin=6, fmax=n // 2, aniso=(1.0, 30.0))
    kn = fnoise(n, 28104, beta=1.0, fmin=10, fmax=70)
    knots = smoothstep(0.86, 0.96, kn)
    # Профиль бруса: скруглённые фаски ~12 мм на ламели 140 мм и шов 3 мм.
    edge = np.minimum(f, 1 - f) * 140
    seam = 1 - smoothstep(1.0, 2.0, edge)
    bev = smoothstep(1.0, 14.0, edge)
    crown = np.sqrt(np.clip(bev * (2 - bev), 0, 1))
    height = 0.9 * crown - 0.8 * seam + 0.04 * fib + 0.02 * late - 0.05 * knots
    base = np.array([0.80, 0.62, 0.42])
    shade = (1 - 0.13 * late + 0.05 * fib - 0.35 * knots) * tone_b * (0.82 + 0.18 * crown)
    rgb = base * shade[..., None]
    rgb = rgb * (1 - 0.6 * seam[..., None])
    save("lining_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [0.84, 0.84], "mean": float(rgb.mean())})
    save("lining_normal", normal_from_height(height, 8.0), "data", meta={"tile": [0.84, 0.84]})
    rough = 0.5 + 0.12 * late + 0.2 * seam - 0.05 * crown
    save("lining_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [0.84, 0.84]})


def make_laminate():
    """Ламинат тёмно-серый «под дуб»: доска 193 мм, длина = тайлу 1,158 м со сдвигом рядов на 1/3, фаска
    4V, рисунок дуба приглушён (тайл 1,158 м — 6 досок)."""
    print("Ламинат")
    n = 1024
    u, v = grid(n)
    rows = 6
    r = np.floor(v * rows).astype(int)
    fv = v * rows - r
    off = ((r * 37) % 3) / 3.0
    xu = u + off
    c = np.floor(xu).astype(int)
    fu = xu - np.floor(xu)
    pid = (r * 3 + c) % 18
    rng = np.random.default_rng(29101)
    tone = rng.uniform(0.86, 1.12, 18)[pid]
    shift = rng.uniform(0, 1, 18)[pid]
    wav = 0.7 * fnoise(n, 29102, beta=3.0, fmin=1, fmax=10, aniso=(5.0, 1.0))
    rings = np.sin(2 * np.pi * ((fv - 0.5) * 6 + wav + shift * 4))
    late = smoothstep(0.5, 0.95, rings)
    fib = fnoise(n, 29103, beta=1.1, fmin=6, fmax=n // 2, aniso=(30.0, 1.0))
    eu = np.minimum(fu, 1 - fu) * 1158
    ev = np.minimum(fv, 1 - fv) * 193
    e = np.minimum(eu, ev)
    bevel = 1 - smoothstep(0.5, 3.0, e)
    height = -0.8 * bevel + 0.04 * fib + 0.03 * late
    g = (0.30 - 0.05 * late + 0.02 * fib) * tone
    rgb = np.stack([g * 1.0, g * 1.0, g * 1.03], -1) * (1 - 0.45 * bevel[..., None])
    save("laminate_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [1.158, 1.158], "mean": float(rgb.mean())})
    save("laminate_normal", normal_from_height(height, 6.0), "data", meta={"tile": [1.158, 1.158]})
    rough = 0.55 + 0.1 * late + 0.15 * bevel
    save("laminate_rough", gray3(np.clip(rough, 0, 1)), "data", meta={"tile": [1.158, 1.158]})


def make_tile():
    """Керамогранит 600 × 600 тёмно-серый матовый с тонким швом 2 мм (тайл 1,2 м) — мокрые помещения."""
    print("Керамогранит")
    n = 1024
    u, v = grid(n)
    cells = 2
    fu = (u * cells) % 1.0
    fv = (v * cells) % 1.0
    pid = (np.floor(v * cells) * cells + np.floor(u * cells)).astype(int)
    rng = np.random.default_rng(30101)
    tone = rng.uniform(0.95, 1.05, cells * cells)[pid]
    e = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv)) * 600
    joint = 1 - smoothstep(0.8, 1.4, e)
    cloud = fnoise(n, 30102, beta=2.2, fmin=2, fmax=60)
    speck = fnoise(n, 30103, beta=0.2, fmin=n // 6, fmax=n // 2)
    g = (0.27 + 0.02 * cloud + 0.01 * speck) * tone
    rgb = np.stack([g, g, g * 1.02], -1) * (1 - joint[..., None]) + np.array([0.42, 0.41, 0.40]) * joint[..., None]
    height = -joint + 0.02 * speck
    save("tile_albedo", np.clip(rgb, 0, 1), "color", meta={"tile": [1.2, 1.2], "mean": float(rgb.mean())})
    save("tile_normal", normal_from_height(height, 4.0), "data", meta={"tile": [1.2, 1.2]})


GENERATORS = {
    "woods": lambda: make_woods(),
    "fabric": lambda: make_fabric(),
    "stones": lambda: make_stones(),
    "metal": lambda: make_metal(),
    "bark": lambda: make_bark(),
    "grass": lambda: make_grass(),
    "needles": lambda: make_needles(),
    "leaves": lambda: make_leaves(),
    "forest_floor": lambda: make_forest_floor(),
    "gravel": lambda: make_gravel(),
    "flagstone": lambda: make_flagstone(),
    "endgrain": lambda: make_endgrain(),
    "birch": lambda: make_birch(),
    "facade": lambda: make_facade_board(),
    "pavers": lambda: make_pavers(),
    "stucco": lambda: make_stucco(),
    "rubber": lambda: make_rubber(),
    "water": lambda: make_water(),
    "plaster": lambda: make_plaster(),
    "brick": lambda: make_brick(),
    "lining": lambda: make_timber_lining(),
    "laminate": lambda: make_laminate(),
    "tile": lambda: make_tile(),
}


def main():
    # Без аргументов — все карты; с аргументами после «--» — только названные генераторы,
    # остальные записи манифеста сохраняются.
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if only:
        with open(os.path.join(OUT, "manifest.json"), encoding="utf-8") as f:
            MANIFEST.update(json.load(f)["maps"])
    for name, fn in GENERATORS.items():
        if not only or name in only:
            fn()
    manifest = {"generator": "scripts/blender/make_textures.py", "blender": bpy.app.version_string, "maps": MANIFEST}
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, "dist", "data", "texture-manifest.js"), "w", encoding="utf-8") as f:
        f.write("// Сгенерировано scripts/blender/make_textures.py — список карт и их физический масштаб.\nexport default " + json.dumps(manifest, ensure_ascii=False) + ";\n")
    print("Готово:", len(MANIFEST), "карт")


if __name__ == "__main__":
    main()
