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

    // Examples are language-matched, not bilingual: the model is told to
    // respond in a single language (see "Respond in ${lang}" below), and
    // mixing Hebrew/English example items in the same instruction risks
    // it mixing languages in the actual output too.
    const shortItemExamples =
      language === "en"
        ? `"rain jacket", "power bank", "reef-safe sunscreen"`
        : `"מעיל גשם", "מטען נייד", "מטרייה מתקפלת"`;
    const wordyItemExample =
      language === "en"
        ? `"a rain jacket that's waterproof and windproof for the transitional season"`
        : `"מטען נייד חזק ליום שלם מחוץ למלון"`;
    const decoratedItemExample =
      language === "en"
        ? `"lightweight compact umbrella", "waterproof windproof jacket"`
        : `"מטרייה מתקפלת קלה", "מעיל מעבר עמיד למים"`;

    const prompt = `You are a helpful, concise packing assistant inside a group trip planning app.

Trip destination: ${destination}
Trip type: ${tripType || "general"}
Trip vibe(s): ${vibeText}
Trip dates: ${startDate || "unknown"} to ${endDate || "unknown"}
Packing list category this is for: ${listName || "general"}

Suggest a focused packing list of 8 to 14 specific items appropriate for this trip, considering the destination's typical climate and conditions during those dates, the trip type, and the chosen vibe(s). Avoid vague filler items like "clothes" or "toiletries" - be concrete and specific.

Each item is a short NAME, not a description: 2-3 words, prefer 2. No sub-clauses, no explanation of why it's needed. Good: ${shortItemExamples}. Bad: ${wordyItemExample}.

Do not add an adjective unless it actually distinguishes this item from another item you'd otherwise suggest. If the bare item name already tells the traveler what to pack, stop there - don't decorate it. Words like "light," "compact," "nice," "quality," "comfortable" are decoration, not information. Good: ${shortItemExamples}. Bad: ${decoratedItemExample}.

Each item is one distinct real-world need. Never suggest the same item twice under a different wording - one rain jacket, one power bank, one umbrella. If a second phrasing of something you already listed comes to mind, skip it and suggest something genuinely different instead.

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

      // docs/schema-legs.md §7ב - this is the exact failure that already
      // cost months once (maxOutputTokens: 500 truncating silently). Check
      // finishReason BEFORE attempting JSON.parse, and on its own: a
      // truncated response usually breaks JSON syntax and would otherwise
      // just fall into the generic parse-error branch below, logged and
      // reported identically to any other malformed response - which is
      // exactly the "died silently, indistinguishable from anything else"
      // failure mode being fixed here. reason:"truncated" lets the client
      // show a specific message instead of the generic one.
      if (candidate?.finishReason === "MAX_TOKENS") {
        logger.warn("Gemini response truncated (MAX_TOKENS)", {
          usageMetadata: data.usageMetadata,
          text
        });
        res.status(502).json({ error: "AI response was cut off", reason: "truncated" });
        return;
      }

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
