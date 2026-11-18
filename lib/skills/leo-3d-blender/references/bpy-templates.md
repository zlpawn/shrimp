# 通用 `bpy` 场景构建模板库

> 本模板库提炼自实时 Blender（含 Blender 5.3+ 中文界面）实测验证通过的通用原语，写新场景脚本时可直接按需复用，避免重复造轮子或踩 `execute_blender_code` 环境坑。

---

## 1. 安全清场与集合管理

> **铁律**：严禁调用 `bpy.ops.wm.read_factory_settings()`，否则会卸载 `blender_mcp` 插件导致端口断连；执行环境里 `__file__` 未定义，输出路径应通过 `Path.home()` 拼接。

```python
from pathlib import Path
import bpy


def clear_scene() -> None:
    """安全清空场景对象与孤立数据块，保留已加载的 MCP 插件与连接。"""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    for block_coll in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.lights,
        bpy.data.cameras,
        bpy.data.curves,
        bpy.data.worlds,
    ):
        for item in list(block_coll):
            if item.users == 0:
                block_coll.remove(item)


def ensure_collection(name: str) -> bpy.types.Collection:
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link_obj(obj: bpy.types.Object, col: bpy.types.Collection) -> bpy.types.Object:
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def set_smooth(obj: bpy.types.Object) -> None:
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True


def add_bevel(obj: bpy.types.Object, width: float = 0.002, segments: int = 2) -> None:
    mod = obj.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
```

---

## 2. 跨版本 / 跨语言 PBR 材质构建

按 `node.type == "BSDF_PRINCIPLED"` 查找节点，防止本地化界面节点名称不同导致 `KeyError`。

```python
def make_pbr_material(
    name: str,
    base_color: tuple[float, float, float, float],
    metallic: float = 0.0,
    roughness: float = 0.5,
    coat_weight: float = 0.0,
    emission_color: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = base_color
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metallic
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat_weight
    if emission_color is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emission_color
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat
```

---

## 3. 程序化几何体原语（旋转体 / 连杆 / 贴地对齐）

```python
import math
import bmesh
from mathutils import Vector


def create_lathe_object(
    name: str,
    profile_rz: list[tuple[float, float]],
    col: bpy.types.Collection,
    steps: int = 48,
    mat: bpy.types.Material | None = None,
) -> bpy.types.Object:
    """根据 (半径, Z高度) 轮廓点列表旋转生成光滑回转体（底座/杯身/灯罩/花瓶）。"""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile_rz]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(
        bm,
        geom=verts + edges,
        cent=(0.0, 0.0, 0.0),
        axis=(0.0, 0.0, 1.0),
        angle=math.tau,
        steps=steps,
        use_merge=True,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    link_obj(obj, col)
    set_smooth(obj)
    if mat:
        obj.data.materials.append(mat)
    return obj


def create_cylinder_between(
    name: str,
    p1: Vector,
    p2: Vector,
    radius: float,
    col: bpy.types.Collection,
    mat: bpy.types.Material,
    segments: int = 24,
) -> bpy.types.Object:
    """在两点 p1 -> p2 之间生成精准对齐的圆柱连杆/立柱。"""
    vec = p2 - p1
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        radius1=radius,
        radius2=radius,
        depth=vec.length,
    )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    link_obj(obj, col)
    obj.location = (p1 + p2) * 0.5
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = vec.normalized().to_track_quat("Z", "Y")
    set_smooth(obj)
    obj.data.materials.append(mat)
    return obj


def place_on_ground(obj: bpy.types.Object, ground_z: float = 0.0) -> None:
    """根据世界空间包围盒将物体底部精确贴合到 ground_z（防止导入/生成模型悬空）。"""
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    min_z = min(v.z for v in corners)
    obj.location.z += ground_z - min_z
```

---

## 4. 摄影棚环境、打光、相机与安全渲染导出

```python
def setup_studio_world(color: tuple[float, float, float, float] = (0.035, 0.042, 0.058, 1.0), strength: float = 0.6) -> None:
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Studio_World")
    scene.world = world
    world.use_nodes = True
    bg_node = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg_node.inputs["Color"].default_value = color
    bg_node.inputs["Strength"].default_value = strength


def add_area_light(
    name: str,
    loc: Vector,
    target: Vector,
    col: bpy.types.Collection,
    energy: float = 16.0,
    size: float = 0.8,
    color: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> bpy.types.Object:
    ldata = bpy.data.lights.new(name=name, type="AREA")
    ldata.energy = energy
    ldata.size = size
    ldata.color = color
    lobj = bpy.data.objects.new(name, ldata)
    link_obj(lobj, col)
    lobj.location = loc
    lobj.rotation_mode = "QUATERNION"
    lobj.rotation_quaternion = (target - loc).to_track_quat("-Z", "Y")
    return lobj


def frame_camera(
    name: str,
    loc: Vector,
    target: Vector,
    col: bpy.types.Collection,
    lens: float = 50.0,
) -> bpy.types.Object:
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_obj = bpy.data.objects.new(name, cam_data)
    link_obj(cam_obj, col)
    cam_obj.location = loc
    cam_obj.rotation_mode = "QUATERNION"
    cam_obj.rotation_quaternion = (target - loc).to_track_quat("-Z", "Y")
    bpy.context.scene.camera = cam_obj
    return cam_obj


def configure_and_export(
    blend_path: Path,
    render_path: Path,
    glb_path: Path | None = None,
    res_x: int = 1280,
    res_y: int = 960,
) -> str:
    scene = bpy.context.scene
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        pass

    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue

    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"

    blend_path.parent.mkdir(parents=True, exist_ok=True)
    render_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    scene.render.filepath = str(render_path)
    bpy.ops.render.render(write_still=True)

    if glb_path is not None:
        glb_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB")

    return scene.render.engine
```
