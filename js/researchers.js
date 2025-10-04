/**
 * js/api.js — совместимый и устойчивый к CORS модуль API
 *
 * Особенности:
 * - Сохраняет mockInfer, sendToModel, uploadWithProgress, validateResponse, logToGoogleSheets
 * - fetchServerResponse пытается сначала fetch(), при ошибке — fallback на JSONP
 * - pollServerResponse использует fetchServerResponse
 *
 * ВАЖНО:
 * - Для JSONP Apps Script doGet должен поддерживать параметр `callback`
 *   и возвращать JavaScript: callback({...});
 * - Подставь свои URL в GOOGLE_SHEETS_ENDPOINT (POST, опционно) и GOOGLE_SHEETS_GET_ENDPOINT (GET).
 */

/* ================= CONFIGURATION ================= */

// Реальный API (опционально)
const API_ENDPOINT = "https://your-model-api.example.com/predict";
const API_KEY = "your-api-key-here";
const REQUEST_TIMEOUT = 30000; // ms

// Google Apps Script endpoints (замени на свои)
// POST (опционально) — логирование; можно оставить placeholder если не используешь
const GOOGLE_SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbzBhtoJ1pvYZJmlcGBwc5Z3YUk2kE7euqbP6cZyFxDBVEG5RYLlA8M9gGDczUVKfNRY/exec";

// GET (нужно для чтения ServerResponses) — подставь URL, полученный при деплое Web App
const GOOGLE_SHEETS_GET_ENDPOINT =
  "https://script.google.com/macros/library/d/1HZQfrnjnn_OLjBzkCXK8Tp6LIusSa6gJf4ulKMftbIs8Uypy-JfgPTmy/4";

// Poll defaults
const DEFAULT_POLL_INTERVAL_MS = 10000; // 10s
const DEFAULT_POLL_TIMEOUT_MS = 120000; // 2 min

/* ================= MOCK INFERENCE ================= */

async function mockInfer(formData) {
  const delay = 1000 + Math.random() * 2000;
  await new Promise((r) => setTimeout(r, delay));

  const snr = parseFloat(formData.snr) || 10;
  const transitDepth = parseFloat(formData.transit_depth) || 5000;

  const snrFactor = Math.min(snr / 20, 1);
  const depthFactor = Math.min(transitDepth / 10000, 1);
  const baseProbability = 0.3 + snrFactor * 0.3 + depthFactor * 0.3;
  const probability = Math.round(baseProbability * 1000) / 1000;

  let confidenceLevel, signalStrength;
  if (probability >= 0.75) {
    confidenceLevel = "High likelihood";
    signalStrength = "Strong";
  } else if (probability >= 0.5) {
    confidenceLevel = "Moderate likelihood";
    signalStrength = "Moderate";
  } else {
    confidenceLevel = "Low likelihood";
    signalStrength = "Weak";
  }

  const comments = [
    `${signalStrength} transit signal detected for ${formData.object_id}`,
    `Signal-to-noise ratio: ${formData.snr}`,
    `Transit depth: ${formData.transit_depth} ppm`,
    `Orbital period: ${formData.orbital_period} days`,
    `Transit duration: ${formData.transit_duration} hours`,
    `Planet radius: ${formData.planet_radius} R⊕`,
    `Equilibrium temperature: ${formData.eq_temperature} K`,
    `Stellar properties: ${formData.stellar_mass} M☉, ${formData.stellar_temp} K`,
    `Processing completed at ${new Date().toLocaleTimeString()}`,
  ];

  return {
    probability,
    summary: `${confidenceLevel} of confirmed exoplanet based on ${signalStrength.toLowerCase()} transit signature and favorable orbital parameters.`,
    data_comments: comments,
  };
}

/* ================= REAL API (optional file upload) ================= */

async function sendToModel(file, progressCallback = null) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("filename", file.name);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    if (progressCallback) {
      const data = await uploadWithProgress(formData, progressCallback);
      clearTimeout(timeoutId);
      if (!validateResponse(data))
        throw new Error("Invalid response format from API");
      return data;
    }

    const resp = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`API request failed (${resp.status}): ${t}`);
    }

    const data = await resp.json();
    if (!validateResponse(data))
      throw new Error("Invalid response format from API");
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("Request timed out");
    if (err instanceof TypeError) throw new Error("Network error");
    throw err;
  }
}

function uploadWithProgress(formData, progressCallback) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && typeof progressCallback === "function") {
        const p = Math.round((e.loaded / e.total) * 100);
        progressCallback(p);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (e) {
          reject(new Error("Failed to parse API response"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    });

    xhr.addEventListener("error", () =>
      reject(new Error("Network error during upload"))
    );
    xhr.addEventListener("timeout", () =>
      reject(new Error("Upload timed out"))
    );

    xhr.open("POST", API_ENDPOINT);
    xhr.setRequestHeader("Authorization", `Bearer ${API_KEY}`);
    xhr.timeout = REQUEST_TIMEOUT;
    xhr.send(formData);
  });
}

/* ================= VALIDATION ================= */

function validateResponse(data) {
  return (
    data &&
    typeof data.probability === "number" &&
    data.probability >= 0 &&
    data.probability <= 1 &&
    typeof data.summary === "string" &&
    Array.isArray(data.data_comments)
  );
}

/* ================= GOOGLE SHEETS LOGGING (POST) ================= */

async function logToGoogleSheets(formData) {
  // Якщо не вказано endpoint або він явно містить плейсхолдер — пропускаємо лог
  if (
    !GOOGLE_SHEETS_ENDPOINT ||
    GOOGLE_SHEETS_ENDPOINT.includes("YOUR_POST_DEPLOY_ID") ||
    GOOGLE_SHEETS_ENDPOINT.includes("YOUR_POST_DEPLOY_ID_HERE") ||
    GOOGLE_SHEETS_ENDPOINT.includes("YOUR_POST_DEPLOY_URL")
  ) {
    console.warn("GOOGLE_SHEETS_ENDPOINT not configured — skipping logging.");
    return false;
  }

  const payload = { ...formData, timestamp: new Date().toISOString() };

  try {
    // Намагаємось послати у нормальному режимі (якщо CORS дозволено на сервері)
    const resp = await fetch(GOOGLE_SHEETS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (resp.ok) {
      console.log("Logged to Google Sheets (POST) — server responded OK.");
      return true;
    } else {
      console.warn(
        "POST to Google Sheets returned status:",
        resp.status,
        " — will fallback to no-cors send."
      );
    }
  } catch (err) {
    // звичайний POST впав (ймовірно CORS) — падаємо в no-cors
    console.warn(
      "Normal POST to Google Sheets failed (maybe CORS):",
      err && err.message ? err.message : err
    );
  }

  // fallback: send no-cors (fire-and-forget). Браузер не дозволить читати відповідь.
  try {
    await fetch(GOOGLE_SHEETS_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log("logToGoogleSheets: POST sent (no-cors).");
    return true;
  } catch (err) {
    console.error(
      "logToGoogleSheets: failed to send POST (no-cors):",
      err && err.message ? err.message : err
    );
    return false;
  }
}

/* ================= GOOGLE SHEETS FETCH (with JSONP fallback) ================= */

/**
 * fetchServerResponse(object_id)
 *  - tries to fetch via standard fetch()
 *  - if fetch fails due to network/CORS, falls back to JSONP (inserts <script>)
 *
 * Expected Apps Script responses:
 *  - JSON mode: { status: "pending" } OR { object_id: "...", procent: 87.2, timestamp: "..." }
 *  - JSONP mode (when ?callback=cb supplied): cb({...});
 *
 * NOTE: For JSONP fallback to work, your Apps Script doGet must support `callback` param
 * and return JavaScript when callback is present.
 */
async function fetchServerResponse(object_id) {
  // Перевірка — якщо endpoint не вказано або залишено плейсхолдер, кидаємо зрозумілу помилку
  if (
    !GOOGLE_SHEETS_GET_ENDPOINT ||
    GOOGLE_SHEETS_GET_ENDPOINT.includes("YOUR_GET_DEPLOY_ID") ||
    GOOGLE_SHEETS_GET_ENDPOINT.includes("YOUR_GET_DEPLOY_ID_HERE") ||
    GOOGLE_SHEETS_GET_ENDPOINT.includes("YOUR_GET_DEPLOY_URL")
  ) {
    throw new Error("GOOGLE_SHEETS_GET_ENDPOINT not configured in api.js.");
  }

  // Спробуємо JSONP (обхід CORS). Це основний шлях, якщо doGet підтримує callback.
  try {
    const data = await fetchServerResponseJSONP(object_id);
    return data;
  } catch (jsonpErr) {
    console.warn(
      "JSONP attempt failed, trying fetch() fallback:",
      jsonpErr && jsonpErr.message ? jsonpErr.message : jsonpErr
    );
    // fallback: спробувати звичайний fetch (якщо Apps Script має CORS або ти поставив proxy)
    const url = `${GOOGLE_SHEETS_GET_ENDPOINT}?object_id=${encodeURIComponent(
      object_id
    )}&ts=${Date.now()}`;
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`GET failed (${res.status}): ${txt}`);
    }

    return await res.json();
  }
}

/**
 * fetchServerResponseJSONP(object_id)
 * Inserts a script tag with callback to get around CORS.
 * Resolves with the parsed object or rejects on error/timeout.
 */
function fetchServerResponseJSONP(object_id, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_SHEETS_GET_ENDPOINT) {
      return reject(new Error("GOOGLE_SHEETS_GET_ENDPOINT not configured."));
    }

    const callbackName = "gs_cb_" + Math.random().toString(36).slice(2, 10);
    let script = null;
    let timeoutId = null;

    const cleanup = () => {
      if (script && script.parentNode) script.parentNode.removeChild(script);
      try {
        delete window[callbackName];
      } catch (e) {
        window[callbackName] = undefined;
      }
      if (timeoutId) clearTimeout(timeoutId);
    };

    // timeout guard
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP request timed out"));
    }, timeoutMs);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    const sep = GOOGLE_SHEETS_GET_ENDPOINT.includes("?") ? "&" : "?";
    // Передаём object_id и callback; ts чтобы избежать кеша
    const url = `${GOOGLE_SHEETS_GET_ENDPOINT}${sep}object_id=${encodeURIComponent(
      object_id
    )}&callback=${callbackName}&ts=${Date.now()}`;
    script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP script load error"));
    };

    document.body.appendChild(script);
  });
}

/* ================= POLLING ================= */

/**
 * pollServerResponse(object_id, options)
 * Repeatedly calls fetchServerResponse until response.procent is found or timeout.
 *
 * options:
 *   interval: ms between attempts (default DEFAULT_POLL_INTERVAL_MS)
 *   timeout: total timeout ms (default DEFAULT_POLL_TIMEOUT_MS)
 *   onPending: fn invoked when response indicates pending
 *   onError: fn invoked on fetch/jsonp/network error
 */
async function pollServerResponse(object_id, options = {}) {
  const interval = options.interval || DEFAULT_POLL_INTERVAL_MS;
  const timeout = options.timeout || DEFAULT_POLL_TIMEOUT_MS;
  const onPending =
    typeof options.onPending === "function" ? options.onPending : () => {};
  const onError =
    typeof options.onError === "function" ? options.onError : () => {};

  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const data = await fetchServerResponse(object_id);

      if (data && data.status === "pending") {
        onPending();
      }

      if (data && typeof data.procent === "number") {
        return data;
      }

      onPending();
    } catch (err) {
      onError(err);
      console.warn(
        "pollServerResponse attempt error, will retry:",
        err && err.message ? err.message : err
      );
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error("Polling timed out (no server response within timeout).");
}

/* ================= EXPORTS ================= */
if (typeof window !== "undefined") {
  window.api = window.api || {};
  window.api.mockInfer = mockInfer;
  window.api.sendToModel = sendToModel;
  window.api.uploadWithProgress = uploadWithProgress;
  window.api.validateResponse = validateResponse;
  window.api.logToGoogleSheets = logToGoogleSheets;
  window.api.fetchServerResponse = fetchServerResponse;
  window.api.pollServerResponse = pollServerResponse;
}
