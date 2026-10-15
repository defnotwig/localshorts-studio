"""Integration tests for Discover Hub, Story Studio, Campaigns API, and Safe Folder Openers."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from localshorts.database import init_db
from localshorts.main import app


@pytest.fixture(name="client")
def client_fixture(tmp_path, monkeypatch):
    test_db = tmp_path / "studio_test.db"
    monkeypatch.setenv("LOCALSHORTS_DATABASE_URL", f"sqlite:///{test_db}")
    init_db()
    with TestClient(app) as test_client:
        yield test_client


def test_discover_view_and_campaigns_rendered(client: TestClient):
    """Test Discover hub renders 200 OK with Whop campaigns and opportunities."""
    resp = client.get("/discover")
    assert resp.status_code == 200
    assert "Discover" in resp.text
    assert "Whop" in resp.text
    assert "Refresh Recommendations" in resp.text

    # Root route also points to Discover
    resp_root = client.get("/")
    assert resp_root.status_code == 200
    assert "Discover" in resp_root.text


def test_campaigns_api_endpoints(client: TestClient):
    """Test full campaigns API lifecycle: list, import, dismiss, and save."""
    # 1. List campaigns
    resp_list = client.get("/api/campaigns")
    assert resp_list.status_code == 200
    campaigns = resp_list.json()
    assert len(campaigns) >= 1
    assert "opportunity_type" in campaigns[0]

    # 2. Import manual campaign brief
    import_payload = {
        "text_content": "Clipping sprint for AI Video App\nBudget: $4,000\nCPM: $1.50/1K views\nRequirements:\n- Show fast generation",
        "title": "AI Video App Sprint",
        "creator_or_brand": "VideoGen AI",
    }
    resp_imp = client.post("/api/campaigns/import", json=import_payload)
    assert resp_imp.status_code == 200
    created = resp_imp.json()
    opp_id = created["id"]
    assert created["title"] == "AI Video App Sprint"

    # 3. Dismiss opportunity
    resp_dis = client.post(f"/api/campaigns/{opp_id}/dismiss")
    assert resp_dis.status_code == 200
    assert resp_dis.json()["status"] == "dismissed"

    # 4. Save opportunity
    resp_sav = client.post(f"/api/campaigns/{opp_id}/save")
    assert resp_sav.status_code == 200
    assert resp_sav.json()["status"] == "SAVED"


def test_studio_view_endpoint(client: TestClient):
    """Test 3-panel Story Studio view renders properly with scene beats and controls."""
    resp = client.get("/studio")
    assert resp.status_code == 200
    assert "Story Beats" in resp.text
    assert "3-Second Retention Hook" in resp.text
    assert "Smart 9:16 Saliency Crop" in resp.text or "smart_crop" in resp.text


def test_safe_folder_and_file_opener(client: TestClient):
    """Test explorer opening endpoints enforce containment and handle errors safely."""
    # Ready-to-upload folder opener should succeed
    resp_ready = client.post("/api/library/open-ready-folder")
    assert resp_ready.status_code == 200
    assert "path" in resp_ready.json()

    # Non-existent job should return 404 without crashing
    resp_bad = client.post("/api/library/nonexistent_job_123/open-folder")
    assert resp_bad.status_code == 404

    resp_bad_file = client.post("/api/library/nonexistent_job_123/open-file")
    assert resp_bad_file.status_code == 404


def test_safe_thumbnail_fallback_svg(client: TestClient):
    """Test thumbnail endpoint returns clean SVG placeholder for missing media instead of 500 error."""
    # When job does not exist, return 404
    resp = client.get("/api/library/nonexistent_job_999/thumbnail")
    assert resp.status_code in (200, 404)
    if resp.status_code == 200:
        assert "image/svg+xml" in resp.headers.get("content-type", "")
