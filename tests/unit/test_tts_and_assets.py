"""Unit tests for Free Online Neural Voices (Edge-TTS) and ChatGPT Plus Asset Hub."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from localshorts.models.schemas import ScenePlanItemSchema
from localshorts.services.media import MediaService, format_image_for_vertical_short
from localshorts.services.tts import AVAILABLE_VOICES


def test_available_voices_includes_free_online_edge_tts() -> None:
    edge_voices = [v for v in AVAILABLE_VOICES if v["provider"] == "edge-tts"]
    assert len(edge_voices) >= 5
    ids = {v["id"] for v in edge_voices}
    assert "en-US-ChristopherNeural" in ids
    assert "en-US-GuyNeural" in ids
    assert "en-US-JennyNeural" in ids


def test_chatgpt_asset_prompt_generator() -> None:
    media_svc = MediaService()
    scenes = [
        ScenePlanItemSchema(
            scene_index=1,
            start=0.0,
            end=3.5,
            duration=3.5,
            purpose="hook",
            spoken_text="Local AI runs without sending prompts to the cloud.",
            visual_type="media_composite",
            visual_query="laptop GPU glowing circuit board tech",
        ),
        ScenePlanItemSchema(
            scene_index=2,
            start=3.5,
            end=7.0,
            duration=3.5,
            purpose="context",
            spoken_text="All tokens are computed right on your laptop hardware.",
            visual_type="stat_callout",
            visual_query="offline privacy shield computer",
        ),
    ]

    prompt = media_svc.generate_chatgpt_asset_search_prompt(
        topic="Why Local AI is the Future",
        headline="Why Local AI Runs Offline",
        script_text="Local AI runs without sending prompts to the cloud.",
        scenes=scenes,
    )

    assert "ChatGPT Plus" in prompt or "YouTube Shorts" in prompt
    assert "Scene 1" in prompt
    assert "Scene 2" in prompt
    assert "DALL-E" in prompt
    assert "laptop GPU glowing circuit board" in prompt


def test_format_image_for_vertical_short(tmp_path: Path) -> None:
    # Create a small landscape test image (400x200)
    img = Image.new("RGB", (400, 200), (45, 120, 210))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    img_bytes = buf.getvalue()

    out_file = tmp_path / "formatted_vertical.jpg"
    ok = format_image_for_vertical_short(img_bytes, out_file)

    assert ok is True
    assert out_file.exists()

    with Image.open(out_file) as res:
        assert res.size == (1080, 1920)
