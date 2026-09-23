const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Private analytics dashboard (dashboard.html) - server-side call logging,
// stage 3 (client-side writes were stage 2, safeWrite.js). Admin SDK
// writes run with full admin privileges and bypass database.rules.json
// entirely - no rules change needed for this to work, unlike every
// client-side write in this app. Own try/catch, awaited from each
// handler's own `finally` block AFTER res.json()/res.status() has already
// sent the real response - the write can still fail or be slow without
// the client ever seeing it, since the response has already gone out by
// the time this runs. A failure here is logged and swallowed, never
// rethrown - this must never turn a successful AI suggestion into a
// reported failure for the function's own execution.
async function logServerCall(functionName, success, meta = {}) {
  try {
    await admin.database().ref("_analytics/serverCalls").push({
      function: functionName,
      success,
      timestamp: Date.now(),
      ...meta
    });
  } catch (error) {
    logger.warn(`[_analytics] failed to log server call for ${functionName}`, error);
  }
}

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
 *   "language": "he" | "en",
 *   "scope": "leg" | "shared"         // optional, docs/schema-legs.md §7ב
 *                                     // step 12 commit ג - omitted (every
 *                                     // caller before that commit) keeps
 *                                     // the exact prompt this endpoint has
 *                                     // always sent. "leg" is one leg of a
 *                                     // multi-leg trip (destination is
 *                                     // that leg's own name) - adds an
 *                                     // instruction not to suggest general
 *                                     // trip-wide items. "shared" asks for
 *                                     // exactly those general items instead
 *                                     // (destination is the joined list of
 *                                     // every leg's name, for context only)
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
      language,
      scope
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

    // docs/schema-legs.md §7ב, step 12 commit ג - scope is new and
    // optional. Every caller before this commit never sends it, so
    // isLeg/isShared are both false and introParagraph collapses to
    // EXACTLY the text this endpoint has always sent - verified
    // byte-for-byte against the previous prompt for a fixed sample input
    // before deploying (not committed, a throwaway comparison script).
    // The two branches below only ever ADD text on top of that base, never
    // remove or reorder anything from it.
    const isShared = scope === "shared";
    const isLeg = scope === "leg";

    const introParagraph = isShared
      ? `This is a multi-destination trip, visiting in order: ${destination}. Trip type: ${tripType || "general"}. Packing list category this is for: ${listName || "general"}.

Suggest a focused packing list of 8 to 14 GENERAL items useful across the ENTIRE trip, not tied to any single destination's weather or conditions - think travel documents, universal electronics (chargers, adapters, power banks), medication, and similar trip-wide essentials that stay the same no matter which destination the traveler is currently at. Do NOT suggest destination-specific or climate-specific items like beachwear or snow gear - those are requested separately for each destination.`
      : `Trip destination: ${destination}
Trip type: ${tripType || "general"}
Trip vibe(s): ${vibeText}
Trip dates: ${startDate || "unknown"} to ${endDate || "unknown"}
Packing list category this is for: ${listName || "general"}

Suggest a focused packing list of 8 to 14 specific items appropriate for this trip, considering the destination's typical climate and conditions during those dates, the trip type, and the chosen vibe(s). Avoid vague filler items like "clothes" or "toiletries" - be concrete and specific.${isLeg ? ` This is one destination within a multi-destination trip - do not suggest general items that would be needed regardless of which destination this is, like a passport, phone charger, adapter, or power bank; those are covered by a separate trip-wide list.` : ""}`;

    const prompt = `You are a helpful, concise packing assistant inside a group trip planning app.

${introParagraph}

Each item is a short NAME, not a description: 2-3 words, prefer 2. No sub-clauses, no explanation of why it's needed. Good: ${shortItemExamples}. Bad: ${wordyItemExample}.

Do not add an adjective unless it actually distinguishes this item from another item you'd otherwise suggest. If the bare item name already tells the traveler what to pack, stop there - don't decorate it. Words like "light," "compact," "nice," "quality," "comfortable" are decoration, not information. Good: ${shortItemExamples}. Bad: ${decoratedItemExample}.

Each item is one distinct real-world need. Never suggest the same item twice under a different wording - one rain jacket, one power bank, one umbrella. If a second phrasing of something you already listed comes to mind, skip it and suggest something genuinely different instead.

Respond in ${lang}.
Respond ONLY with a raw JSON array of strings. No explanation, no markdown formatting, no code fences. Example: ["item one","item two"]`;

    const callStartedAt = Date.now();
    let callSucceeded = false;
    let callUsageMetadata = null;

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
      callUsageMetadata = data.usageMetadata || null;

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

      callSucceeded = true;
      res.json({ items: cleanItems });
    } catch (error) {
      logger.error("suggestPackingList failed", error);
      res.status(500).json({ error: "Server error" });
    } finally {
      await logServerCall("suggestPackingList", callSucceeded, {
        latencyMs: Date.now() - callStartedAt,
        ...(callUsageMetadata ? { usageMetadata: callUsageMetadata } : {})
      });
    }
  }
);

/**
 * suggestPlaces
 *
 * POST body (JSON):
 * {
 *   "destination": "בנגקוק",     // the trip's (or active leg's) destination
 *   "tripCharacter": "family",   // optional - one of family/friends/couple/
 *                                // ski/pride/bachelor/festival, docs/schema-legs.md §3.2
 *   "vibes": ["beach","relax"],  // optional, from the trip's (or leg's) vibes
 *   "language": "he" | "en"
 * }
 *
 * Response (JSON):
 * { "places": [{ "name": "...", "city": "...", "reason": "..." }, ...] }
 * or
 * { "error": "..." }
 *
 * No Google Places API in this app (places-ai-investigation.md - the "map"
 * field on a place is a free-text URL the user pastes themselves, nothing
 * is verified server-side). The client shows every suggestion with an
 * explicit "not verified" label and a "search on maps" link the user is
 * expected to actually follow before saving - the human is the only thing
 * standing between a real place and a hallucinated one, so the prompt below
 * leans hard on "only suggest places you're confident are real," not just
 * on format (unlike the packing prompt above, which never had to worry
 * about factual grounding, only style).
 */
exports.suggestPlaces = onRequest(
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

    const { destination, tripCharacter, vibes, language } = req.body || {};

    if (!destination || typeof destination !== "string") {
      res.status(400).json({ error: "Missing destination" });
      return;
    }

    const lang = language === "en" ? "English" : "Hebrew";
    const vibeText =
      Array.isArray(vibes) && vibes.length ? vibes.join(", ") : "not specified";
    const characterText =
      typeof tripCharacter === "string" && tripCharacter ? tripCharacter : "not specified";

    const prompt = `You are a helpful, concise local-recommendations assistant inside a group trip planning app.

Trip destination: ${destination}
Trip character: ${characterText}
Trip vibe(s): ${vibeText}

Suggest up to 5 real places worth visiting at this destination - restaurants, sights, activities, anything concrete and visitable. Prefer real, verifiable places that fit the trip's character and vibe(s) and are less commonly covered in generic travel guides, over the single most famous landmark - but it's fine, even good, for one or two suggestions to be a well-known "anchor" place. The rest should be more specific to this trip's character and vibes.

Only suggest places you are confident actually exist, with the correct name paired with the correct city or neighborhood. If you are not certain a place is real, or not certain which city/neighborhood it is actually in, leave it out entirely - a shorter list of real places is far better than five items where one is invented or mislocated.

For each place, give:
- "name": the place's real name, as it would appear on a map. Short - no description folded into the name.
- "city": the city or neighborhood it is actually in (helps the traveler search for it correctly).
- "reason": one short sentence (under 20 words) explaining why this specific place fits this trip's character and vibe(s) - not a generic description of what the place is.

Respond in ${lang} for "name", "city" and "reason" alike.
Respond ONLY with a raw JSON array of objects. No explanation, no markdown formatting, no code fences. Example: [{"name":"...","city":"...","reason":"..."}]`;

    const callStartedAt = Date.now();
    let callSucceeded = false;
    let callUsageMetadata = null;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY.value()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              // Lower than suggestPackingList's 0.7 - there is no external
              // verification step downstream any more (places-ai-investigation.md),
              // so this is the one lever available here, beyond prompt wording,
              // to push toward grounded/likely answers over creative ones.
              temperature: 0.4,
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
      callUsageMetadata = data.usageMetadata || null;

      logger.info("Gemini raw response", {
        finishReason: candidate?.finishReason,
        usageMetadata: data.usageMetadata,
        text
      });

      // Same fix as suggestPackingList above, same reason - this is the
      // exact failure that already cost months once (maxOutputTokens too
      // low truncating silently). Check finishReason BEFORE JSON.parse.
      if (candidate?.finishReason === "MAX_TOKENS") {
        logger.warn("Gemini response truncated (MAX_TOKENS)", {
          usageMetadata: data.usageMetadata,
          text
        });
        res.status(502).json({ error: "AI response was cut off", reason: "truncated" });
        return;
      }

      const cleaned = text.replace(/```json|```/g, "").trim();

      let places;
      try {
        places = JSON.parse(cleaned);
      } catch (parseError) {
        logger.error("Could not parse Gemini response as JSON", {
          finishReason: candidate?.finishReason,
          text
        });
        res.status(502).json({ error: "Could not parse AI response" });
        return;
      }

      if (!Array.isArray(places)) {
        res.status(502).json({ error: "Unexpected AI response format" });
        return;
      }

      const cleanPlaces = places
        .filter(
          place =>
            place &&
            typeof place.name === "string" && place.name.trim() &&
            typeof place.city === "string" && place.city.trim() &&
            typeof place.reason === "string" && place.reason.trim()
        )
        .map(place => ({
          name: place.name.trim(),
          city: place.city.trim(),
          reason: place.reason.trim()
        }))
        .slice(0, 5);

      callSucceeded = true;
      res.json({ places: cleanPlaces });
    } catch (error) {
      logger.error("suggestPlaces failed", error);
      res.status(500).json({ error: "Server error" });
    } finally {
      await logServerCall("suggestPlaces", callSucceeded, {
        latencyMs: Date.now() - callStartedAt,
        ...(callUsageMetadata ? { usageMetadata: callUsageMetadata } : {})
      });
    }
  }
);

// participantKey() - byte-for-byte reimplementation of member.js's own
// client-side function (UTF-8 bytes -> base64 -> URL-safe, no padding).
// Verified directly, not assumed: ran both algorithms (client's
// TextEncoder+manual-byte-string+btoa approach vs. this Buffer-based one)
// against 5 real test uids, including a realistic Firebase-uid-shaped
// string - all 5 produced byte-identical output. Kept as a plain
// function, not exported - this file has no client-callable "utility"
// surface, matching every other helper here (logServerCall, etc.).
function participantKey(value) {
  return Buffer.from(String(value).trim(), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * joinTrip (callable, v2 onCall - NOT onRequest like the two functions
 * above, a genuinely new pattern for this file)
 *
 * Step 1/2 of the trips/$tripId read-membership investigation (dashboard/
 * roadmap context - the .read rule is "auth != null" today, no real
 * membership check, confirmed directly against database.rules.json and
 * production before starting this). This function is the future
 * server-side gatekeeper for FIRST-TIME joins; step 2 (hardening
 * trips/$tripId/.read itself to "members only") is NOT part of this
 * commit and does not happen here - today's .read stays exactly as wide
 * as it already is. Every auth-gated page calls this ONLY when its own
 * direct trip read fails with a permission-denied error, which cannot
 * actually happen yet under today's rules - this lets the whole join-
 * mediation path ship, deploy, and settle in production risk-free before
 * the rules change that will make it load-bearing.
 *
 * Admin SDK bypasses database.rules.json entirely (same as
 * logServerCall's own writes above) - this is precisely what lets a
 * brand-new, not-yet-a-member user get registered without first needing
 * read access to the trip they're trying to join, the chicken-and-egg
 * this whole investigation exists to solve.
 *
 * Mirrors autoRegisterMember()'s (member.js) own decision sequence
 * exactly - claim, then profile write, rollback the claim if the profile
 * write fails - just running server-side instead of client-side. Deciding
 * NOT to call this unconditionally: an already-a-member caller (the
 * overwhelmingly common case once this is load-bearing, since it only
 * runs after a *failed* direct read) short-circuits on the existing-
 * profile check below - same idempotent gate loadProfile() (each page's
 * own client code) already relies on, so nothing here conflicts with the
 * client's own autoRegisterMember() call on a normal, unhardened-.read day
 * like today: that client path only ever runs when memberProfiles/{uid}
 * doesn't exist yet, and if this function ever created one first, the
 * client would simply see it already exists and skip its own write.
 */
exports.joinTrip = onCall(
  { region: "us-central1", maxInstances: 10 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign-in required.");
    }

    const tripId = request.data?.tripId;
    if (!tripId || typeof tripId !== "string") {
      throw new HttpsError("invalid-argument", "tripId is required.");
    }

    const db = admin.database();
    let trip;

    try {
      const tripSnap = await db.ref(`trips/${tripId}`).once("value");
      if (!tripSnap.exists()) {
        throw new HttpsError("not-found", "Trip not found.");
      }
      trip = tripSnap.val();
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error(`[joinTrip] trip read failed for ${tripId}`, error);
      throw new HttpsError("internal", "Could not load this trip.");
    }

    const profileRef = db.ref(`trips/${tripId}/memberProfiles/${uid}`);

    let existingSnap;
    try {
      existingSnap = await profileRef.once("value");
    } catch (error) {
      logger.error(`[joinTrip] profile read failed for ${tripId}/${uid}`, error);
      throw new HttpsError("internal", "Could not check your membership.");
    }

    if (existingSnap.exists()) {
      // Already a member (a second call, a race with the client's own
      // autoRegisterMember, or a retry after a dropped connection) -
      // nothing to do, not an error.
      return { alreadyMember: true };
    }

    const token = request.auth.token || {};
    const displayName = token.name || "";
    const email = token.email || "";
    const photoURL = token.picture || "";
    // Same "no displayName/email -> fallback" shape as member.js's own
    // ops.fallbackName parameter - there is no page-supplied string to
    // use here, so this reads the trip's OWN language field instead
    // (already fetched above), same signal every page's own tr() already
    // keys off.
    const fallbackName = trip.language === "en" ? "Traveler" : "משתתף";
    const name = displayName || email || fallbackName;

    const key = participantKey(uid);
    const claimRef = db.ref(`trips/${tripId}/participantClaims/${key}`);

    try {
      // Structurally shouldn't abort for a uid-keyed claim (see member.js's
      // own comment on this exact point) - a claim key derived from MY OWN
      // uid can never already be held by a different uid. Not treated as
      // fatal if it somehow does - same non-fatal handling as
      // autoRegisterMember's own client-side version.
      await claimRef.transaction(current => {
        if (current === null || current === uid) return uid;
        return undefined;
      });
    } catch (error) {
      logger.error(`[joinTrip] claim transaction failed for ${tripId}/${uid}`, error);
      throw new HttpsError("internal", "Could not register you for this trip.");
    }

    const profile = {
      name,
      participantKey: key,
      email,
      photoURL,
      updatedAt: Date.now()
    };

    try {
      await profileRef.set(profile);
    } catch (error) {
      try {
        await claimRef.transaction(current => (current === uid ? null : current));
      } catch (rollbackError) {
        logger.error(`[joinTrip] rollback also failed for ${tripId}/${uid}`, rollbackError);
      }
      logger.error(`[joinTrip] profile write failed for ${tripId}/${uid}`, error);
      throw new HttpsError("internal", "Could not register you for this trip.");
    }

    await logServerCall("joinTrip", true, { tripId });

    return { alreadyMember: false };
  }
);
