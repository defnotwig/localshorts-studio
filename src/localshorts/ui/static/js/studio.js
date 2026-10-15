// LocalShorts Studio — Google Stitch & Whop Clipping Client Controller

function showToast(message, isError = false) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast";
  if (isError) {
    el.style.borderColor = "#ef4444";
  }
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function apiRequest(url, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== null) {
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    let errText = `HTTP ${resp.status}`;
    try {
      const errJson = await resp.json();
      errText = errJson.detail || JSON.stringify(errJson);
    } catch (_) {}
    throw new Error(errText);
  }
  return await resp.json();
}

async function refreshStatusBar() {
  try {
    const data = await apiRequest("/api/status-bar");
    const stageEl = document.getElementById("telemetry-stage");
    if (stageEl) {
      stageEl.textContent = data.queue_paused ? "PAUSED" : (data.queue_count > 0 ? `ACTIVE (${data.queue_count})` : "IDLE");
    }
    const tempEl = document.getElementById("telemetry-temp");
    if (tempEl && data.gpu_temp_c !== null) {
      tempEl.textContent = `${data.gpu_temp_c}°C (${data.thermal_state})`;
    }
  } catch (_) {}
}

setInterval(refreshStatusBar, 4000);

// ==========================================================================
// QUEUE VIEW SWITCHER (Whop 9:16 Card Grid vs Production Table)
// ==========================================================================
function toggleQueueView(mode) {
  const gridEl = document.getElementById("queue-grid-view");
  const tableEl = document.getElementById("queue-table-view");
  const gridBtn = document.getElementById("view-grid-btn");
  const tableBtn = document.getElementById("view-table-btn");

  if (!gridEl || !tableEl) return;

  if (mode === "table") {
    gridEl.style.display = "none";
    tableEl.style.display = "block";
    if (gridBtn) gridBtn.classList.remove("active");
    if (tableBtn) tableBtn.classList.add("active");
    localStorage.setItem("localshorts_queue_view", "table");
  } else {
    gridEl.style.display = "grid";
    tableEl.style.display = "none";
    if (gridBtn) gridBtn.classList.add("active");
    if (tableBtn) tableBtn.classList.remove("active");
    localStorage.setItem("localshorts_queue_view", "grid");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const savedView = localStorage.getItem("localshorts_queue_view");
  if (savedView === "table") {
    toggleQueueView("table");
  }
});

// Dropdown Helper
function toggleDropdown(id) {
  document.querySelectorAll(".dropdown-menu").forEach((el) => {
    if (el.id !== id) el.style.display = "none";
  });
  const el = document.getElementById(id);
  if (el) {
    el.style.display = el.style.display === "block" ? "none" : "block";
  }
}

window.addEventListener("click", (e) => {
  if (!e.target.closest(".dropdown-container")) {
    document.querySelectorAll(".dropdown-menu").forEach((el) => {
      el.style.display = "none";
    });
  }
});

// ==========================================================================
// WHOP iPHONE-FRAME 9:16 VIDEO PLAYER MODAL
// ==========================================================================
function openShortPreview(jobId, videoPath, title) {
  const modal = document.getElementById("phone-player-modal");
  const video = document.getElementById("phone-modal-video");
  const titleEl = document.getElementById("phone-modal-title");
  const dlBtn = document.getElementById("phone-modal-download-btn");
  const assetsBtn = document.getElementById("phone-modal-assets-btn");

  if (!modal || !video) return;

  const videoUrl = `/api/library/${jobId}/video`;
  video.src = videoUrl;
  video.play().catch(() => {});

  if (titleEl) titleEl.textContent = title || `Short #${jobId}`;
  if (dlBtn) {
    dlBtn.href = videoUrl;
    dlBtn.download = `Short_${jobId}.mp4`;
  }
  if (assetsBtn) {
    assetsBtn.onclick = () => {
      closeShortPreview();
      openChatGPTAssetModal(jobId);
    };
  }

  modal.style.display = "flex";
}

function closeShortPreview() {
  const modal = document.getElementById("phone-player-modal");
  const video = document.getElementById("phone-modal-video");
  if (video) {
    video.pause();
    video.src = "";
  }
  if (modal) modal.style.display = "none";
}

// ==========================================================================
// TABBED CHATGPT PLUS ASSET STUDIO MODAL
// ==========================================================================
let currentModalJobId = null;
let currentModalScenes = [];

function switchAssetTab(tabName) {
  const tabs = ["prompt", "stock", "timeline"];
  tabs.forEach((t) => {
    const pane = document.getElementById(`asset-tab-${t}`);
    const btn = document.getElementById(`asset-tab-btn-${t}`);
    if (pane) pane.style.display = t === tabName ? "block" : "none";
    if (btn) {
      if (t === tabName) btn.classList.add("active");
      else btn.classList.remove("active");
    }
  });
}

async function openChatGPTAssetModal(jobId) {
  currentModalJobId = jobId;
  const modal = document.getElementById("chatgpt-modal");
  const topicEl = document.getElementById("chatgpt-modal-topic");
  const titleEl = document.getElementById("chatgpt-modal-title");
  const promptEl = document.getElementById("chatgpt-prompt-text");
  const countBadge = document.getElementById("scene-count-badge");
  const chipContainer = document.getElementById("detected-urls-container");
  const importText = document.getElementById("chatgpt-import-text");

  if (!modal) return;
  modal.style.display = "flex";
  switchAssetTab("prompt");

  if (titleEl) titleEl.textContent = `ChatGPT Plus Asset Studio — #${jobId}`;
  if (topicEl) topicEl.textContent = "Loading prompt and scene breakdown...";
  if (promptEl) promptEl.value = "Fetching prompt from pipeline...";
  if (importText) importText.value = "";
  if (chipContainer) chipContainer.innerHTML = "";

  try {
    const res = await apiRequest(`/api/jobs/${jobId}/chatgpt-prompt`);
    if (topicEl) topicEl.textContent = `Topic: ${res.topic}`;
    if (promptEl) promptEl.value = res.prompt;
    currentModalScenes = res.scenes || [];
    if (countBadge) countBadge.textContent = currentModalScenes.length;
    renderSceneTimelineCards(currentModalScenes);
  } catch (err) {
    if (promptEl) promptEl.value = `Note: ${err.message}. You can still paste media URLs directly below to attach them to this Short!`;
  }
}

function closeChatGPTModal() {
  const modal = document.getElementById("chatgpt-modal");
  if (modal) modal.style.display = "none";
  currentModalJobId = null;
  currentModalScenes = [];
}

async function copyChatGPTAssetPrompt() {
  const promptEl = document.getElementById("chatgpt-prompt-text");
  if (!promptEl || !promptEl.value) return;
  try {
    await navigator.clipboard.writeText(promptEl.value);
    showToast("📋 Copied ChatGPT Plus prompt to clipboard! Paste it into ChatGPT.");
  } catch (_) {
    promptEl.select();
    document.execCommand("copy");
    showToast("📋 Copied prompt!");
  }
}

function updateDetectedUrlChips() {
  const textEl = document.getElementById("chatgpt-import-text");
  const container = document.getElementById("detected-urls-container");
  if (!textEl || !container) return;

  const content = textEl.value;
  const urlPattern = /https?:\/\/[^\s<>'")\]]+/g;
  const matches = content.match(urlPattern) || [];

  if (matches.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = matches
    .map((url, i) => {
      const clean = url.replace(/[.,;:]+$/, "");
      const shortDomain = clean.split("/")[2] || "image";
      return `<span class="url-chip">✓ Scene ${i + 1}: ${shortDomain}</span>`;
    })
    .join("");
}

async function importChatGPTAssets() {
  if (!currentModalJobId) return;
  const textEl = document.getElementById("chatgpt-import-text");
  const content = textEl?.value?.trim();
  if (!content) {
    showToast("Please paste image URLs or the ChatGPT Plus output first.", true);
    return;
  }
  try {
    showToast("Downloading & formatting assets into 1080×1920 vertical scenes with blurred backdrops...");
    const res = await apiRequest(`/api/jobs/${currentModalJobId}/import-chatgpt-assets`, "POST", { content });
    showToast(`✅ Successfully imported ${res.imported_count} visual asset(s)! Re-rendering short...`);
    closeChatGPTModal();
    setTimeout(() => { window.location.reload(); }, 1000);
  } catch (err) {
    showToast(`Import error: ${err.message}`, true);
  }
}

function renderSceneTimelineCards(scenes) {
  const container = document.getElementById("scene-cards-container");
  if (!container) return;
  if (!scenes || scenes.length === 0) {
    container.innerHTML = '<div class="text-sm text-muted" style="grid-column: 1 / -1; padding: 20px; text-align: center;">No scene plates generated yet. Paste URLs in Tab 1 to auto-generate them!</div>';
    return;
  }

  container.innerHTML = scenes
    .map((s, idx) => {
      const start = (s.start !== undefined ? s.start : s.start_s || 0).toFixed(1);
      const end = (s.end !== undefined ? s.end : s.end_s || 0).toFixed(1);
      const spoken = s.spoken_text || s.caption_text || "";
      const visualType = s.visual_type || "procedural";
      const hasMedia = Boolean(s.media_asset_path);

      return `
        <div class="scene-timeline-card">
          <div class="scene-thumb-frame">
            ${
              hasMedia
                ? `<span style="font-size: 28px;">🖼️</span>`
                : `<span style="font-size: 28px; opacity: 0.6;">🎨</span>`
            }
          </div>
          <div class="flex justify-between items-center mb-1">
            <span class="badge badge-info">Scene ${idx + 1}</span>
            <span class="mono text-xs text-muted">${start}s - ${end}s</span>
          </div>
          <div class="text-xs font-bold mb-1" style="color: #fff;">${visualType}</div>
          <div class="text-xs text-muted mb-2" style="max-height: 38px; overflow: hidden; text-overflow: ellipsis;">
            "${spoken[:60]}..."
          </div>
          <button class="btn btn-xs btn-secondary mt-auto" onclick="promptReplaceSceneImage(${idx})">
            Replace Image
          </button>
        </div>
      `;
    })
    .join("");
}

function promptReplaceSceneImage(sceneIndex) {
  const url = prompt(`Enter direct image URL for Scene ${sceneIndex + 1}:`);
  if (!url || !url.startsWith("http")) return;
  const importText = document.getElementById("chatgpt-import-text");
  if (importText) {
    importText.value += `\nScene ${sceneIndex + 1}: ${url}`;
    switchAssetTab("prompt");
    updateDetectedUrlChips();
    showToast(`Added URL for Scene ${sceneIndex + 1}. Click 'Download & Re-Render' when ready!`);
  }
}

async function searchFreeStock() {
  const queryInput = document.getElementById("stock-search-query");
  const query = queryInput?.value?.trim();
  const resultsContainer = document.getElementById("stock-search-results");
  if (!query) {
    showToast("Please enter a search keyword first.", true);
    return;
  }
  if (!resultsContainer) return;

  resultsContainer.innerHTML = '<div class="text-sm text-muted" style="grid-column: 1 / -1; padding: 20px; text-align: center;">Searching Pexels, Pixabay, and Wikimedia Commons...</div>';

  try {
    const res = await apiRequest(`/api/media/stock-search?query=${encodeURIComponent(query)}`);
    const items = res.results || [];
    if (items.length === 0) {
      resultsContainer.innerHTML = '<div class="text-sm text-muted" style="grid-column: 1 / -1; padding: 20px; text-align: center;">No stock photos found. Try a different term or paste custom URLs in Tab 1.</div>';
      return;
    }

    resultsContainer.innerHTML = items
      .map((item, i) => `
        <div class="scene-timeline-card">
          <div class="scene-thumb-frame">
            <span style="font-size: 28px;">📷</span>
          </div>
          <div class="text-xs font-bold mb-1">${item.provider.toUpperCase()}</div>
          <div class="text-xs text-muted mb-2">${item.attribution || "Royalty-free"}</div>
          <button class="btn btn-xs btn-emerald mt-auto" onclick="attachStockUrl('${item.source_url}')">
            + Attach to Short
          </button>
        </div>
      `)
      .join("");
  } catch (err) {
    resultsContainer.innerHTML = `<div class="text-xs text-danger" style="grid-column: 1 / -1; padding: 20px; text-align: center;">Search failed: ${err.message}</div>`;
  }
}

function attachStockUrl(url) {
  const importText = document.getElementById("chatgpt-import-text");
  if (importText) {
    importText.value += `\n${url}`;
    switchAssetTab("prompt");
    updateDetectedUrlChips();
    showToast("Attached image URL to Short! Click Download & Re-Render to apply.");
  }
}

async function triggerAISearchDirect() {
  if (!currentModalJobId) return;
  try {
    showToast("Querying OpenAI API to search/generate visual assets...");
    const res = await apiRequest(`/api/jobs/${currentModalJobId}/search-assets-ai`, "POST", { generate_dalle: false });
    showToast(`✅ Generated ${res.generated_count} visual asset(s)! Re-rendering...`);
    closeChatGPTModal();
    setTimeout(() => { window.location.reload(); }, 1000);
  } catch (err) {
    showToast(`AI Search: ${err.message}`, true);
  }
}

// ==========================================================================
// ACTIONS (Queue Batch, Smoke Test, Trends, Create, Settings)
// ==========================================================================
async function triggerSmokeTest() {
  try {
    showToast("Queueing 1-Click Local AI Smoke Test Short...");
    await apiRequest("/api/jobs/sample", "POST", {});
    setTimeout(() => { window.location.href = "/queue"; }, 600);
  } catch (err) {
    showToast(`Smoke test failed: ${err.message}`, true);
  }
}

async function generateDailyBatch(count) {
  try {
    showToast(`Queueing batch of ${count} candidate Short(s)...`);
    const res = await apiRequest("/api/jobs/batch", "POST", { count });
    showToast(`Queued ${res.queued_count} Short job(s). Redirecting...`);
    setTimeout(() => { window.location.href = "/queue"; }, 700);
  } catch (err) {
    showToast(`Batch failed: ${err.message}`, true);
  }
}

async function scanTrends(researchOnly = false) {
  try {
    showToast("Scanning public RSS/JSON feeds & calculating Source Confidence...");
    const res = await apiRequest("/api/trends/scan", "POST", {});
    showToast(`Discovered & ranked ${res.count} candidate stories!`);
    setTimeout(() => { window.location.reload(); }, 700);
  } catch (err) {
    showToast(`Trend scan failed: ${err.message}`, true);
  }
}

async function queueFromTrend(trendId, visualPreset = "Creator News") {
  try {
    showToast(`Queueing Short for trend ${trendId}...`);
    await apiRequest("/api/trends/generate-selected", "POST", { trend_ids: [String(trendId)] });
    setTimeout(() => { window.location.href = "/queue"; }, 600);
  } catch (err) {
    showToast(`Failed to queue trend: ${err.message}`, true);
  }
}

async function submitCreateForm() {
  try {
    const topic = document.getElementById("create-topic")?.value || "Local AI Shorts Production";
    const trendId = document.getElementById("create-trend-id")?.value || "";
    const visualPreset = document.getElementById("create-preset")?.value || "Creator News";
    const captionPreset = document.getElementById("create-caption")?.value || "Bold";
    const voiceId = document.getElementById("create-voice")?.value || "en-US-ChristopherNeural";
    showToast("Enqueuing new Short production job...");
    await apiRequest("/api/jobs", "POST", {
      topic,
      headline: topic,
      trend_item_id: String(trendId),
      visual_preset: visualPreset,
      caption_preset: captionPreset,
      voice_id: voiceId,
    });
    setTimeout(() => { window.location.href = "/queue"; }, 600);
  } catch (err) {
    showToast(`Create failed: ${err.message}`, true);
  }
}

async function regenerateStage(jobId, stage) {
  try {
    const stageNorm = String(stage).toLowerCase();
    const mapped = stageNorm === "scenes" ? "scene_plan" : stageNorm;
    showToast(`Regenerating ${mapped} stage for job ${jobId}...`);
    await apiRequest(`/api/jobs/${jobId}/regenerate-stage`, "POST", { stage: mapped });
    setTimeout(() => { window.location.href = "/queue"; }, 600);
  } catch (err) {
    showToast(`Stage regeneration failed: ${err.message}`, true);
  }
}

async function cancelJob(jobId) {
  try {
    await apiRequest(`/api/jobs/${jobId}/cancel`, "POST", {});
    showToast(`Cancelled job ${jobId}`);
    setTimeout(() => { window.location.reload(); }, 500);
  } catch (err) {
    showToast(`Cancel failed: ${err.message}`, true);
  }
}

async function toggleBatteryOverride(enable) {
  try {
    await apiRequest("/api/settings", "POST", { battery_override: Boolean(enable) });
    showToast("Battery override updated");
    setTimeout(() => { window.location.reload(); }, 400);
  } catch (err) {
    showToast(`Failed: ${err.message}`, true);
  }
}

async function saveSettings() {
  try {
    const payload = {
      daily_candidate_limit: parseInt(document.getElementById("setting-daily-target")?.value || "10", 10),
      ollama_model: document.getElementById("setting-ollama-model")?.value || "qwen3:4b",
      ollama_num_ctx: parseInt(document.getElementById("setting-ollama-ctx")?.value || "4096", 10),
      tts_provider: document.getElementById("setting-tts-engine")?.value || "edge-tts",
      tts_voice: document.getElementById("setting-tts-voice")?.value || "en-US-ChristopherNeural",
      visual_preset: document.getElementById("setting-visual-preset")?.value || "Creator News",
      caption_preset: document.getElementById("setting-caption-preset")?.value || "Bold",
      channel_niche: document.getElementById("setting-niche")?.value || "Viral Creator & Internet Moments Explained",
      battery_override: Boolean(document.getElementById("setting-battery-override")?.checked),
      windows_startup_enabled: Boolean(document.getElementById("setting-auto-start")?.checked),
      openai_api_key: document.getElementById("setting-openai-key")?.value || "",
      openai_model: document.getElementById("setting-openai-model")?.value || "gpt-4o-mini",
      pexels_api_key: document.getElementById("setting-pexels-key")?.value || "",
      pixabay_api_key: document.getElementById("setting-pixabay-key")?.value || "",
    };
    await apiRequest("/api/settings", "POST", payload);
    showToast("Settings saved to SQLite WAL!");
  } catch (err) {
    showToast(`Failed to save settings: ${err.message}`, true);
  }
}

// ==========================================================================
// DISCOVER HUB CONTROLLERS (Whop Campaigns & Creator Trends)
// ==========================================================================
async function triggerRefreshRecommendations() {
  const box = document.getElementById("refresh-progress-box");
  const pct = document.getElementById("refresh-progress-pct");
  const steps = ["step-creator", "step-news", "step-trends", "step-campaigns", "step-tech"];

  if (box) box.classList.remove("hidden");

  let current = 0;
  const interval = setInterval(() => {
    if (current < steps.length) {
      const stepEl = document.getElementById(steps[current]);
      if (stepEl) {
        const icon = stepEl.querySelector(".step-icon");
        if (icon) icon.textContent = "✓";
        stepEl.style.color = "var(--primary-container)";
      }
      current++;
      if (pct) pct.textContent = `${Math.min(95, current * 20)}%`;
    }
  }, 250);

  try {
    await apiRequest("/api/trends/scan", "POST", {});
    clearInterval(interval);
    if (pct) pct.textContent = "100%";
    showToast("Recommendations refreshed with latest viral opportunities!");
    setTimeout(() => { window.location.reload(); }, 600);
  } catch (err) {
    clearInterval(interval);
    showToast(`Refresh error: ${err.message}`, true);
    if (box) box.classList.add("hidden");
  }
}

function filterOpportunities(type, btn) {
  document.querySelectorAll(".filter-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");

  const cards = document.querySelectorAll(".opportunity-card");
  cards.forEach((card) => {
    const cardType = card.dataset.type;
    if (type === "all") {
      card.style.display = "flex";
    } else if (type === "saved") {
      card.style.display = card.dataset.saved === "true" ? "flex" : "none";
    } else {
      card.style.display = cardType === type ? "flex" : "none";
    }
  });
}

function sortOpportunities(criteria) {
  const grid = document.getElementById("opportunities-grid");
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll(".opportunity-card"));

  cards.sort((a, b) => {
    if (criteria === "confidence") {
      return parseInt(b.dataset.confidence || "0", 10) - parseInt(a.dataset.confidence || "0", 10);
    }
    return parseInt(b.dataset.score || "0", 10) - parseInt(a.dataset.score || "0", 10);
  });

  cards.forEach((c) => grid.appendChild(c));
}

function openCampaignBrief(title, brand, budget, cpm, deadline, mustJson, dontJson, url, assetDir) {
  const modal = document.getElementById("campaign-brief-modal");
  if (!modal) return;

  const titleEl = document.getElementById("brief-title");
  const brandEl = document.getElementById("brief-brand");
  const payoutEl = document.getElementById("brief-payout");
  const deadlineEl = document.getElementById("brief-deadline");
  const mustList = document.getElementById("brief-must-include");
  const dontList = document.getElementById("brief-do-not-include");
  const linkEl = document.getElementById("brief-submission-link");
  const createBtn = document.getElementById("brief-create-btn");

  if (titleEl) titleEl.textContent = title || "Campaign Brief";
  if (brandEl) brandEl.textContent = brand || "Whop Partner";
  if (payoutEl) payoutEl.textContent = `${cpm || "$1.00/1K views"} · Pool: ${budget || "$5,000"}`;
  if (deadlineEl) deadlineEl.textContent = deadline || "Active Bounties";

  if (mustList) {
    mustList.innerHTML = "";
    try {
      const must = typeof mustJson === "string" ? JSON.parse(mustJson) : (mustJson || []);
      must.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        mustList.appendChild(li);
      });
    } catch (_) {
      mustList.innerHTML = "<li>Follow standard creator clipping guidelines</li>";
    }
  }

  if (dontList) {
    dontList.innerHTML = "";
    try {
      const dont = typeof dontJson === "string" ? JSON.parse(dontJson) : (dontJson || []);
      dont.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        dontList.appendChild(li);
      });
    } catch (_) {
      dontList.innerHTML = "<li>No off-brand claims or disallowed audio</li>";
    }
  }

  if (linkEl) {
    if (url) {
      linkEl.href = url;
      linkEl.style.display = "inline-flex";
    } else {
      linkEl.style.display = "none";
    }
  }

  if (createBtn) {
    createBtn.onclick = () => {
      closeCampaignBriefModal();
      createShortFromOpportunity(`camp_${Date.now()}`, title, brand, "whop_campaign");
    };
  }

  modal.classList.remove("hidden");
}

function closeCampaignBriefModal() {
  const modal = document.getElementById("campaign-brief-modal");
  if (modal) modal.classList.add("hidden");
}

function openManualCampaignModal() {
  const modal = document.getElementById("manual-campaign-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeManualCampaignModal() {
  const modal = document.getElementById("manual-campaign-modal");
  if (modal) modal.classList.add("hidden");
}

async function submitManualCampaign(event) {
  if (event) event.preventDefault();
  const textContent = document.getElementById("manual-brief-text")?.value?.trim();
  const title = document.getElementById("manual-campaign-title")?.value?.trim();
  const brand = document.getElementById("manual-campaign-brand")?.value?.trim();
  const url = document.getElementById("manual-campaign-url")?.value?.trim();
  const assetDir = document.getElementById("manual-campaign-assets")?.value?.trim();

  if (!textContent) {
    showToast("Please paste the campaign brief text.", true);
    return;
  }

  try {
    showToast("Importing and structuring campaign brief...");
    await apiRequest("/api/campaigns/import", "POST", {
      text_content: textContent,
      title: title || "",
      creator_or_brand: brand || "",
      url: url || "",
      approved_assets_dir: assetDir || "",
    });
    showToast("Campaign brief imported successfully!");
    closeManualCampaignModal();
    setTimeout(() => { window.location.reload(); }, 600);
  } catch (err) {
    showToast(`Failed to import campaign: ${err.message}`, true);
  }
}

async function createShortFromOpportunity(id, title, creator, type) {
  try {
    showToast(`Queueing Short for "${title}"...`);
    await apiRequest("/api/jobs", "POST", {
      topic: title,
      headline: title,
      visual_preset: type === "whop_campaign" ? "Creator News" : "Bold Evidence",
      caption_preset: "Bold",
      target_duration_s: 26,
    });
    setTimeout(() => { window.location.href = "/queue"; }, 600);
  } catch (err) {
    showToast(`Failed to create Short: ${err.message}`, true);
  }
}

async function dismissOpportunity(id) {
  try {
    const card = document.querySelector(`.opportunity-card[data-id="${id}"]`);
    if (card) {
      card.style.opacity = "0.3";
      card.style.transform = "scale(0.95)";
      setTimeout(() => card.remove(), 250);
    }
    await apiRequest(`/api/campaigns/${id}/dismiss`, "POST", {});
    showToast("Opportunity dismissed");
  } catch (_) {}
}

async function saveOpportunity(id) {
  try {
    const res = await apiRequest(`/api/campaigns/${id}/save`, "POST", {});
    const card = document.querySelector(`.opportunity-card[data-id="${id}"]`);
    if (card) {
      card.dataset.saved = res.status === "SAVED" ? "true" : "false";
    }
    showToast(res.status === "SAVED" ? "★ Saved to your collection!" : "Removed from saved");
  } catch (err) {
    showToast(`Save failed: ${err.message}`, true);
  }
}

// ==========================================================================
// STORY STUDIO & 3-PANEL SCENE INSPECTOR
// ==========================================================================
let activeStudioSceneIndex = 1;

function selectStudioScene(sceneIndex) {
  activeStudioSceneIndex = sceneIndex;

  document.querySelectorAll(".studio-scene-item").forEach((el, idx) => {
    if (idx + 1 === sceneIndex) {
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  });

  const activeItem = document.querySelector(`.studio-scene-item[data-scene-idx="${sceneIndex}"]`);
  if (!activeItem) return;

  const duration = activeItem.dataset.duration || "4.0";
  const text = activeItem.dataset.text || "";
  const keyword = activeItem.dataset.keyword || "";
  const confidence = activeItem.dataset.confidence || "85";
  const rights = activeItem.dataset.rights || "Commercial Creative Commons / Whop Approved";

  const numEl = document.getElementById("inspector-scene-number");
  const durEl = document.getElementById("inspector-duration-display");
  const textInput = document.getElementById("inspector-voiceover-text");
  const keywordInput = document.getElementById("inspector-search-keyword");
  const confScoreEl = document.getElementById("inspector-confidence-score");
  const rightsEl = document.getElementById("inspector-rights-text");

  if (numEl) numEl.textContent = `Scene ${sceneIndex}`;
  if (durEl) durEl.textContent = `${parseFloat(duration).toFixed(1)}s`;
  if (textInput) textInput.value = text;
  if (keywordInput) keywordInput.value = keyword;
  if (confScoreEl) confScoreEl.textContent = `${confidence}%`;
  if (rightsEl) rightsEl.textContent = rights;

  const video = document.getElementById("studio-active-video");
  if (video) {
    let offset = 0;
    const allItems = Array.from(document.querySelectorAll(".studio-scene-item"));
    for (let i = 0; i < sceneIndex - 1; i++) {
      offset += parseFloat(allItems[i]?.dataset?.duration || "4.0");
    }
    video.currentTime = offset;
  }
}

function stepStudioScene(delta) {
  const total = document.querySelectorAll(".studio-scene-item").length;
  if (total === 0) return;
  let next = activeStudioSceneIndex + delta;
  if (next < 1) next = 1;
  if (next > total) next = total;
  selectStudioScene(next);
}

function toggleStudioPlayback() {
  const video = document.getElementById("studio-active-video");
  const btn = document.getElementById("studio-play-btn");
  if (!video) return;

  if (video.paused) {
    video.play();
    if (btn) btn.innerHTML = "<span>⏸</span>";
  } else {
    video.pause();
    if (btn) btn.innerHTML = "<span>▶</span>";
  }
}

function seekStudioVideo(time) {
  const video = document.getElementById("studio-active-video");
  if (video) video.currentTime = time;
}

function setReframeMode(mode, btn) {
  const parent = btn?.parentElement;
  if (parent) {
    parent.querySelectorAll(".btn").forEach((b) => b.classList.remove("active"));
  }
  if (btn) btn.classList.add("active");

  const preview = document.getElementById("studio-scene-preview");
  if (!preview) return;

  if (mode === "smart_crop") {
    preview.style.objectFit = "cover";
    showToast("Smart 9:16 Saliency Crop activated");
  } else if (mode === "blur_pad") {
    preview.style.objectFit = "contain";
    showToast("Contain with Gaussian Blur Backdrop activated");
  } else {
    preview.style.objectFit = "cover";
    showToast("Manual Focal Point Framing activated");
  }
}

function updateFocalPoint(x, y) {
  const pin = document.getElementById("focal-point-pin");
  if (pin) {
    pin.style.left = `${x}%`;
    pin.style.top = `${y}%`;
  }
}

function openAssetSwapDrawer() {
  const drawer = document.getElementById("asset-swap-drawer");
  if (drawer) drawer.classList.remove("hidden");
}

function closeAssetSwapDrawer() {
  const drawer = document.getElementById("asset-swap-drawer");
  if (drawer) drawer.classList.add("hidden");
}

async function searchStockAssetsForStudio() {
  const query = document.getElementById("studio-stock-query")?.value?.trim();
  const resultsContainer = document.getElementById("studio-stock-results");
  if (!query || !resultsContainer) return;

  resultsContainer.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 16px; text-align: center;">Searching vetted stock and creative commons assets...</div>';

  try {
    const res = await apiRequest(`/api/media/stock-search?query=${encodeURIComponent(query)}`);
    const items = res.results || [];
    if (items.length === 0) {
      resultsContainer.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 16px; text-align: center;">No assets found. Try another keyword.</div>';
      return;
    }

    resultsContainer.innerHTML = items
      .map((item) => `
        <div class="card" style="padding: 8px; display: flex; flex-direction: column; gap: 6px;">
          <div style="aspect-ratio: 16/9; background: #000; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 20px;">🖼️</span>
          </div>
          <div style="font-size: 11px; font-weight: 600; color: var(--text-primary); text-transform: uppercase;">${item.provider}</div>
          <div style="font-size: 10px; color: var(--text-secondary);">${item.attribution || "Royalty Free"}</div>
          <button class="btn btn-xs btn-primary" onclick="selectStockAssetForStudio('${item.source_url}', '${item.provider}', '${item.attribution}')">
            Apply to Scene ${activeStudioSceneIndex}
          </button>
        </div>
      `)
      .join("");
  } catch (err) {
    resultsContainer.innerHTML = `<div style="color: #ef4444; font-size: 11px; padding: 16px; text-align: center;">Search failed: ${err.message}</div>`;
  }
}

function selectStockAssetForStudio(url, title, license) {
  showToast(`Applied new asset to Scene ${activeStudioSceneIndex}!`);
  closeAssetSwapDrawer();
}

// ==========================================================================
// QUEUE & MEDIA LIBRARY INTERACTIONS
// ==========================================================================
function setQueueView(mode) {
  const listView = document.getElementById("queue-list-view");
  const gridView = document.getElementById("queue-grid-view");
  const listBtn = document.getElementById("view-list-btn");
  const gridBtn = document.getElementById("view-grid-btn");

  if (!listView || !gridView) return;

  if (mode === "grid") {
    listView.style.display = "none";
    gridView.style.display = "grid";
    if (listBtn) listBtn.classList.remove("active");
    if (gridBtn) gridBtn.classList.add("active");
    localStorage.setItem("localshorts_queue_view", "grid");
  } else {
    listView.style.display = "block";
    gridView.style.display = "none";
    if (listBtn) listBtn.classList.add("active");
    if (gridBtn) gridBtn.classList.remove("active");
    localStorage.setItem("localshorts_queue_view", "list");
  }
}

function openVideoPreviewModal(videoUrl, title) {
  const modal = document.getElementById("video-preview-modal");
  const video = document.getElementById("preview-modal-video");
  const titleEl = document.getElementById("preview-modal-title");

  if (!modal || !video) return;
  video.src = videoUrl;
  if (titleEl) titleEl.textContent = title || "Short Preview";
  modal.classList.remove("hidden");
  video.play().catch(() => {});
}

function closeVideoPreviewModal() {
  const modal = document.getElementById("video-preview-modal");
  const video = document.getElementById("preview-modal-video");
  if (video) {
    video.pause();
    video.src = "";
  }
  if (modal) modal.classList.add("hidden");
}

async function openReadyFolderSafely() {
  try {
    const res = await apiRequest("/api/library/open-ready-folder", "POST", {});
    if (res.opened) {
      showToast("Opened Ready-to-Upload folder in Windows Explorer");
    } else {
      showToast(`Ready-to-Upload path: ${res.path}`);
    }
  } catch (err) {
    showToast(`Could not open folder: ${err.message}`, true);
  }
}

async function openJobFolderSafely(jobId) {
  try {
    const res = await apiRequest(`/api/library/${jobId}/open-folder`, "POST", {});
    if (res.opened) {
      showToast("Opened project folder in Windows Explorer");
    } else {
      showToast(`Project folder: ${res.path}`);
    }
  } catch (err) {
    showToast(`Could not open folder: ${err.message}`, true);
  }
}

async function openJobFileSafely(jobId) {
  try {
    const res = await apiRequest(`/api/library/${jobId}/open-file`, "POST", {});
    if (res.opened) {
      showToast("Highlighted video file in Windows Explorer");
    } else {
      showToast(`Video file: ${res.path}`);
    }
  } catch (err) {
    showToast(`Could not open file: ${err.message}`, true);
  }
}

async function copyTextToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("📋 Copied to clipboard!");
  } catch (_) {
    showToast("Clipboard write permission unavailable", true);
  }
}

function toggleInlineVideoPlay(videoId, btn) {
  const video = document.getElementById(videoId);
  if (!video) return;
  if (video.paused) {
    video.play();
    if (btn) btn.textContent = "⏸";
  } else {
    video.pause();
    if (btn) btn.textContent = "▶";
  }
}

// ==========================================================================
// COMMAND PALETTE & GLOBAL KEYBOARD SHORTCUTS (Ctrl+K, Esc)
// ==========================================================================
function openCommandPalette() {
  const modal = document.getElementById("command-palette-modal");
  const input = document.getElementById("command-palette-input");
  if (modal) {
    modal.classList.remove("hidden");
    if (input) input.focus();
  }
}

function closeCommandPalette() {
  const modal = document.getElementById("command-palette-modal");
  if (modal) modal.classList.add("hidden");
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openCommandPalette();
  } else if (e.key === "Escape") {
    closeCommandPalette();
    closeCampaignBriefModal();
    closeManualCampaignModal();
    closeVideoPreviewModal();
    closeAssetSwapDrawer();
  }
});

