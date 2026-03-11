import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the GEMINI_API_KEY secret
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// --- STRICT JSON SCHEMA ---
// This schema is enforced server-side. LLM must output exactly this structure.
const EXPECTED_SCHEMA = {
    style: "string", // passive|aggressive|assertive|mixed (internal use only, NOT shown to UI)
    score_total: "number", // 0-100
    clear_scores: {
        connect: "number", // 0-2
        listen: "number",  // 0-2
        express: "number", // 0-2
        align: "number",   // 0-2
        review: "number"   // 0-2
    },
    strengths: "array", // 1-3 items
    one_improvement: "string", // exactly 1
    risks: "array", // 0+ items
    rewrite: {
        best_practice_version: "string", // 1-3 sentences
        why_this_is_better: "array" // 1-3 bullets
    },
    one_coaching_question: "string"
};

// --- VALIDATION FUNCTIONS ---
function validateAndClampResponse(data) {
    const errors = [];

    // Validate score_total (0-100)
    if (typeof data.score_total !== 'number' || data.score_total < 0 || data.score_total > 100) {
        data.score_total = Math.max(0, Math.min(100, Number(data.score_total) || 0));
    }

    // Validate clear_scores (0-2 each)
    if (data.clear_scores && typeof data.clear_scores === 'object') {
        for (const key of ['connect', 'listen', 'express', 'align', 'review']) {
            if (typeof data.clear_scores[key] !== 'number' || data.clear_scores[key] < 0 || data.clear_scores[key] > 2) {
                data.clear_scores[key] = Math.max(0, Math.min(2, Number(data.clear_scores[key]) || 0));
            }
        }
    } else {
        errors.push('clear_scores must be an object');
    }

    // Validate strengths (1-3 items)
    if (!Array.isArray(data.strengths)) {
        errors.push('strengths must be an array');
        data.strengths = [];
    } else if (data.strengths.length > 3) {
        data.strengths = data.strengths.slice(0, 3);
    }

    // Validate one_improvement (exactly 1 string)
    if (typeof data.one_improvement !== 'string' || !data.one_improvement.trim()) {
        errors.push('one_improvement must be a non-empty string');
    }

    // Validate risks (array)
    if (!Array.isArray(data.risks)) {
        data.risks = [];
    }

    // Validate rewrite
    if (!data.rewrite || typeof data.rewrite !== 'object') {
        errors.push('rewrite must be an object');
    } else {
        if (typeof data.rewrite.best_practice_version !== 'string') {
            errors.push('rewrite.best_practice_version must be a string');
        }
        if (!Array.isArray(data.rewrite.why_this_is_better)) {
            data.rewrite.why_this_is_better = [];
        } else if (data.rewrite.why_this_is_better.length > 3) {
            data.rewrite.why_this_is_better = data.rewrite.why_this_is_better.slice(0, 3);
        }
    }

    // Validate one_coaching_question
    if (typeof data.one_coaching_question !== 'string' || !data.one_coaching_question.trim()) {
        errors.push('one_coaching_question must be a non-empty string');
    }

    return { data, errors };
}

function parseJSON(text) {
    logger.info('[parseJSON] Raw input (first 500 chars):', text?.substring(0, 500));

    if (!text) return null;

    // Try multiple extraction patterns
    let cleanText = text;

    // Pattern 1: ```json ... ``` or ``` ... ```
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        cleanText = jsonMatch[1];
        logger.info('[parseJSON] Extracted from code block');
    }

    // Pattern 2: Find first { and last } 
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
        logger.info('[parseJSON] Extracted between braces');
    }

    // Sanitize common JSON issues from LLM output
    cleanText = cleanText
        .replace(/[\r\n]+/g, ' ')           // Replace newlines with spaces
        .replace(/,\s*([\]\}])/g, '$1')     // Remove trailing commas
        .replace(/[\x00-\x1f]/g, '')        // Remove control characters
        .trim();

    logger.info('[parseJSON] Sanitized (first 300 chars):', cleanText.substring(0, 300));

    try {
        const parsed = JSON.parse(cleanText);
        logger.info('[parseJSON] Successfully parsed JSON');
        return parsed;
    } catch (e) {
        logger.error('[parseJSON] Failed to parse:', e.message);
        logger.error('[parseJSON] Full sanitized text:', cleanText);
        return null;
    }
}

// --- MAIN CLOUD FUNCTION ---
export const evaluate = onRequest(
    { secrets: [geminiApiKey], cors: true, maxInstances: 10, timeoutSeconds: 60 },
    async (req, res) => {
        // Only allow POST
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const { scenarioId, situationText, learnerAnswer, userAnswer, feedbackMode, previousEvaluation, attemptNumber } = req.body;
        const answer = learnerAnswer || userAnswer; // Accept both field names
        const mode = feedbackMode || 'practice'; // Default to practice mode

        // Validate input
        if (!scenarioId || !situationText || !answer) {
            return res.status(400).json({ error: 'Missing required fields: scenarioId, situationText, learnerAnswer' });
        }

        // Load Knowledge Base
        let kbText;
        try {
            const kbPath = path.join(__dirname, 'assertive_communication_kb.md');
            kbText = fs.readFileSync(kbPath, 'utf-8');
        } catch (e) {
            logger.error('Failed to load KB:', e);
            return res.status(500).json({ error: 'Failed to load knowledge base' });
        }

        // Get API Key from Secret Manager (in production) or local env variable (if testing locally without secrets)
        const apiKey = geminiApiKey.value() || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
        if (!apiKey) {
            logger.error('No API key configured. Make sure GEMINI_API_KEY secret is set.');
            return res.status(500).json({ error: 'API key not configured' });
        }

        // Construct LLM Prompt
        const systemPrompt = `FEEDBACK MODE:
${mode}

Where:
- "calibration" = learner is being shown a best-practice example to study
- "practice" = learner must generate their own improved response

PREVIOUS EVALUATION (for scoring stability):
${previousEvaluation ? JSON.stringify(previousEvaluation) : "none"}

ATTEMPT NUMBER:
${attemptNumber ?? 1}

You are an expert communication coach. You evaluate learner responses using ONLY the concepts from the provided Knowledge Base. Do NOT introduce any new frameworks or terminology.

KNOWLEDGE BASE:
${kbText}

---

STRICT OUTPUT RULES:
1. Output ONLY valid JSON - no markdown, no code blocks, no extra text.
2. Follow this exact schema:
{
  "style": "passive|aggressive|assertive|mixed",
  "score_total": <0-100>,
  "clear_scores": {
    "connect": <0-2>,
    "listen": <0-2>,
    "express": <0-2>,
    "align": <0-2>,
    "review": <0-2>
  },
  "strengths": ["<1-3 items>"],
  "one_improvement": "<exactly one focused coaching adjustment>",
  "risks": ["<0+ items, flag hostile/inappropriate language if present>"],
  "rewrite": {
    "best_practice_version": "<calibration: 1-3 sentences with concrete next step/request | practice: empty string \"\">",
    "why_this_is_better": ["<1-3 bullets referencing CLEAR or KB rules>"]
  },
  "one_coaching_question": "<prompt for reflection or second attempt>"
}

REWRITE RULES (CRITICAL):

- If FEEDBACK MODE is "calibration":
  - Provide a clear, complete best-practice response.
  - This version may be used by the learner as a reference example.
  - Ensure it aligns strongly with CLEAR and includes a concrete next step or request.

- If FEEDBACK MODE is "practice":
  - DO NOT provide a full rewritten response.
  - Set "best_practice_version" to an empty string "".
  - Use "why_this_is_better" to describe structural elements only (what to add or strengthen),
    without phrasing, sentences, or example wording.
  - In practice mode, do not include example sentences, quoted phrases, or "say/write…" wording guidance anywhere in the JSON fields. Describe only structural elements.

CALIBRATION BEHAVIOR LOCK (CRITICAL):

When feedback_mode === "calibration" (Scenario 1 / demonstration mode):

1) OUTPUT RESTRICTIONS:
   - Return ONLY the best-practice answer in "best_practice_version".
   - The answer must demonstrate ALL 5 CLEAR steps naturally:
     * (C) Open with acknowledgment or empathy
     * (L) Reflect or validate their concern
     * (E) State boundary/position with impact
     * (A) Propose specific next step
     * (R) Confirm agreement/check-back
   - Keep it natural and human — NO checklist tone.
   - Remove meta-explanations ("This shows..." / "Notice how...").
   - Avoid hedging, ambiguity, or mixed intent.

2) DISABLED FEATURES (CALIBRATION ONLY):
   - DO NOT generate diagnostic feedback or coaching commentary.
   - DO NOT generate practice cues or retry hints.
   - DO NOT reference attemptNumber — ignore it completely.
   - DO NOT use stuck detection logic — bypass entirely.
   - DO NOT escalate or adapt based on retries — output is static.
   - DO NOT provide "one_improvement" as coaching — frame as observation only.

3) FIELD BEHAVIOR IN CALIBRATION:
   - "strengths": List 1-2 observable elements present in the best-practice version.
   - "one_improvement": Observation about what differentiates this answer from weaker ones (NOT a coaching instruction).
   - "risks": Empty array [].
   - "why_this_is_better": 1-2 bullets describing structural elements demonstrated.
   - "one_coaching_question": A reflective prompt for the learner to internalize the example.

4) LEAKAGE PREVENTION:
   - NEVER reuse calibration logic in practice mode.
   - Practice scenarios MUST NEVER surface the full model answer.
   - Calibration content is for demonstration only — not coaching material.

ONE_IMPROVEMENT RULES:

- In "calibration" mode:
  - Frame the improvement as an observation about what differentiates this response from weaker ones.
  - It may reference what is present in the best-practice version.

- In "practice" mode:
  - Frame the improvement as a missing or weak structural element.
  - It must be score-predictive.
  - Do NOT suggest wording, sentences, or example phrases.

SCORING STABILITY RULE:

- If the learner incorporates the previous "one_improvement" correctly,
  the score must increase or remain the same.
- Do not reduce previously earned CLEAR sub-scores unless the learner explicitly removes
  or contradicts that element.

STUCK DETECTION RULE:

- If attemptNumber is 2 or higher
  AND previousEvaluation is provided
  AND score_total has NOT increased compared to previousEvaluation.score_total:

  Then:
  - Explicitly state which ONE CLEAR element (Connect, Listen, Express, Align, or Review)
    is currently missing or weakest and is blocking improvement.
  - Reference only that single CLEAR element.
  - Do NOT provide example sentences or phrasing.
  - Use structural, diagnostic language only.

SCORING GUIDANCE:
- CLEAR sub-scores: 0 = missing/opposite, 1 = partial/weak, 2 = clearly present
- Overall score: Derive from sub-scores + quality signals (clarity, tone, specificity)
- If learner input is hostile: add to risks array, still provide respectful rewrite

TONE & LANGUAGE RULES (CRITICAL):
- Write like a calm, supportive coach focusing on IMPACT and NEXT STEPS
- NEVER use analytical style labels in learner-facing text (e.g., "The aggressive style aims to...", "passive style...", "assertive approach...")
- NEVER use moralizing words like "bad", "wrong", "dominate", "manipulative"
- INSTEAD, use impact-focused phrasing:
  * "This response may come across as dismissive..."
  * "This could be perceived as confrontational..."
  * "This might make it harder to maintain collaboration..."
  * "The other person may feel unheard..."
  * "This phrasing could unintentionally escalate tension..."
- Focus on observable impact, not character judgment
- Keep feedback constructive and forward-looking
- The "style" field is for internal scoring only - do NOT reference it in strengths, one_improvement, risks, or rewrite

CLEAR ANCHORS (Light References):
- Include 1-2 CLEAR step references (max) across the ENTIRE response to help learners connect feedback to the CLEAR framework
- Use sparingly and naturally - do NOT force mentions in every field
- In "one_improvement": optionally prefix with (Connect), (Listen), (Express), (Align), or (Review) when it fits naturally
- In "rewrite.why_this_is_better": include at most 1-2 CLEAR references total across all bullets
- Format examples:
  * "(Express) Add a clear 'I' statement that names your constraint."
  * "(Align) Propose a concrete next step with a time or date."
  * "This version includes a Listen moment to acknowledge their concern."
- Do NOT overuse: no more than 2 CLEAR mentions total in the entire JSON response

CLEAR FEEDBACK MICRO-FORMAT (CRITICAL):

For EACH of the 5 CLEAR dimensions (Connect, Listen, Express, Align, Review), generate feedback text internally using this strict 3-line format:

  Line 1 - What worked: One specific element from the learner's answer that demonstrates this dimension (or "Not yet demonstrated" if score=0).
  Line 2 - What's missing: One specific, observable element missing from the learner's answer. Reference concrete absence (e.g., "missing acknowledgment of their concern", "no specific timeframe proposed", "boundary stated but no request attached").
  Line 3 - Micro-fix: One actionable instruction starting with a verb (e.g., "Add...", "Include...", "State...", "Propose...", "Acknowledge...").

LENGTH CONSTRAINTS:
- Each line MUST be 8-20 words. No shorter, no longer.
- No extra paragraphs, bullet lists, or headers.
- Keep all 3 lines as plain sentences.

TONE CONSTRAINTS:
- Calm, direct, supportive, non-chatty.
- No moralizing ("you should have...", "it's important to...").
- No lecturing or over-explaining.
- Never say "as an AI" or similar.
- Focus on observable behavior, not character.

ANTI-REPETITION RULE (CRITICAL):
- The "What's missing" line MUST be unique across all 5 CLEAR dimensions for a given attempt.
- If two dimensions would naturally point to the same gap, assign the diagnostic to the MOST relevant dimension and find a different (true) gap for the other.
- Example: If both Express and Align lack specificity, assign "missing specific request" to Express and assign "missing proposed timeline" to Align.

SPECIFICITY RULE:
- Every "What's missing" must reference an observable element in the learner's answer.
- BAN vague phrases unless tied to a concrete missing element:
  * BANNED: "be clearer", "communicate better", "more assertive", "try harder"
  * ALLOWED: "missing acknowledgment of their deadline pressure", "no 'I' statement present", "request lacks a specific action or date"

PRACTICE CUE ALIGNMENT (CRITICAL):

1) SINGLE SOURCE OF TRUTH:
   - First, identify the BLOCKING_STEP: the lowest-scoring CLEAR dimension (0 or 1) that is most critical.
   - Priority order for tie-breaking: Listen > Express > Align > Connect > Review.
   - The \`one_improvement\` field MUST target this BLOCKING_STEP and no other.
   - The internal practice cue used in feedback MUST also reference the same BLOCKING_STEP.

2) ONE_IMPROVEMENT FORMAT:
   - MUST start with the BLOCKING_STEP prefix: "(Connect)", "(Listen)", "(Express)", "(Align)", or "(Review)".
   - MUST be 12-18 words, exactly 1 sentence.
   - MUST be actionable (start with a verb after the prefix).

3) STEP-SPECIFIC CUE TEMPLATES:
   Use these as structural guides for the BLOCKING_STEP cue:
   
   CONNECT: "Acknowledge their perspective or concern before stating your position."
   LISTEN: "Reflect their concern in one line to confirm you understood correctly."
   EXPRESS: "State your boundary or request directly with a clear impact statement."
   ALIGN: "Propose one concrete next step with owner and timeframe, then ask for agreement."
   REVIEW: "Confirm mutual agreement with who does what by when, plus a check-back point."

4) PREVENT MIXED SIGNALS:
   - For NON-BLOCKING steps (not the BLOCKING_STEP), the "What's missing" line must be LOW-STAKES.
   - Use softer framing for non-blocking steps:
     * "A small upgrade would be…"
     * "You could strengthen this by…"
     * "Nice to add but not critical…"
   - Do NOT introduce a competing "primary fix" in any step other than the BLOCKING_STEP.
   - The learner must receive ONE clear improvement target, not multiple equal-priority fixes.

5) ALIGNMENT CHECK:
   Before finalizing output, verify:
   - \`one_improvement\` prefix matches the BLOCKING_STEP.
   - The BLOCKING_STEP's feedback contains the highest-priority "What's missing".
   - All other steps have softer, secondary improvement language.

Apply this micro-format internally when generating the "strengths", "one_improvement", and "rewrite.why_this_is_better" fields. The resulting text should feel consistent, diagnostic, and actionable across all CLEAR dimensions.

INTERNAL IMPROVEMENT PATTERNS (Step 7 - INTERNAL GUIDANCE ONLY):

Use these patterns to anchor consistent, non-repetitive feedback. Select the best-matching pattern for the BLOCKING_STEP based on what is missing in the learner's answer.

CONNECT PATTERNS:
  P1: Missing opener - No empathy or acknowledgment before stating position
  P2: Blaming opener - Opens with accusation or defensiveness
  P3: Missing context validation - Doesn't acknowledge their situation/constraints
  P4: Cold/transactional tone - Jumps straight to business without warmth
  P5: Over-apologizing - Excessive disclaimers that undermine position

LISTEN PATTERNS:
  P1: No reflection - Doesn't echo or summarize their concern
  P2: Misread concern - Reflects the wrong issue or misinterprets
  P3: Dismissive acknowledgment - Surface acknowledgment without substance
  P4: Assumed understanding - Skips confirmation that they understood correctly
  P5: Interrupting tone - Jumps to solution before validating their perspective

EXPRESS PATTERNS:
  P1: Missing "I" statement - No ownership of position/constraint
  P2: Vague boundary - Boundary stated but not specific or actionable
  P3: Missing impact - States position but not why it matters
  P4: Passive phrasing - Indirect/hedging language instead of clear statement
  P5: Mixed signals - Says yes and no in same breath, confusing intent
  P6: Missing request - States constraint but no ask attached

ALIGN PATTERNS:
  P1: No next step - Missing concrete proposed action
  P2: Vague timeline - Next step lacks specific when/who/what
  P3: One-sided solution - Proposes action without seeking agreement
  P4: Too many options - Multiple competing proposals confuse action
  P5: No ownership - Next step lacks clear owner (who does what)
  P6: Missing ask - Proposes but doesn't confirm "does this work?"

REVIEW PATTERNS:
  P1: No check-back - Missing follow-up or confirmation point
  P2: No recap - Ends without summarizing agreed action
  P3: Vague close - Ends ambiguously without clear conclusion
  P4: Missing accountability - No who/what/when confirmation
  P5: No verification ask - Doesn't confirm mutual understanding

PATTERN USAGE RULES:
1) For the BLOCKING_STEP only, select ONE pattern that best matches the gap.
2) Use the pattern to guide "What's missing" and "Micro-fix" phrasing.
3) Keep one_improvement aligned with the selected pattern's focus.
4) If previousEvaluation exists: prefer a DIFFERENT pattern than last attempt (rotation).
5) If pattern confidence is low, use generic diagnostic language.
6) NEVER stack multiple patterns in one attempt.
7) NEVER expose pattern IDs to the learner - these are internal only.

EVALUATE THE FOLLOWING:`;

        const userPrompt = `Scenario: ${situationText}

Learner's Response: "${answer}"

Provide your evaluation as strict JSON only.`;

        // Call LLM (Gemini API) with retry handling
        const RETRY_DELAYS = [500, 1200, 2500]; // Backoff delays in ms
        const MAX_ATTEMPTS = 3;
        let llmResponse;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [
                            { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
                        ],
                        generationConfig: {
                            temperature: 0.3,
                            maxOutputTokens: 2048
                        }
                    })
                });

                clearTimeout(timeoutId);

                // Check for retryable status codes
                if (response.status === 503 || response.status === 429) {
                    lastError = `LLM API returned ${response.status}`;
                    logger.warn(`[Attempt ${attempt}/${MAX_ATTEMPTS}] ${lastError}, retrying...`);
                    if (attempt < MAX_ATTEMPTS) {
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
                        continue;
                    }
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    logger.error(`LLM API error (Status: ${response.status} ${response.statusText}):`, errorText.substring(0, 500));
                    return res.status(500).json({ error: `LLM API request failed: ${response.status} ${response.statusText}` });
                }

                llmResponse = await response.json();
                break; // Success, exit retry loop

            } catch (e) {
                lastError = e.message || 'Network error';
                const isRetryable = e.name === 'AbortError' || e.message?.includes('fetch') || e.message?.includes('network') || e.message?.includes('timeout');

                logger.warn(`[Attempt ${attempt}/${MAX_ATTEMPTS}] LLM fetch error: ${lastError}`);

                if (isRetryable && attempt < MAX_ATTEMPTS) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
                    continue;
                }

                if (!isRetryable) {
                    logger.error('LLM fetch error (non-retryable):', e);
                    return res.status(500).json({ error: 'Failed to call LLM API' });
                }
            }
        }

        if (!llmResponse) {
            logger.error(`LLM API unavailable after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`);
            return res.status(503).json({
                error: 'LLM_TEMP_UNAVAILABLE',
                message: 'AI service temporarily unavailable. Please try again.'
            });
        }

        // Extract text from Gemini response
        let responseText;
        try {
            responseText = llmResponse.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!responseText) {
                throw new Error('No text in response');
            }
        } catch (e) {
            logger.error('Failed to extract LLM response text:', e);
            return res.status(500).json({ error: 'Invalid LLM response format' });
        }

        // Parse JSON
        let parsedData = parseJSON(responseText);

        // If invalid, retry once with fix instruction
        if (!parsedData) {
            logger.info('First parse failed, retrying with fix instruction...');
            try {
                const fixPrompt = `Your previous response was not valid JSON. Please fix it to match this exact schema and output ONLY the JSON, no other text:
${JSON.stringify(EXPECTED_SCHEMA, null, 2)}

Your previous response was:
${responseText}

Output corrected JSON only:`;

                const retryResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [
                            { role: 'user', parts: [{ text: fixPrompt }] }
                        ],
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 2048
                        }
                    })
                });

                if (retryResponse.ok) {
                    const retryData = await retryResponse.json();
                    const retryText = retryData.candidates?.[0]?.content?.parts?.[0]?.text;
                    parsedData = parseJSON(retryText);
                }
            } catch (e) {
                logger.error('Retry failed:', e);
            }
        }

        if (!parsedData) {
            return res.status(500).json({ error: 'Failed to get valid JSON from LLM after retry' });
        }

        // Validate and clamp response
        const { data: validatedData, errors } = validateAndClampResponse(parsedData);

        if (errors.length > 0) {
            logger.warn('Validation warnings:', errors);
        }

        return res.status(200).json(validatedData);
    }
);
