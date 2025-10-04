/**
 * js/researchers.js
 * Полный скрипт страницы "For Researchers".
 * - Валидирует форму
 * - (опционально) логирует входы в Google Sheets (если настроено)
 * - Запускает polling к одной Google Sheet и показывает procent как только он появится
 *
 * NOTE: если хочешь fallback на локальный mockInfer — выставь USE_MOCK_FALLBACK = true
 */

const USE_MOCK_FALLBACK = false; // если true — показываем mockInfer результат после таймаута

/* ---------- State & DOM refs ---------- */
let processingInProgress = false;
let currentResults = null;
let currentFormData = null;

let formEl,
  processingSection,
  progressBar,
  progressPercentage,
  progressText,
  resultsSection,
  probabilityDisplay,
  summaryText,
  commentsContainer;

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initElements();
  attachListeners();
});

function initElements() {
  formEl = document.getElementById("exoplanetForm");

  processingSection = document.getElementById("processingSection");
  progressBar = document.getElementById("progressBar");
  progressPercentage = document.getElementById("progressPercentage");
  progressText = document.getElementById("progressText");

  resultsSection = document.getElementById("resultsSection");
  probabilityDisplay = document.getElementById("probabilityDisplay");
  summaryText = document.getElementById("summaryText");
  commentsContainer = document.getElementById("commentsContainer");
}

function attachListeners() {
  if (formEl) formEl.addEventListener("submit", handleFormSubmit);
}

/* ---------- Form handling ---------- */
async function handleFormSubmit(e) {
  e.preventDefault();
  if (processingInProgress) return;

  const fd = new FormData(formEl);
  const data = {};
  for (const [k, v] of fd.entries()) data[k] = v;

  const required = [
    "object_id",
    "transit_depth",
    "orbital_period",
    "transit_duration",
    "snr",
    "planet_radius",
    "semi_major_axis",
    "eq_temperature",
    "impact_parameter",
    "stellar_radius",
    "stellar_mass",
    "stellar_temp",
    "stellar_magnitude",
  ];

  const missing = required.filter((f) => !data[f] && data[f] !== 0);
  if (missing.length > 0) {
    const msg = `Please fill required fields: ${missing.join(", ")}`;
    if (window.utils && typeof window.utils.showAlert === "function")
      window.utils.showAlert(msg, "error", document.querySelector("main"));
    else alert(msg);
    return;
  }

  currentFormData = data;
  await processData(data);
}

/* ---------- Core process (polling) ---------- */
async function processData(data) {
  processingInProgress = true;

  // hide old results
  if (resultsSection) resultsSection.style.display = "none";

  // show waiting UI
  startWaitingUI();

  try {
    // Optional: log submission to sheets if endpoint configured (best-effort)
    if (window.api && typeof window.api.logToGoogleSheets === "function") {
      // fire-and-forget
      window.api
        .logToGoogleSheets(data)
        .then((ok) => {
          if (ok) console.log("Submission logged (optional).");
        })
        .catch((err) =>
          console.warn(
            "Optional logging failed:",
            err && err.message ? err.message : err
          )
        );
    }

    // Poll server responses by object_id
    const pollOptions = {
      interval: 10000,
      timeout: 120000, // 2 minutes
      onPending: () => updateWaitingText("Waiting for server response..."),
      onError: (err) =>
        updateWaitingText("Network issue while polling. Retrying..."),
    };

    let serverResp = null;
    try {
      serverResp = await window.api.pollServerResponse(
        data.object_id,
        pollOptions
      );
    } catch (err) {
      console.warn(
        "Polling finished with error/timeout:",
        err && err.message ? err.message : err
      );
    }

    if (serverResp && typeof serverResp.procent === "number") {
      const probability = Math.max(0, Math.min(1, serverResp.procent / 100));
      const results = {
        probability,
        summary: "Server analysis result (from Google Sheet).",
        data_comments: [
          `Server-provided procent: ${serverResp.procent}%`,
          serverResp.timestamp
            ? `Timestamp: ${serverResp.timestamp}`
            : "No timestamp provided",
        ],
      };

      currentResults = results;
      displayResults(results);
      stopWaitingUI();
      if (resultsSection) {
        resultsSection.style.display = "block";
        resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } else {
      // no server response within timeout
      stopWaitingUI();

      if (USE_MOCK_FALLBACK) {
        // fallback: show mock result
        const mock = await window.api.mockInfer(data);
        mock.summary = "[LOCAL MOCK - fallback] " + mock.summary;
        currentResults = mock;
        displayResults(mock);
        if (resultsSection) resultsSection.style.display = "block";
        if (window.utils && typeof window.utils.showAlert === "function") {
          window.utils.showAlert(
            "No server response in time — showing local mock result.",
            "warning",
            document.querySelector("main")
          );
        } else {
          alert("No server response in time — showing local mock result.");
        }
      } else {
        // inform user no server response
        const msg =
          "No response received from server within timeout. Please try again later.";
        if (window.utils && typeof window.utils.showAlert === "function")
          window.utils.showAlert(
            msg,
            "warning",
            document.querySelector("main")
          );
        else alert(msg);
        updateWaitingText("No response received from server.");
      }
    }
  } catch (err) {
    console.error("processData error:", err);
    stopWaitingUI();
    const msg = `Processing error: ${err.message || err}`;
    if (window.utils && typeof window.utils.showAlert === "function")
      window.utils.showAlert(msg, "error", document.querySelector("main"));
    else alert(msg);
  } finally {
    processingInProgress = false;
  }
}

/* ---------- UI helpers ---------- */

function startWaitingUI() {
  if (!processingSection) return;
  processingSection.style.display = "block";
  progressBar.style.width = "0%";
  progressPercentage.textContent = "0%";
  progressText.textContent = "Waiting for server response...";

  let pct = 5;
  processingSection._animInterval = setInterval(() => {
    pct = (pct + 7) % 95;
    progressBar.style.width = pct + "%";
    progressPercentage.textContent = Math.round(pct) + "%";
  }, 700);
}

function updateWaitingText(text) {
  if (progressText) progressText.textContent = text;
}

function stopWaitingUI() {
  if (!processingSection) return;
  processingSection.style.display = "none";
  if (processingSection._animInterval) {
    clearInterval(processingSection._animInterval);
    processingSection._animInterval = null;
  }
}

/* ---------- Display results ---------- */
function displayResults(results) {
  if (!results) return;

  if (probabilityDisplay) {
    const percent = Math.round((results.probability || 0) * 1000) / 10; // one decimal
    probabilityDisplay.textContent = percent + "%";
    probabilityDisplay.setAttribute(
      "aria-label",
      `${percent} percent probability of exoplanet detection`
    );
  }

  if (summaryText) summaryText.textContent = results.summary || "";

  if (commentsContainer) {
    commentsContainer.innerHTML = "";
    const ul = document.createElement("ul");
    (results.data_comments || []).forEach((c) => {
      const li = document.createElement("li");
      li.textContent = c;
      ul.appendChild(li);
    });
    commentsContainer.appendChild(ul);
  }

  announceResults(results);
}

function announceResults(results) {
  const live = document.getElementById("resultsAnnounce");
  if (!live) return;
  const percent = Math.round((results.probability || 0) * 100);
  live.textContent = `Analysis complete. ${percent} percent probability of exoplanet detection. ${
    results.summary || ""
  }`;
}

/* ---------- Actions: download/copy/reset ---------- */

function downloadResults() {
  if (!currentResults || !currentFormData) return;
  const payload = {
    object_id: currentFormData.object_id,
    analysis_date: new Date().toISOString(),
    input_parameters: currentFormData,
    probability: currentResults.probability,
    summary: currentResults.summary,
    data_comments: currentResults.data_comments,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `exoplanet-${currentFormData.object_id}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (window.utils && typeof window.utils.showAlert === "function")
    window.utils.showAlert(
      "Results downloaded",
      "success",
      document.querySelector("main")
    );
}

function copyResults() {
  if (!currentResults || !currentFormData) return;
  const text = `
Object ID: ${currentFormData.object_id}
Probability: ${Math.round((currentResults.probability || 0) * 100)}%
Summary: ${currentResults.summary || ""}
Comments:
${(currentResults.data_comments || [])
  .map((c, i) => `${i + 1}. ${c}`)
  .join("\n")}
  `.trim();

  navigator.clipboard
    .writeText(text)
    .then(
      () =>
        window.utils &&
        window.utils.showAlert &&
        window.utils.showAlert(
          "Results copied to clipboard",
          "success",
          document.querySelector("main")
        )
    )
    .catch(
      () =>
        window.utils &&
        window.utils.showAlert &&
        window.utils.showAlert(
          "Failed to copy results",
          "error",
          document.querySelector("main")
        )
    );
}

function analyzeAnother() {
  currentFormData = null;
  currentResults = null;
  if (formEl) formEl.reset();
  if (resultsSection) resultsSection.style.display = "none";
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (formEl && formEl.elements && formEl.elements[0])
    formEl.elements[0].focus();
}

/* ---------- Expose actions ---------- */
if (typeof window !== "undefined") {
  window.researcherActions = {
    downloadResults,
    copyResults,
    analyzeAnother,
  };
}
