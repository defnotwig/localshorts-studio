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
