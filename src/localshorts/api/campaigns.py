"""Campaign and Content Opportunity API endpoints for Whop clipping workflows."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from localshorts.database import get_session
from localshorts.models.db_models import ContentOpportunity
from localshorts.models.schemas import ContentOpportunitySchema
from localshorts.services.whop_provider import WhopProvider

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


class ImportCampaignRequest(BaseModel):
    text_content: str = Field(..., min_length=5)
    title: str = ""
    creator_or_brand: str = ""
    url: str = ""
    approved_assets_dir: str = ""


@router.get("", response_model=list[ContentOpportunitySchema])
async def list_campaigns() -> list[ContentOpportunitySchema]:
    """Return all content opportunities (Whop campaigns and creator trends)."""
    provider = WhopProvider()
    return provider.get_all_opportunities()


@router.post("/import", response_model=ContentOpportunitySchema)
async def import_campaign(payload: ImportCampaignRequest) -> ContentOpportunitySchema:
    """Parse, ingest, and register a user-provided Whop clipping campaign brief."""
    provider = WhopProvider()
    try:
        opp = provider.import_manual_campaign(
            text_content=payload.text_content,
            title=payload.title,
            creator_or_brand=payload.creator_or_brand,
            url=payload.url,
            approved_assets_dir=payload.approved_assets_dir,
        )
        return opp
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse campaign brief: {exc}")


@router.post("/{opp_id}/dismiss")
async def dismiss_opportunity(opp_id: str) -> dict[str, Any]:
    """Dismiss a campaign or trend opportunity so it no longer clutters Discover."""
    with get_session() as session:
        rec = session.get(ContentOpportunity, opp_id)
        if rec:
            rec.status = "DISMISSED"
            session.add(rec)
            session.commit()
    return {"status": "dismissed", "id": opp_id}


@router.post("/{opp_id}/save")
async def toggle_save_opportunity(opp_id: str) -> dict[str, Any]:
    """Toggle saved/starred status for an opportunity."""
    with get_session() as session:
        rec = session.get(ContentOpportunity, opp_id)
        if rec:
            new_status = "SAVED" if rec.status != "SAVED" else "DISCOVERED"
            rec.status = new_status
            session.add(rec)
            session.commit()
            return {"status": new_status, "id": opp_id}
    return {"status": "saved", "id": opp_id}
