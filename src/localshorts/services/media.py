"""Media provider abstraction, Wikimedia Commons CC/Public-Domain fetcher, Authorized Media scanner, and 15 GB SHA-256 LRU cache."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
from pathlib import Path
from typing import Any, Sequence

import httpx
from sqlmodel import select

from localshorts.config import (
    AUTHORIZED_MEDIA_DIR,
    BACKGROUNDS_DIR,
    MEDIA_CACHE_DIR,
    OUTPUT_DIR,
    TEMP_CACHE_DIR,
    ensure_directories,
)
from localshorts.database import get_session
from localshorts.logging_config import get_logger
from localshorts.models.db_models import MediaCacheEntry, utc_now_iso
from localshorts.models.schemas import ScenePlanItemSchema
from localshorts.security import sanitize_filename, validate_external_url

logger = get_logger("media")

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_LICENSE_KEYWORDS = ("cc0", "public domain", "pd-", "cc-by", "cc by", "creative commons")


def compute_sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def get_directory_size_bytes(directory: Path) -> int:
    if not directory.exists():
        return 0
    total = 0
    for root, _dirs, files in os.walk(directory):
        for f in files:
            fp = Path(root) / f
            try:
                total += fp.stat().st_size
            except OSError:
                pass
    return total


def get_storage_and_cache_stats(cache_limit_gb: float = 15.0) -> dict[str, Any]:
    """Return current cache size, temp size, output size, and free disk space."""
    ensure_directories()
    media_bytes = get_directory_size_bytes(MEDIA_CACHE_DIR)
    temp_bytes = get_directory_size_bytes(TEMP_CACHE_DIR)
    output_bytes = get_directory_size_bytes(OUTPUT_DIR)
    free_bytes = shutil.disk_usage(OUTPUT_DIR).free
    return {
        "media_cache_mb": round(media_bytes / (1024 * 1024), 2),
        "temp_cache_mb": round(temp_bytes / (1024 * 1024), 2),
        "total_cache_mb": round((media_bytes + temp_bytes) / (1024 * 1024), 2),
        "total_cache_gb": round((media_bytes + temp_bytes) / (1024**3), 3),
        "cache_limit_gb": cache_limit_gb,
        "output_size_mb": round(output_bytes / (1024 * 1024), 2),
        "free_disk_gb": round(free_bytes / (1024**3), 2),
    }


def enforce_media_cache_limit(limit_gb: float = 15.0) -> dict[str, int]:
    """
    Evict oldest unused cached media files (LRU by last_used_at ASC) when cache/media
    exceeds limit_gb. Never touches output/ or assets/authorized_media/.
    """
    ensure_directories()
    max_bytes = int(limit_gb * (1024**3))
    current_bytes = get_directory_size_bytes(MEDIA_CACHE_DIR)
    removed_count = 0
    freed_bytes = 0

    if current_bytes <= max_bytes:
        return {"removed_files": 0, "freed_bytes": 0, "current_bytes": current_bytes}

    with get_session() as session:
        stmt = select(MediaCacheEntry).order_by(MediaCacheEntry.last_used_at.asc())
        entries = list(session.exec(stmt).all())
        for entry in entries:
            if current_bytes - freed_bytes <= max_bytes:
                break
            p = Path(entry.local_path)
            if p.exists() and p.resolve().is_relative_to(MEDIA_CACHE_DIR.resolve()):
                try:
                    sz = p.stat().st_size
                    p.unlink()
                    freed_bytes += sz
                    removed_count += 1
                except OSError:
                    pass
            session.delete(entry)
        session.commit()

    logger.info("Media cache LRU eviction removed %d files (%d bytes)", removed_count, freed_bytes)
    return {
        "removed_files": removed_count,
        "freed_bytes": freed_bytes,
        "current_bytes": max(0, current_bytes - freed_bytes),
    }


def clean_temporary_cache(include_media_cache: bool = False) -> dict[str, Any]:
    """
    Clean temporary intermediate files (cache/temp/*) and optionally cached external media.
    NEVER deletes output/ videos, SQLite DB, settings, scripts, or source manifests.
    """
    ensure_directories()
    freed = 0
    removed = 0

    target_dirs = [TEMP_CACHE_DIR]
    if include_media_cache:
        target_dirs.append(MEDIA_CACHE_DIR)

    for tdir in target_dirs:
        if not tdir.exists():
            continue
        for item in tdir.iterdir():
            if item.name == ".gitkeep":
                continue
            try:
                if item.is_dir():
                    freed += get_directory_size_bytes(item)
                    shutil.rmtree(item, ignore_errors=True)
                    removed += 1
                else:
                    freed += item.stat().st_size
                    item.unlink(missing_ok=True)
                    removed += 1
            except OSError:
                pass

    if include_media_cache:
        with get_session() as session:
            for entry in session.exec(select(MediaCacheEntry)).all():
                session.delete(entry)
            session.commit()

    return {
        "removed_items": removed,
        "freed_mb": round(freed / (1024 * 1024), 2),
    }


def format_image_for_vertical_short(img_bytes: bytes, out_path: Path) -> bool:
    """Format an image into 1080x1920 vertical canvas with blurred background and centered sharp foreground."""
    try:
        import io

        from PIL import Image, ImageFilter

        with Image.open(io.BytesIO(img_bytes)) as img:
            img = img.convert("RGB")
            target_w, target_h = 1080, 1920
            w, h = img.size

            canvas = Image.new("RGB", (target_w, target_h), (18, 20, 28))

            # Background fill + blur
            bg_scale = max(target_w / float(w), target_h / float(h))
            bg_w, bg_h = max(1, int(round(w * bg_scale))), max(1, int(round(h * bg_scale)))
            bg = img.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
            left = max(0, (bg_w - target_w) // 2)
            top = max(0, (bg_h - target_h) // 2)
            bg_cropped = bg.crop((left, top, left + target_w, top + target_h)).filter(
                ImageFilter.GaussianBlur(24)
            )
            canvas.paste(bg_cropped, (0, 0))

            # Foreground fit centered
            fg_scale = min(target_w / float(w), target_h / float(h))
            fg_w, fg_h = max(1, int(round(w * fg_scale))), max(1, int(round(h * fg_scale)))
            fg = img.resize((fg_w, fg_h), Image.Resampling.LANCZOS)
            fg_x = (target_w - fg_w) // 2
            fg_y = (target_h - fg_h) // 2
            canvas.paste(fg, (fg_x, fg_y))

            out_path.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(str(out_path), "JPEG", quality=92)
            return True
    except Exception as exc:
        logger.warning("Failed to format image to vertical short: %s", exc)
        return False


class MediaService:
    """Resolves licensed/local visual assets for scenes with SHA-256 caching and procedural fallback."""

    def generate_chatgpt_asset_search_prompt(
        self,
        topic: str,
        headline: str,
        script_text: str,
        scenes: Sequence[ScenePlanItemSchema],
    ) -> str:
        """
        Generate an optimized search and asset curation prompt specifically for ChatGPT Plus
        (utilizing ChatGPT Web Search and DALL-E 3) to find or generate visual assets for each scene.
        """
        prompt_lines = [
            "# YouTube Shorts Creative Asset Research — LocalShorts Studio",
            f"**Topic**: {topic}",
            f"**Headline**: {headline or topic}",
            f"**Full Narration Script**:\n\"{script_text.strip()}\"\n",
            "## Scene Breakdown & Visual Needs:",
        ]
        for s in scenes:
            start_val = getattr(s, "start", getattr(s, "start_s", 0.0))
            end_val = getattr(s, "end", getattr(s, "end_s", 0.0))
            spoken_val = getattr(s, "spoken_text", getattr(s, "caption_text", ""))
            prompt_lines.append(
                f"- **Scene {s.scene_index}** ({start_val:.1f}s – {end_val:.1f}s):\n"
                f"  - Spoken words: \"{spoken_val}\"\n"
                f"  - Target concept: {s.visual_query}\n"
                f"  - Preferred visual type: {s.visual_type}"
            )

        prompt_lines.extend(
            [
                "",
                "## Instructions for ChatGPT Plus:",
                "1. **Stock Media Search**: Using your Web Search capability, search for direct, copyright-free / royalty-free high-resolution vertical or horizontal image or B-roll video URLs (from Wikimedia Commons, Pexels, Pixabay, Unsplash, or Internet Archive) matching each scene.",
                "2. **Custom AI Art (DALL-E 3)**: For scenes needing dramatic illustrative or futuristic visuals, generate a high-retention 9:16 vertical image using DALL-E 3, or provide the exact DALL-E prompt.",
                "3. **Format**: For each scene, return:",
                "   `Scene [number]: [Direct Image URL or DALL-E link]`",
                "",
                "Please output the curated assets now.",
            ]
        )
        return "\n".join(prompt_lines)

    async def fetch_pexels_image(
        self,
        query: str,
        api_key: str,
        cache_limit_gb: float = 15.0,
    ) -> dict[str, str] | None:
        """Fetch a free vertical stock photo from Pexels API."""
        if not api_key or not query.strip():
            return None
        url = "https://api.pexels.com/v1/search"
        headers = {"Authorization": api_key.strip()}
        params = {"query": query.strip(), "orientation": "portrait", "per_page": "3"}
        try:
            async with httpx.AsyncClient(timeout=8.0, headers=headers) as client:
                res = await client.get(url, params=params)
                if res.status_code != 200:
                    return None
                data = res.json()
                photos = data.get("photos", [])
                if not photos:
                    return None
                photo = photos[0]
                img_url = photo.get("src", {}).get("large2x") or photo.get("src", {}).get("large")
                if not img_url:
                    return None
                img_resp = await client.get(img_url)
                if img_resp.status_code != 200:
                    return None
                sha = compute_sha256_bytes(img_resp.content)
                local_file = MEDIA_CACHE_DIR / sha[:2] / f"{sha}.jpg"
                format_image_for_vertical_short(img_resp.content, local_file)
                photographer = photo.get("photographer", "Pexels Creator")
                attribution = f"Pexels / {photographer} (Free License)"
                return {
                    "local_path": str(local_file),
                    "attribution": attribution,
                    "license": "Pexels Free License",
                    "source_url": img_url,
                    "provider": "pexels",
                }
        except Exception as exc:
            logger.debug("Pexels lookup skipped for '%s': %s", query, exc)
            return None

    async def fetch_pixabay_image(
        self,
        query: str,
        api_key: str,
        cache_limit_gb: float = 15.0,
    ) -> dict[str, str] | None:
        """Fetch a free vertical stock photo from Pixabay API."""
        if not api_key or not query.strip():
            return None
        url = "https://pixabay.com/api/"
        params = {
            "key": api_key.strip(),
            "q": query.strip(),
            "image_type": "photo",
            "orientation": "vertical",
            "per_page": "3",
            "safesearch": "true",
        }
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(url, params=params)
                if res.status_code != 200:
                    return None
                hits = res.json().get("hits", [])
                if not hits:
                    return None
                hit = hits[0]
                img_url = hit.get("largeImageURL") or hit.get("webformatURL")
                if not img_url:
                    return None
                img_resp = await client.get(img_url)
                if img_resp.status_code != 200:
                    return None
                sha = compute_sha256_bytes(img_resp.content)
                local_file = MEDIA_CACHE_DIR / sha[:2] / f"{sha}.jpg"
                format_image_for_vertical_short(img_resp.content, local_file)
                user = hit.get("user", "Pixabay Contributor")
                attribution = f"Pixabay / {user} (Content License)"
                return {
                    "local_path": str(local_file),
                    "attribution": attribution,
                    "license": "Pixabay Free License",
                    "source_url": img_url,
                    "provider": "pixabay",
                }
        except Exception as exc:
            logger.debug("Pixabay lookup skipped for '%s': %s", query, exc)
            return None

    async def import_chatgpt_assets_text(
        self,
        text: str,
        scenes: list[ScenePlanItemSchema],
        target_dir: Path,
    ) -> tuple[list[ScenePlanItemSchema], list[dict[str, str]]]:
        """
        Parse media URLs from ChatGPT Plus responses or direct lists, download them,
        format to vertical 1080x1920, and bind them to the respective scenes.
        """
        # Look for Scene-prefixed URLs or plain URLs
        scene_matches = re.findall(r"(?:Scene\s*(\d+)[:\s\-]+)?(https?://[^\s<>'\"\)\]]+)", text, re.IGNORECASE)
        if not scene_matches:
            return scenes, []

        target_dir.mkdir(parents=True, exist_ok=True)
        imported_attributions: list[dict[str, str]] = []

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }

        async with httpx.AsyncClient(timeout=15.0, headers=headers, follow_redirects=True) as client:
            for fallback_idx, (scene_num_str, raw_url) in enumerate(scene_matches):
                clean_url = raw_url.strip().rstrip(".,;:")
                # Determine target scene index
                target_idx = fallback_idx
                if scene_num_str and scene_num_str.isdigit():
                    parsed_num = int(scene_num_str)
                    target_idx = parsed_num if parsed_num < len(scenes) else max(0, parsed_num - 1)

                if target_idx >= len(scenes):
                    target_idx = target_idx % len(scenes)

                try:
                    validate_external_url(clean_url)
                    resp = await client.get(clean_url)
                    if resp.status_code != 200 or len(resp.content) < 3_000:
                        continue
                    out_file = target_dir / f"chatgpt_scene_{target_idx + 1}.jpg"
                    ok = format_image_for_vertical_short(resp.content, out_file)
                    if ok and out_file.exists():
                        scenes[target_idx].media_asset_path = str(out_file)
                        scenes[target_idx].visual_type = "media_composite"
                        scenes[target_idx].media_attribution = f"ChatGPT Plus / Curated Asset (Scene {target_idx + 1})"
                        imported_attributions.append(
                            {
                                "scene_index": str(scenes[target_idx].scene_index),
                                "provider": "chatgpt_plus",
                                "source_url": clean_url,
                                "path": str(out_file),
                                "attribution": scenes[target_idx].media_attribution,
                                "license": "Curated Royalty-Free",
                            }
                        )
                except Exception as e:
                    logger.warning("Failed to import asset for scene %d from %s: %s", target_idx + 1, clean_url, e)

        return scenes, imported_attributions

    async def search_and_generate_assets_openai(
        self,
        topic: str,
        scenes: list[ScenePlanItemSchema],
        target_dir: Path,
        api_key: str,
        model: str = "gpt-4o-mini",
        generate_dalle: bool = False,
    ) -> tuple[list[ScenePlanItemSchema], list[dict[str, str]]]:
        """
        Direct automated asset search and DALL-E generation using OpenAI API credentials.
        """
        if not api_key:
            return scenes, []
        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=api_key.strip())
            attributions: list[dict[str, str]] = []
            target_dir.mkdir(parents=True, exist_ok=True)

            if generate_dalle:
                for idx, sc in enumerate(scenes[:4]):  # Max 4 DALL-E calls to avoid cost
                    try:
                        dalle_prompt = f"Vertical 9:16 cinematic documentary shot, hyper-realistic, high resolution: {sc.visual_query}. Dynamic lighting, creator studio aesthetic."
                        resp = await client.images.generate(
                            model="dall-e-3",
                            prompt=dalle_prompt,
                            size="1024x1792",
                            quality="standard",
                            n=1,
                        )
                        if resp.data and resp.data[0].url:
                            img_url = resp.data[0].url
                            async with httpx.AsyncClient(timeout=20.0) as http_c:
                                img_resp = await http_c.get(img_url)
                                if img_resp.status_code == 200:
                                    out_path = target_dir / f"dalle_scene_{idx + 1}.jpg"
                                    format_image_for_vertical_short(img_resp.content, out_path)
                                    sc.media_asset_path = str(out_path)
                                    sc.visual_type = "media_composite"
                                    sc.media_attribution = "DALL-E 3 / AI Generated Visual"
                                    attributions.append(
                                        {
                                            "scene_index": str(sc.scene_index),
                                            "provider": "openai_dalle3",
                                            "source_url": img_url,
                                            "path": str(out_path),
                                            "attribution": sc.media_attribution,
                                            "license": "AI Generated (User Owned)",
                                        }
                                    )
                    except Exception as exc:
                        logger.warning("DALL-E generation error for scene %d: %s", idx + 1, exc)

            return scenes, attributions
        except Exception as exc:
            logger.warning("OpenAI asset generation failed: %s", exc)
            return scenes, []

    def find_authorized_local_media(
        self,
        query: str,
        custom_dir: str = "",
    ) -> tuple[str, str] | None:
        """Search assets/authorized_media/ and optional custom_dir for matching user-owned images."""
        search_dirs = [AUTHORIZED_MEDIA_DIR, BACKGROUNDS_DIR]
        if custom_dir:
            cp = Path(custom_dir)
            if cp.exists() and cp.is_dir():
                search_dirs.insert(0, cp)

        query_tokens = [t.lower() for t in re.findall(r"[a-zA-Z0-9]+", query) if len(t) >= 3]
        all_files: list[Path] = []
        for sdir in search_dirs:
            if not sdir.exists():
                continue
            for fp in sdir.iterdir():
                if fp.is_file() and fp.suffix.lower() in ALLOWED_IMAGE_EXTS:
                    all_files.append(fp)

        if not all_files:
            return None

        for fp in all_files:
            stem_lower = fp.stem.lower()
            if any(tok in stem_lower for tok in query_tokens):
                return (str(fp), f"User Authorized Media ({fp.name})")

        return None

    async def fetch_wikimedia_image(
        self,
        query: str,
        cache_limit_gb: float = 15.0,
    ) -> dict[str, str] | None:
        """
        Query Wikimedia Commons API for permissively licensed (CC0 / Public Domain / CC-BY / CC-BY-SA)
        images matching `query`, caching locally by SHA-256.
        """
        clean_q = re.sub(r"[^a-zA-Z0-9\s-]", " ", query or "").strip()
        if not clean_q:
            return None

        # Check local SQLite cache first
        with get_session() as session:
            cached = session.exec(
                select(MediaCacheEntry).where(MediaCacheEntry.query_term == clean_q.lower())
            ).first()
            if cached and Path(cached.local_path).exists():
                cached.last_used_at = utc_now_iso()
                session.add(cached)
                session.commit()
                return {
                    "local_path": cached.local_path,
                    "attribution": cached.attribution,
                    "license": cached.license_type,
                    "source_url": cached.source_url,
                    "provider": cached.provider,
                }

        api_url = "https://commons.wikimedia.org/w/api.php"
        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f"filetype:bitmap {clean_q}",
            "gsrnamespace": "6",
            "gsrlimit": "5",
            "prop": "imageinfo",
            "iiprop": "url|extmetadata|dimensions",
            "iiurlwidth": "1080",
        }
        headers = {
            "User-Agent": "LocalShortsStudio/0.1.0 (https://localhost; local-first educational research)"
        }

        try:
            async with httpx.AsyncClient(timeout=8.0, headers=headers, follow_redirects=True) as client:
                resp = await client.get(api_url, params=params)
                if resp.status_code != 200:
                    return None
                pages = resp.json().get("query", {}).get("pages", {})
                for _page_id, page in pages.items():
                    ii_list = page.get("imageinfo", [])
                    if not ii_list:
                        continue
                    ii = ii_list[0]
                    ext = ii.get("extmetadata", {})
                    lic_short = str(ext.get("LicenseShortName", {}).get("value", "CC-BY-SA")).strip()
                    if not any(k in lic_short.lower() for k in ALLOWED_LICENSE_KEYWORDS):
                        continue

                    img_url = str(ii.get("thumburl") or ii.get("url") or "")
                    if not img_url:
                        continue
                    validate_external_url(img_url)

                    artist_raw = str(ext.get("Artist", {}).get("value", "Wikimedia Contributor"))
                    artist = re.sub(r"<[^>]+>", "", artist_raw).strip()[:60] or "Wikimedia Commons"

                    img_resp = await client.get(img_url)
                    if img_resp.status_code != 200 or len(img_resp.content) < 5_000:
                        continue
                    if len(img_resp.content) > 20 * 1024 * 1024:
                        continue

                    sha = compute_sha256_bytes(img_resp.content)
                    subdir = MEDIA_CACHE_DIR / sha[:2]
                    subdir.mkdir(parents=True, exist_ok=True)
                    ext_suffix = Path(sanitize_filename(img_url)).suffix or ".jpg"
                    if ext_suffix not in ALLOWED_IMAGE_EXTS:
                        ext_suffix = ".jpg"
                    local_file = subdir / f"{sha}{ext_suffix}"
                    local_file.write_bytes(img_resp.content)

                    attribution = f"Wikimedia Commons / {artist} ({lic_short})"
                    with get_session() as session:
                        existing = session.get(MediaCacheEntry, sha)
                        if not existing:
                            session.add(
                                MediaCacheEntry(
                                    sha256=sha,
                                    provider="wikimedia",
                                    source_url=img_url,
                                    query_term=clean_q.lower(),
                                    title=str(page.get("title", clean_q))[:120],
                                    license_type=lic_short,
                                    attribution=attribution,
                                    local_path=str(local_file),
                                    media_type="image",
                                    size_bytes=len(img_resp.content),
                                )
                            )
                            session.commit()

                    enforce_media_cache_limit(limit_gb=cache_limit_gb)
                    return {
                        "local_path": str(local_file),
                        "attribution": attribution,
                        "license": lic_short,
                        "source_url": img_url,
                        "provider": "wikimedia",
                    }
        except Exception as exc:
            logger.debug("Wikimedia Commons lookup skipped for '%s': %s", clean_q, exc)

        return None

    async def enrich_scenes_with_media(
        self,
        scenes: Sequence[ScenePlanItemSchema],
        enable_wikimedia: bool = True,
        authorized_media_dir: str = "",
        pexels_api_key: str = "",
        pixabay_api_key: str = "",
        cache_limit_gb: float = 15.0,
    ) -> tuple[list[ScenePlanItemSchema], list[dict[str, str]]]:
        """
        Attach local Authorized Media, Pexels, Pixabay, or Wikimedia Commons licensed stills
        to `media_composite` scenes while keeping procedural graphics as the primary/fallback engine.
        Returns (updated_scenes, media_attributions).
        """
        attributions: list[dict[str, str]] = []
        for scene in scenes:
            # 1. First check user-owned Authorized Media
            local_match = self.find_authorized_local_media(scene.visual_query, custom_dir=authorized_media_dir)
            if local_match:
                scene.media_asset_path, scene.media_attribution = local_match
                attributions.append(
                    {
                        "scene_index": str(scene.scene_index),
                        "provider": "authorized_local",
                        "path": scene.media_asset_path,
                        "attribution": scene.media_attribution,
                        "license": "User Authorized",
                    }
                )
                continue

            # 2. Check Pexels API if key provided
            if pexels_api_key and scene.visual_type == "media_composite":
                pexels_asset = await self.fetch_pexels_image(scene.visual_query, api_key=pexels_api_key, cache_limit_gb=cache_limit_gb)
                if pexels_asset:
                    scene.media_asset_path = pexels_asset["local_path"]
                    scene.media_attribution = pexels_asset["attribution"]
                    attributions.append(
                        {
                            "scene_index": str(scene.scene_index),
                            "provider": pexels_asset["provider"],
                            "source_url": pexels_asset["source_url"],
                            "attribution": pexels_asset["attribution"],
                            "license": pexels_asset["license"],
                        }
                    )
                    continue

            # 3. Check Pixabay API if key provided
            if pixabay_api_key and scene.visual_type == "media_composite":
                pixabay_asset = await self.fetch_pixabay_image(scene.visual_query, api_key=pixabay_api_key, cache_limit_gb=cache_limit_gb)
                if pixabay_asset:
                    scene.media_asset_path = pixabay_asset["local_path"]
                    scene.media_attribution = pixabay_asset["attribution"]
                    attributions.append(
                        {
                            "scene_index": str(scene.scene_index),
                            "provider": pixabay_asset["provider"],
                            "source_url": pixabay_asset["source_url"],
                            "attribution": pixabay_asset["attribution"],
                            "license": pixabay_asset["license"],
                        }
                    )
                    continue

            # 4. Check Wikimedia Commons (Free / Public Domain)
            if enable_wikimedia and scene.visual_type == "media_composite":
                wiki_asset = await self.fetch_wikimedia_image(
                    scene.visual_query,
                    cache_limit_gb=cache_limit_gb,
                )
                if wiki_asset:
                    scene.media_asset_path = wiki_asset["local_path"]
                    scene.media_attribution = wiki_asset["attribution"]
                    attributions.append(
                        {
                            "scene_index": str(scene.scene_index),
                            "provider": wiki_asset["provider"],
                            "source_url": wiki_asset["source_url"],
                            "attribution": wiki_asset["attribution"],
                            "license": wiki_asset["license"],
                        }
                    )

        return list(scenes), attributions
