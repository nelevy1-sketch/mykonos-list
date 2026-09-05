const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/**
 * suggestPackingList
 *
 * POST body (JSON):
 * {
 *   "destination": "תאילנד",
 *   "tripType": "abroad" | "local" | "camping" | "reserve",
 *   "vibes": ["beach","relax"],       // optional, from the trip's chosen vibes
 *   "startDate": "2026-06-10",        // ISO date, optional
 *   "endDate": "2026-06-17",          // ISO date, optional
 *   "listName": "ביגוד",              // which packing list this is for, optional
 *   "language": "he" | "en"
 * }
 *
 * Response (JSON):
 * { "items": ["פריט 1", "פריט 2", ...] }
 * or
 * { "error": "..." }
 */
exports.suggestPackingList = onRequest(
  {
    secrets: [GEMINI_API_KEY],
    cors: true,
    region: "us-central1",
    maxInstances: 10
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const {
      destination,
      tripType,
      vibes,
      startDate,
      endDate,
      listName,
      language
    } = req.body || {};

    if (!destination || typeof destination !== "string") {
      res.status(400).json({ error: "Missing destination" });
      return;
    }

    const lang = language === "en" ? "English" : "Hebrew";
    const vibeText =
      Array.isArray(vibes) && vibes.length ? vibes.join(", ") : "not specified";

    const prompt = `You are a helpful, concise packing assistant inside a group trip planning app.

Trip destination: ${destination}
Trip type: ${tripType || "general"}
Trip vibe(s): ${vibeText}
Trip dates: ${startDate || "unknown"} to ${endDate || "unknown"}
Packing list category this is for: ${listName || "general"}

Suggest a focused packing list of 8 to 14 specific items appropriate for this trip, considering the destination's typical climate and conditions during those dates, the trip type, and the chosen vibe(s). Avoid vague filler items (like "clothes" or "toiletries") - be concrete and specific (e.g. "rain jacket", "reef-safe sunscreen", "power adapter for [region] outlets").

Respond in ${lang}.
Respond ONLY with a raw JSON array of strings. No explanation, no markdown formatting, no code fences. Example: ["item one","item two"]`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY.value()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2000,
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        logger.error("Gemini API error", { status: response.status, body: errText });
        res.status(502).json({ error: "AI request failed" });
        return;
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text || "";

      logger.info("Gemini raw response", {
        finishReason: candidate?.finishReason,
        usageMetadata: data.usageMetadata,
        text
      });

      const cleaned = text.replace(/```json|```/g, "").trim();

      let items;
      try {
        items = JSON.parse(cleaned);
      } catch (parseError) {
        logger.error("Could not parse Gemini response as JSON", {
          finishReason: candidate?.finishReason,
          text
        });
        res.status(502).json({ error: "Could not parse AI response" });
        return;
      }

      if (!Array.isArray(items)) {
        res.status(502).json({ error: "Unexpected AI response format" });
        return;
      }

      const cleanItems = items
        .filter(item => typeof item === "string" && item.trim())
        .map(item => item.trim())
        .slice(0, 14);

      res.json({ items: cleanItems });
    } catch (error) {
      logger.error("suggestPackingList failed", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);
