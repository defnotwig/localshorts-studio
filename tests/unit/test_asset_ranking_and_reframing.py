"""Unit tests for saliency-based reframing, blur-pad containment, and scene plate compositing."""

from __future__ import annotations

import numpy as np
from PIL import Image

from localshorts.models.schemas import ScenePlanItemSchema
from localshorts.services.procedural import reframe_image_for_frame, render_scene_plate


def _create_test_image(width: int = 1920, height: int = 1080) -> Image.Image:
    """Create a test image with high-entropy details on the right side."""
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[:, :] = [15, 23, 42]
    rw = max(10, width // 3)
    rh = max(10, height // 2)
    rx = width - rw - 5
    ry = max(5, height // 6)
    arr[ry:ry + rh, rx:rx + rw] = np.random.randint(180, 255, size=(rh, rw, 3), dtype=np.uint8)
    return Image.fromarray(arr)


def test_reframe_image_smart_crop():
    """Verify smart crop selects the optimal saliency region and matches exact target dimensions."""
    img = _create_test_image(1920, 1080)
    target_w, target_h = 936, 620
    reframed = reframe_image_for_frame(img, target_w, target_h, mode="smart_crop")
    assert reframed.size == (target_w, target_h)
    assert reframed.mode == "RGB"


def test_reframe_image_blur_pad():
    """Verify blur_pad generates a contained foreground with blurred backdrop."""
    img = _create_test_image(1920, 1080)
    target_w, target_h = 936, 620
    reframed = reframe_image_for_frame(img, target_w, target_h, mode="blur_pad")
    assert reframed.size == (target_w, target_h)
    assert reframed.mode == "RGB"


def test_reframe_image_manual_focal_point():
    """Verify manual focal point shifts crop coordinates properly."""
    img = _create_test_image(1920, 1080)
    target_w, target_h = 936, 620
    # Pin focal point to far right (85%)
    reframed_right = reframe_image_for_frame(img, target_w, target_h, mode="manual", focal_x=85.0, focal_y=50.0)
    assert reframed_right.size == (target_w, target_h)

    # Pin focal point to far left (15%)
    reframed_left = reframe_image_for_frame(img, target_w, target_h, mode="manual", focal_x=15.0, focal_y=50.0)
    assert reframed_left.size == (target_w, target_h)


def test_scene_plan_schema_reframe_defaults():
    """Verify ScenePlanItemSchema contains sensible reframing defaults."""
    scene = ScenePlanItemSchema(
        scene_index=0,
        start=0.0,
        end=3.5,
        duration=3.5,
        purpose="hook",
        spoken_text="Testing the reframe defaults in schema",
        visual_type="media_composite",
    )
    assert scene.reframe_mode == "smart_crop"
    assert scene.focal_point_x == 50.0
    assert scene.focal_point_y == 50.0


def test_scene_plate_render_with_custom_reframe(tmp_path):
    """Test full scene plate rendering with media composite and blur_pad reframing."""
    asset_file = tmp_path / "test_asset.jpg"
    test_img = _create_test_image(1280, 720)
    test_img.save(asset_file, format="JPEG")

    scene = ScenePlanItemSchema(
        scene_index=0,
        start=0.0,
        end=4.0,
        duration=4.0,
        purpose="hook",
        spoken_text="Here is a high retention creator breakdown",
        visual_type="media_composite",
        media_asset_path=str(asset_file),
        media_attribution="Creative Commons 0",
        reframe_mode="blur_pad",
        focal_point_x=50.0,
        focal_point_y=50.0,
    )

    out_png = tmp_path / "plate_01.png"
    result_path = render_scene_plate(
        scene=scene,
        total_scenes=3,
        output_path=out_png,
        preset="Creator News",
        topic_title="Creator Clipping Secrets",
    )
    assert result_path.exists()
    assert result_path.stat().st_size > 10_000
    rendered = Image.open(result_path)
    assert rendered.size == (1080, 1920)
