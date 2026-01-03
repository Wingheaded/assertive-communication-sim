/**
 * api/evaluate.cjs
 * CommonJS handler for POST /api/evaluate
 *
 * Designed to work with Google Gemini API
 *
 * Required env:
 *  - GEMINI_API_KEY (or AI_API_KEY)
 *
 * Optional env:
 *  - KB_PATH                          default: ../assertive_communication_kb.md
 */

const fs = require("fs");
const path = require("path");

// Node 18+ has global fetch. If not, we fail loudly.
if (typeof fetch !== "function") {
  throw new Error("Global fetch() not available. Node 18+ required.");
}

/** Read knowledge base (optional, but helpful). */
function readKB() {
  const kbPath =
    process.env.KB_PATH ||
    path.join(__dirname, "..", "assertive_communication_kb.md");

  try {
    return fs.readFileSync(kbPath, "utf8");
  } catch (e) {
    // Don’t hard-fail if KB is missing; just continue without it.
    return "";
  }
}

/** Try to extract JSON from a model response (robust against extra text). */
function safeParseJSON(text) {
  if (!text || typeof text !== "string") return null;

  // 1) Direct parse
  try {
    return JSON.parse(text);
  } catch (_) { }

  // 2) Strip ```json fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch (_) { }
  }

  // 3) Find first { ... } block
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) { }
  }

  return null;
}

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

/**
 * POST body expected (flexible):
 * {
 *   "scenario": {...} OR "scenarioId": "01" OR "scenarioText": "...",
 *   "learnerAnswer": "...",
 *   "attempt": 1,
 *   "minScoreToPass": 75
 * }
 */
module.exports = async function evaluate(req, res) {
  try {
    // Basic method guard
    if (req.method && req.method.toUpperCase() !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "Missing GEMINI_API_KEY (or AI_API_KEY) in env." });
    }

    const body = req.body || {};
    const learnerAnswer = (body.learnerAnswer || body.answer || "").trim();

    if (!learnerAnswer) {
      return badRequest(res, "Missing learnerAnswer.");
    }

    const attempt = Number(body.attempt ?? body.try ?? 1);
    const minScoreToPass = Number(body.minScoreToPass ?? 0);

    const scenario =
      body.scenario ||
      {
        id: body.scenarioId || body.id || "",
        text: body.scenarioText || body.prompt || "",
        character: body.character || "",
        context: body.context || "",
      };

    const kb = readKB();

    const system = `
You are an expert coach and strict grader for assertive communication.
You must evaluate the learner answer against assertive communication best practices and the CLEAR model.

Return ONLY valid JSON (no markdown, no commentary).
The JSON must match this exact schema:

{
  "score": number,              // integer 0-100
  "passed": boolean,            // true if score >= minScoreToPass (if provided), else false when score < 75
  "verdict": "excellent" | "good" | "needs_work" | "poor",
  "what_worked": [string, ...], // 2-5 bullets
  "what_to_improve": [string, ...], // 2-5 bullets
  "rewrite": string,            // a better assertive version of the learner answer (same intent, better delivery)
  "clear_breakdown": {
    "C": string,
    "L": string,
    "E": string,
    "A": string,
    "R": string
  },
  "notes": string               // short, practical coaching note
}

Scoring guidance:
- Assertive = direct + respectful + collaborative + boundaries + ownership.
- Penalize: passive, aggressive, vague, defensive, blaming, over-explaining, ignoring the other person.
- Reward: empathy + clarity + accountability + next step + calm tone.

If the learner answer is unsafe/harassing, score <= 20 and rewrite safely.

Knowledge base (may help; do not quote it):
${kb ? kb.slice(0, 12000) : "(no KB provided)"} 
`.trim();

    const user = `
Scenario:
${JSON.stringify(scenario, null, 2)}

Attempt: ${isNaN(attempt) ? 1 : attempt}
minScoreToPass: ${isNaN(minScoreToPass) ? 0 : minScoreToPass}

Learner answer:
${learnerAnswer}
`.trim();

    // Combine system and user prompts for Gemini
    const fullPrompt = system + "\n\n" + user;

    const payload = {
      contents: [
        { role: "user", parts: [{ text: fullPrompt }] }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048
      }
    };

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

    const resp = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return res.status(500).json({
        error: "Gemini API request failed",
        status: resp.status,
        details: errText.slice(0, 2000),
      });
    }

    const data = await resp.json();
    const content =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    const parsed = safeParseJSON(content);

    if (!parsed) {
      return res.status(500).json({
        error: "Model did not return valid JSON",
        raw: String(content).slice(0, 2000),
      });
    }

    // Normalize / enforce a few defaults
    const score = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0));
    const passThreshold = minScoreToPass > 0 ? minScoreToPass : 75;

    // Transform OpenAI response to match frontend expected schema
    // Frontend expects: score_total, clear_scores, strengths, one_improvement, risks, rewrite, one_coaching_question
    const clearBreakdown = parsed.clear_breakdown || { C: "", L: "", E: "", A: "", R: "" };

    // Convert CLEAR breakdown to clear_scores (0-2 scale based on content presence)
    const scoreClearDimension = (text) => {
      if (!text || text.trim() === "") return 0;
      const lower = text.toLowerCase();
      if (lower.includes("excellent") || lower.includes("strong") || lower.includes("well")) return 2;
      if (lower.includes("missing") || lower.includes("absent") || lower.includes("none") || lower.includes("lacking")) return 0;
      return 1; // Partial/mentioned
    };

    const transformedResponse = {
      // Map score to score_total (frontend expects this name)
      score_total: score,

      // Transform CLEAR breakdown to clear_scores object
      clear_scores: {
        connect: scoreClearDimension(clearBreakdown.C),
        listen: scoreClearDimension(clearBreakdown.L),
        express: scoreClearDimension(clearBreakdown.E),
        align: scoreClearDimension(clearBreakdown.A),
        review: scoreClearDimension(clearBreakdown.R)
      },

      // Map what_worked to strengths
      strengths: Array.isArray(parsed.what_worked) ? parsed.what_worked.slice(0, 3) : [],

      // Map first what_to_improve item to one_improvement
      one_improvement: Array.isArray(parsed.what_to_improve) && parsed.what_to_improve.length > 0
        ? parsed.what_to_improve[0]
        : "Focus on being more direct while maintaining respect.",

      // Empty risks array (OpenAI version doesn't track this)
      risks: [],

      // Transform rewrite to expected object format
      rewrite: {
        best_practice_version: typeof parsed.rewrite === "string" ? parsed.rewrite : "",
        why_this_is_better: Array.isArray(parsed.what_to_improve) ? parsed.what_to_improve.slice(0, 3) : []
      },

      // Use notes as coaching question, or generate a default
      one_coaching_question: parsed.notes || "What would you change about your response to make it more assertive?",

      // Keep additional fields for compatibility
      style: parsed.verdict === "excellent" || parsed.verdict === "good" ? "assertive" : "mixed",
      passed: score >= passThreshold
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json(transformedResponse);
  } catch (error) {
    console.error("[evaluate.cjs] Fatal error:", error);
    return res.status(500).json({
      error: "Internal server error in evaluate handler",
      details: String(error && error.message ? error.message : error).slice(0, 500),
    });
  }
};
