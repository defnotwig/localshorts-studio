"""Unit tests for Content Opportunities, Whop campaign providers, and brief parsing."""

from __future__ import annotations

import pytest

from localshorts.database import init_db
from localshorts.models.schemas import (
    CampaignMetadata,
    ContentOpportunitySchema,
    OpportunityType,
    TrendMetadata,
)
from localshorts.services.whop_provider import (
    CuratedDemoCampaignProvider,
    ManualCampaignProvider,
    WhopProvider,
)


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path, monkeypatch):
    test_db = tmp_path / "opp_test.db"
    monkeypatch.setenv("LOCALSHORTS_DATABASE_URL", f"sqlite:///{test_db}")
    init_db()


def test_content_opportunity_model_separation():
    """Verify campaign and trend metadata schemas remain clean and mutually distinct."""
    camp_meta = CampaignMetadata(
        budget="$10,000",
        cpm_rate="$1.50 / 1K views",
        platforms=["YouTube Shorts", "TikTok"],
        deadline="2026-11-01",
        must_include=["Include #WhopCreator in description"],
        do_not_include=["No misleading earnings guarantees"],
        is_demo=True,
    )
    opp = ContentOpportunitySchema(
        id="opp_camp_01",
        opportunity_type=OpportunityType.WHOP_CAMPAIGN,
        title="Whop SaaS Clipping Bounty",
        creator_or_brand="Whop Creator Fund",
        headline="Top 10 SaaS builders on Whop",
        summary="High-retention software clips",
        campaign=camp_meta,
    )
    assert opp.opportunity_type == OpportunityType.WHOP_CAMPAIGN
    assert opp.campaign is not None
    assert opp.trend is None
    assert opp.campaign.budget == "$10,000"
    assert opp.campaign.is_demo is True

    trend_meta = TrendMetadata(
        velocity_score=85,
        outlier_multiplier=2.4,
        reasons=["Sudden velocity spike on YouTube"],
        sources_count=3,
    )
    opp_trend = ContentOpportunitySchema(
        id="opp_trend_01",
        opportunity_type=OpportunityType.CREATOR_TREND,
        title="MrBeast Beast Games Studio Record",
        creator_or_brand="MrBeast",
        headline="Massive logistics leak revealed",
        summary="Entertainment production deep dive",
        trend=trend_meta,
    )
    assert opp_trend.opportunity_type == OpportunityType.CREATOR_TREND
    assert opp_trend.trend is not None
    assert opp_trend.campaign is None
    assert opp_trend.trend.velocity_score == 85


def test_curated_demo_campaigns_marked_demo():
    """Verify curated reference campaigns are always explicitly marked DEMO."""
    provider = CuratedDemoCampaignProvider()
    campaigns = provider.list_campaigns()
    assert len(campaigns) >= 2
    for camp in campaigns:
        assert camp.opportunity_type == OpportunityType.WHOP_CAMPAIGN
        assert camp.campaign is not None
        assert camp.campaign.is_demo is True
        assert "DEMO" in camp.campaign.campaign_status.upper() or camp.campaign.is_demo


def test_manual_campaign_brief_parser():
    """Test parsing user-provided campaign briefs with custom requirements and payout rates."""
    provider = ManualCampaignProvider()
    brief_text = """
    Whop AI Software Clipping Sprint
    Budget: $7,500 total pool
    Payout: $1.25 / 1k views
    Requirements:
    - Must feature the software dashboard in the first 4 seconds
    - Must include the verified link in bio
    Restrictions:
    - Do not show competitor logos
    - No vulgar audio
    """
    opp = provider.parse_campaign_brief(
        text_content=brief_text,
        title="Whop AI Clipping Sprint",
        creator_or_brand="SaaS Growth Labs",
        url="https://whop.com/campaigns/saas-growth",
    )
    assert opp.title == "Whop AI Clipping Sprint"
    assert opp.creator_or_brand == "SaaS Growth Labs"
    assert opp.campaign is not None
    assert opp.campaign.is_demo is False
    assert opp.campaign.budget == "$7,500"
    assert "1.25" in opp.campaign.cpm_rate
    assert any("first 4 seconds" in req for req in opp.campaign.must_include)
    assert any("competitor logos" in restr for restr in opp.campaign.do_not_include)


def test_whop_provider_aggregation():
    """Test unified provider aggregates opportunities and preserves high confidence."""
    provider = WhopProvider()
    opportunities = provider.get_all_opportunities()
    assert len(opportunities) >= 2
    types = {o.opportunity_type for o in opportunities}
    assert OpportunityType.WHOP_CAMPAIGN in types
    for opp in opportunities:
        assert 0 <= opp.source_confidence <= 100
        assert opp.title != ""


def test_whop_provider_manual_import_and_persist(tmp_path):
    """Test manual brief import persists into ContentOpportunity table."""
    provider = WhopProvider()
    sample_brief = """
    E-Commerce Clipping Championship
    Budget: $3,000
    Reward: $2.00 / 1000 views
    Requirements:
    • Show real store revenue dashboard
    """
    opp = provider.import_manual_campaign(
        text_content=sample_brief,
        title="E-Commerce Championship",
        creator_or_brand="Dropship Elite",
    )
    assert opp.id.startswith("camp_")
    assert opp.title == "E-Commerce Championship"

    # Verify it can be listed back
    all_opps = provider.get_all_opportunities()
    matched = [o for o in all_opps if o.id == opp.id]
    assert len(matched) == 1
    assert matched[0].creator_or_brand == "Dropship Elite"
    assert matched[0].campaign.is_demo is False
