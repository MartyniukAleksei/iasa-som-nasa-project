/**
 * js/api.js
 * Полный модуль API:
 *  - mockInfer (локальный эмулятор)
 *  - sendToModel / uploadWithProgress (для будущей интеграции)
 *  - logToGoogleSheets (опционально, POST)
 *  - fetchServerResponse / pollServerResponse (GET polling из одной Google Sheet)
 *
 * Настрой:
 *  - Поменяй GOOGLE_SHEETS_ENDPOINT (POST) и GOOGLE_SHEETS_GET_ENDPOINT (GET) на URL'ы
 *    твоего задеплоенного Google Apps Script Web App.
 *  - Если не хочешь логгировать входы — оставь GOOGLE_SHEETS_ENDPOINT пустым или placeholder.
 */

/* ================= CONFIGURATION ================= */

// Real model API (if будет)
const API_ENDPOINT = "https://your-model-api.example.com/predict";
const API_KEY = "your-api-key-here";
const REQUEST_TIMEOUT = 30000; // ms

// Google Sheets endpoints:
// POST endpoint (опционально) — если хочешь логгировать входные данные (в нашем новом сценарии можно оставить пустым)
const GOOGLE_SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbzBhtoJ1pvYZJmlcGBwc5Z3YUk2kE7euqbP6cZyFxDBVEG5RYLlA8M9gGDczUVKfNRY/exec"; // <-- optional (logging)

// GET endpoint (обязательно для polling, Apps Script returning JSON)
const GOOGLE_SHEETS_GET_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbwxUNEd0DsKhZV5ZR4LhsPu2OY8xC6YZD6Iv2pDsR7n0pbH8_MqMGK4QW7rZp_n-OHN/exec"; // <-- replace with your GET URL

// Poll defaults
const DEFAULT_POLL_INTERVAL_MS = 10000; // 10s
const DEFAULT_POLL_TIMEOUT_MS = 120000; // 2 min

/* ================= MOCK INFERENCE ================= */

/**
 * mockInfer(formData)
 * Локальная эмуляция результата — удобно для dev / fallback
 * Возвращает: { probability: 0..1, summary: string, data_comments: [str...] }
 */
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

/* ================= REAL API (file upload) - OPTIONAL ================= */

/**
 * sendToModel(file, progressCallback)
 * Отправка файла на реальный API (если потребуется).
 * Возвращает JSON ответа или бросает ошибку.
 */
async function sendToModel(file, progressCallback = null) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("filename", file.name);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    if (progressCallback) {
      // use XHR-based uploader with progress
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
        // don't set Content-Type (browser sets boundary)
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

/**
 * uploadWithProgress(formData, progressCallback)
 * Использует XHR для отслеживания прогресса загрузки.
 */
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

/* ================= GOOGLE SHEETS LOGGING (POST) - optional ================= */

/**
 * logToGoogleSheets(formData)
 * Попытка записать входные данные в Google Sheets (POST)
 * Возвращает true/false. Работа в режиме "best-effort".
 *
 * Замечание: если GOOGLE_SHEETS_ENDPOINT пустой или не заменён — функция пропускается.
 */
async function logToGoogleSheets(formData) {
  if (
    !GOOGLE_SHEETS_ENDPOINT ||
    GOOGLE_SHEETS_ENDPOINT.includes("YOUR_POST_DEPLOY_ID")
  ) {
    console.warn(
      "GOOGLE_SHEETS_ENDPOINT не настроен — пропускаем логирование."
    );
    return false;
  }

  const payload = { ...formData, timestamp: new Date().toISOString() };

  // Сначала пробуем нормальный fetch (чтобы прочитать ответ, если CORS настроен).
  try {
    const resp = await fetch(GOOGLE_SHEETS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // normal mode; если сервер настроен корректно, вернёт JSON
    });

    // Если fetch успешен (200..299) — считаем лог выполненным
    if (resp.ok) {
      console.log("Logged to Google Sheets (POST) — server responded OK.");
      return true;
    } else {
      console.warn("POST to Google Sheets responded with status:", resp.status);
      // как fallback попробуем no-cors (can't read response)
    }
  } catch (err) {
    console.warn(
      "Normal POST to Google Sheets failed (maybe CORS):",
      err.message || err
    );
  }

  // fallback: попытка в режиме no-cors — запишет, но нельзя прочитать ответ
  try {
    await fetch(GOOGLE_SHEETS_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log("Logged to Google Sheets (POST) via no-cors (assumed).");
    return true;
  } catch (err) {
    console.error("Failed to log to Google Sheets even with no-cors:", err);
    return false;
  }
}

/* ================= GOOGLE SHEETS POLLING (GET) ================= */

/**
 * fetchServerResponse(object_id)
 * GET к Apps Script. Ожидает JSON вида:
 * - { status: "pending" }
 * - { object_id: "...", procent: 87.2, timestamp: "..." }
 */
async function fetchServerResponse(object_id) {
  if (
    !GOOGLE_SHEETS_GET_ENDPOINT ||
    GOOGLE_SHEETS_GET_ENDPOINT.includes("YOUR_GET_DEPLOY_ID")
  ) {
    throw new Error("GOOGLE_SHEETS_GET_ENDPOINT не настроен (в api.js).");
  }

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

  const data = await res.json();
  return data;
}

/**
 * pollServerResponse(object_id, options)
 * Периодически опрашивает fetchServerResponse до появления numeric `procent`.
 * options: { interval, timeout, onPending, onError }
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

      // otherwise pending
      onPending();
    } catch (err) {
      onError(err);
      console.warn(
        "Polling attempt failed (will retry):",
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
