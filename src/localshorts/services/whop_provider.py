"""Whop and Creator Campaign Provider architecture for LocalShorts Studio.

Implements structured campaign discovery, manual brief import, local asset ingestion,
and strict labeling of demo vs verified campaigns.
"""

from __future__ import annotations

import json
import re
import uuid
from abc import ABC, abstractmethod

from sqlmodel import select

from localshorts.database import get_session
from localshorts.logging_config import get_logger
from localshorts.models.db_models import ContentOpportunity, TrendItem, utc_now_iso
from localshorts.models.schemas import (
    CampaignMetadata,
    ContentOpportunitySchema,
    OpportunityType,
    TrendMetadata,
)

logger = get_logger("campaign_provider")


class BaseCampaignProvider(ABC):
    @abstractmethod
    def list_campaigns(self) -> list[ContentOpportunitySchema]:
        """Return list of opportunities provided by this source."""
        pass


class ManualCampaignProvider(BaseCampaignProvider):
    """Parses user-pasted campaign briefs or URLs into structured ContentOpportunity records."""

    def parse_campaign_brief(
        self,
        text_content: str,
        title: str = "",
        creator_or_brand: str = "",
        url: str = "",
        approved_assets_dir: str = "",
    ) -> ContentOpportunitySchema:
        lines = [line.strip() for line in text_content.splitlines() if line.strip()]

        must_include: list[str] = []
        do_not_include: list[str] = []
        budget = "$5,000"
        cpm_rate = "$1.00 / 1K views"
        platforms = ["YouTube Shorts", "TikTok", "Instagram Reels"]
        deadline = "Active Bounties"

        current_section = None
        for line in lines:
            lower = line.lower()
            is_bullet = line.startswith(("-", "•", "*"))
            if not is_bullet:
                if "must include" in lower or "requirements" in lower:
                    current_section = "must"
                    continue
                elif "do not" in lower or "forbidden" in lower or "restrictions" in lower or "disallowed" in lower:
                    current_section = "dont"
                    continue
                elif "cpm" in lower or "reward" in lower or "payout" in lower:
                    cpm_match = re.search(r"\$\d+(?:\.\d+)?(?:\s*/\s*(?:1k|1000)\s*views)?", line, re.I)
                    if cpm_match:
                        cpm_rate = cpm_match.group(0)
                    continue
                elif "budget" in lower:
                    b_match = re.search(r"\$\d+(?:,\d+)*(?:\.\d+)?", line)
                    if b_match:
                        budget = b_match.group(0)
                    continue

            if current_section == "must" and is_bullet:
                must_include.append(line.lstrip("-•* ").strip())
            elif current_section == "dont" and is_bullet:
                do_not_include.append(line.lstrip("-•* ").strip())

        opp_id = f"camp_{uuid.uuid4().hex[:10]}"
        inferred_title = title or (lines[0] if lines else "Custom Creator Clipping Campaign")
        inferred_creator = creator_or_brand or "Whop Campaign Partner"

        meta = CampaignMetadata(
            budget=budget,
            cpm_rate=cpm_rate,
            platforms=platforms,
            deadline=deadline,
            must_include=must_include or ["Include campaign hashtag in description", "Use approved visual b-roll"],
            do_not_include=do_not_include or ["No vulgarity", "No off-brand claims"],
            approved_assets_dir=str(approved_assets_dir or ""),
            submission_url=url,
            campaign_status="OPEN",
            is_demo=False,
        )

        return ContentOpportunitySchema(
            id=opp_id,
            opportunity_type=OpportunityType.WHOP_CAMPAIGN,
            title=inferred_title,
            creator_or_brand=inferred_creator,
            headline=inferred_title,
            summary=f"Clipping campaign for {inferred_creator} with {cpm_rate} reward rate.",
            url=url,
            source_confidence=95,
            opportunity_score=90,
            created_at=utc_now_iso(),
            status="ACTIVE",
            campaign=meta,
        )

    def list_campaigns(self) -> list[ContentOpportunitySchema]:
        return []


class CuratedDemoCampaignProvider(BaseCampaignProvider):
    """
    Supplies explicitly labeled 'DEMO' reference campaigns so creators can immediately inspect
    brief formatting, rules, and approved media structures without misleading them into thinking
    these are active financial commitments.
    """

    def list_campaigns(self) -> list[ContentOpportunitySchema]:
        return [
            ContentOpportunitySchema(
                id="demo_camp_speed_expedia",
                opportunity_type=OpportunityType.WHOP_CAMPAIGN,
                title="IShowSpeed x Global Tour Travel Clips",
                creator_or_brand="IShowSpeed (DEMO)",
                headline="IShowSpeed Across Asia: Viral Travel Challenge Moments",
                summary="Clip and produce high-retention 9:16 Shorts covering Speed's viral cultural interactions and tour highlights.",
                url="https://whop.com/explore/creator-rewards",
                source_confidence=92,
                opportunity_score=94,
                created_at=utc_now_iso(),
                status="ACTIVE",
                campaign=CampaignMetadata(
                    budget="$10,000 Total Pool",
                    cpm_rate="$1.20 / 1K views",
                    platforms=["YouTube Shorts", "TikTok", "Instagram Reels"],
                    deadline="DEMO REFERENCE",
                    must_include=[
                        "Hook within first 3 seconds with on-screen kinetic text",
                        "Feature Speed's reaction highlight clearly in vertical center",
                        "Include #SpeedTour in title or description",
                    ],
                    do_not_include=[
                        "Do not include dangerous stunts or offensive commentary",
                        "Do not use copyrighted music outside fair use",
                    ],
                    approved_assets_dir="assets/campaigns/speed_tour",
                    submission_url="https://whop.com/hub/submit",
                    campaign_status="DEMO",
                    is_demo=True,
                ),
            ),
            ContentOpportunitySchema(
                id="demo_camp_beast_games",
                opportunity_type=OpportunityType.WHOP_CAMPAIGN,
                title="Creator Challenge & Extreme Games Breakdown",
                creator_or_brand="Beast Contests (DEMO)",
                headline="Inside the Largest Creator Arena Challenges: Secret Strategies",
                summary="Produce factual explainer Shorts breaking down the rules, engineering, and elimination moments of major creator challenges.",
                url="https://whop.com/explore/creator-rewards",
                source_confidence=95,
                opportunity_score=91,
                created_at=utc_now_iso(),
                status="ACTIVE",
                campaign=CampaignMetadata(
                    budget="$15,000 Total Pool",
                    cpm_rate="$1.50 / 1K views",
                    platforms=["YouTube Shorts", "TikTok"],
                    deadline="DEMO REFERENCE",
                    must_include=[
                        "Clear factual breakdown of contestant strategies",
                        "Visual graphic showing budget / prize breakdown in scene 2",
                        "Clean sound effect on hook reveal",
                    ],
                    do_not_include=[
                        "No unverified leak rumors",
                        "No derogatory contestant bashing",
                    ],
                    approved_assets_dir="assets/campaigns/beast_games",
                    submission_url="https://whop.com/hub/submit",
                    campaign_status="DEMO",
                    is_demo=True,
                ),
            ),
        ]


class WhopProvider:
    """Unified service for discovering and managing ContentOpportunity records."""

    def __init__(self) -> None:
        self.manual_provider = ManualCampaignProvider()
        self.demo_provider = CuratedDemoCampaignProvider()

    def get_all_opportunities(self) -> list[ContentOpportunitySchema]:
        """Aggregate opportunities from ContentOpportunity table, falling back to TrendItems and Demos."""
        opportunities: list[ContentOpportunitySchema] = []

        with get_session() as session:
            # 1. Fetch native ContentOpportunity records
            records = list(
                session.exec(
                    select(ContentOpportunity)
                    .where(ContentOpportunity.status != "DISMISSED")
                    .order_by(ContentOpportunity.opportunity_score.desc())
                ).all()
            )

            for rec in records:
                camp_meta = None
                trend_meta = None
                if rec.campaign_metadata_json and rec.campaign_metadata_json != "{}":
                    try:
                        camp_meta = CampaignMetadata.model_validate_json(rec.campaign_metadata_json)
                    except Exception:
                        pass
                if rec.trend_metadata_json and rec.trend_metadata_json != "{}":
                    try:
                        trend_meta = TrendMetadata.model_validate_json(rec.trend_metadata_json)
                    except Exception:
                        pass

                opportunities.append(
                    ContentOpportunitySchema(
                        id=rec.id,
                        opportunity_type=OpportunityType(rec.opportunity_type)
                        if rec.opportunity_type in OpportunityType._value2member_map_
                        else OpportunityType.CREATOR_TREND,
                        title=rec.title or rec.headline,
                        creator_or_brand=rec.creator_or_brand,
                        headline=rec.headline,
                        summary=rec.summary,
                        url=rec.url,
                        source_confidence=rec.source_confidence,
                        opportunity_score=rec.opportunity_score,
                        created_at=rec.created_at,
                        status=rec.status,
                        campaign=camp_meta,
                        trend=trend_meta,
                    )
                )

            # 2. Add curated reference demo campaigns so Discover always includes verified opportunities
            existing_ids = {o.id for o in opportunities}
            demos = self.demo_provider.list_campaigns()
            for d in demos:
                if d.id not in existing_ids:
                    opportunities.append(d)

            # 3. If trend items exist in legacy table and not in opportunities, map them cleanly
            if not any(o.opportunity_type == OpportunityType.CREATOR_TREND for o in opportunities):
                trends = list(
                    session.exec(
                        select(TrendItem)
                        .where(TrendItem.status != "IGNORED")
                        .order_by(TrendItem.trend_score.desc())
                        .limit(20)
                    ).all()
                )
                for t in trends:
                    try:
                        reasons = json.loads(t.reasons_json or "[]")
                    except Exception:
                        reasons = []
                    t_meta = TrendMetadata(
                        velocity_score=min(100, int(round(t.outlier_multiplier * 50))),
                        outlier_multiplier=t.outlier_multiplier,
                        reasons=reasons,
                        sources_count=t.sources_count,
                    )
                    opportunities.append(
                        ContentOpportunitySchema(
                            id=f"opp_{t.id}",
                            opportunity_type=OpportunityType.CREATOR_TREND,
                            title=t.headline,
                            creator_or_brand=t.creator or "Creator Network",
                            headline=t.headline,
                            summary=" · ".join(reasons) if reasons else t.headline,
                            url=t.url,
                            source_confidence=t.source_confidence or 75,
                            opportunity_score=t.trend_score,
                            created_at=t.published_at or t.discovered_at,
                            status=t.status,
                            trend=t_meta,
                        )
                    )

        return opportunities

    def import_manual_campaign(
        self,
        text_content: str,
        title: str = "",
        creator_or_brand: str = "",
        url: str = "",
        approved_assets_dir: str = "",
    ) -> ContentOpportunitySchema:
        """Parse, persist, and return a new manual campaign."""
        opp_schema = self.manual_provider.parse_campaign_brief(
            text_content=text_content,
            title=title,
            creator_or_brand=creator_or_brand,
            url=url,
            approved_assets_dir=approved_assets_dir,
        )

        with get_session() as session:
            record = ContentOpportunity(
                id=opp_schema.id,
                opportunity_type=opp_schema.opportunity_type.value,
                title=opp_schema.title,
                creator_or_brand=opp_schema.creator_or_brand,
                headline=opp_schema.headline,
                summary=opp_schema.summary,
                url=opp_schema.url,
                source_confidence=opp_schema.source_confidence,
                opportunity_score=opp_schema.opportunity_score,
                created_at=opp_schema.created_at,
                status=opp_schema.status,
                campaign_metadata_json=opp_schema.campaign.model_dump_json() if opp_schema.campaign else "{}",
                trend_metadata_json="{}",
            )
            session.add(record)
            session.commit()

        return opp_schema
