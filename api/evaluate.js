import fs from 'fs';
import path from 'path';

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CLEAR_DIMENSIONS = ['connect', 'listen', 'express', 'align', 'review'];
const CLEAR_LABELS = {
    connect: 'Connect',
    listen: 'Listen',
    express: 'Express',
    align: 'Align',
    review: 'Review'
};
const SCENARIO_THRESHOLDS = {
    S1: 75,
    S2: 85,
    S3: 90
};

// --- STRICT JSON SCHEMA ---
// This schema is enforced server-side. LLM must output exactly this structure.
const EXPECTED_SCHEMA = {
    style: "string", // passive|aggressive|assertive|mixed (internal use only, NOT shown to UI)
    mode_applied: "string", // calibration|practice
    coaching_state: "string", // calibration|practice_progressing|practice_stalled|practice_regressed|practice_passed
    score_total: "number", // 0-100
    progress_status: "string", // first_attempt|improved|unchanged|regressed
    progress_reason: "string",
    attempt_summary: "string",
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
    primary_focus: {
        clear_dimension: "string",
        label: "string",
        reason: "string"
    },
    revision_target: "string",
    revision_checklist: "array", // 2-3 items
    clear_feedback: {
        connect: { score: "number", status: "string", what_worked: "string", what_to_fix: "string", priority: "string" },
        listen: { score: "number", status: "string", what_worked: "string", what_to_fix: "string", priority: "string" },
        express: { score: "number", status: "string", what_worked: "string", what_to_fix: "string", priority: "string" },
        align: { score: "number", status: "string", what_worked: "string", what_to_fix: "string", priority: "string" },
        review: { score: "number", status: "string", what_worked: "string", what_to_fix: "string", priority: "string" }
    },
    support_level: "string", // normal|narrowed|scaffolded
    scaffold: {
        title: "string",
        items: "array",
        note: "string"
    },
    rewrite: {
        best_practice_version: "string", // 1-3 sentences
        why_this_is_better: "array" // 1-3 bullets
    },
    one_coaching_question: "string",
    pass_rationale: "string"
};

// --- VALIDATION FUNCTIONS ---
function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function sanitizeString(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}

function sanitizeStringArray(value, maxItems = 3) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => sanitizeString(item))
        .filter(Boolean)
        .slice(0, maxItems);
}

function buildDefaultClearScores() {
    return {
        connect: 0,
        listen: 0,
        express: 0,
        align: 0,
        review: 0
    };
}

function buildDefaultClearFeedback() {
    return CLEAR_DIMENSIONS.reduce((acc, dim) => {
        acc[dim] = {
            score: 0,
            status: 'missing',
            what_worked: '',
            what_to_fix: '',
            priority: 'secondary'
        };
        return acc;
    }, {});
}

function inferProgressStatus(previousEvaluation, scoreTotal) {
    if (!previousEvaluation || typeof previousEvaluation.score_total !== 'number') {
        return 'first_attempt';
    }
    if (scoreTotal > previousEvaluation.score_total) return 'improved';
    if (scoreTotal < previousEvaluation.score_total) return 'regressed';
    return 'unchanged';
}

function inferCoachingState(mode, progressStatus, scoreTotal, threshold) {
    if (mode === 'calibration') return 'calibration';
    if (scoreTotal >= threshold) return 'practice_passed';
    if (progressStatus === 'regressed') return 'practice_regressed';
    if (progressStatus === 'unchanged') return 'practice_stalled';
    return 'practice_progressing';
}

function inferSupportLevel(mode, scenarioId, attemptNumber, progressStatus, scoreTotal, threshold) {
    if (mode === 'calibration' || scoreTotal >= threshold) {
        return 'normal';
    }

    if (attemptNumber >= 3 && progressStatus !== 'improved') {
        return scenarioId === 'S2' ? 'scaffolded' : 'narrowed';
    }

    if (attemptNumber >= 2 && progressStatus !== 'improved') {
        return 'narrowed';
    }

    return 'normal';
}

function normalizeClearFeedback(clearFeedback, clearScores, primaryDimension) {
    const normalized = buildDefaultClearFeedback();

    CLEAR_DIMENSIONS.forEach(dim => {
        const source = clearFeedback && typeof clearFeedback === 'object' ? clearFeedback[dim] : null;
        const score = clampNumber(source?.score ?? clearScores[dim], 0, 2);

        normalized[dim] = {
            score,
            status: sanitizeString(source?.status, score === 2 ? 'strong' : score === 1 ? 'partial' : 'missing'),
            what_worked: sanitizeString(source?.what_worked, score > 0 ? `${CLEAR_LABELS[dim]} is present in parts of the response.` : ''),
            what_to_fix: sanitizeString(source?.what_to_fix, score === 2 ? '' : `Strengthen ${CLEAR_LABELS[dim]} on the next attempt.`),
            priority: dim === primaryDimension ? 'primary' : sanitizeString(source?.priority, 'secondary')
        };
    });

    return normalized;
}

function validateAndClampResponse(data, context = {}) {
    const errors = [];
    const threshold = SCENARIO_THRESHOLDS[context.scenarioId] || 75;

    if (typeof data !== 'object' || !data) {
        data = {};
    }

    // Validate score_total (0-100)
    data.score_total = clampNumber(data.score_total, 0, 100);

    // Validate clear_scores (0-2 each)
    const clearScores = buildDefaultClearScores();
    if (!data.clear_scores || typeof data.clear_scores !== 'object') {
        errors.push('clear_scores must be an object');
    }
    CLEAR_DIMENSIONS.forEach(key => {
        clearScores[key] = clampNumber(data.clear_scores?.[key], 0, 2);
    });
    data.clear_scores = clearScores;

    // Validate strengths (1-3 items)
    data.strengths = sanitizeStringArray(data.strengths, 3);
    if (!Array.isArray(data.strengths)) {
        errors.push('strengths must be an array');
    }

    // Validate one_improvement (exactly 1 string)
    data.one_improvement = sanitizeString(data.one_improvement || data.revision_target);
    if (!data.one_improvement) {
        errors.push('one_improvement must be a non-empty string');
    }

    // Validate risks (array)
    data.risks = sanitizeStringArray(data.risks, 3);

    data.revision_target = sanitizeString(data.revision_target || data.one_improvement);
    data.revision_checklist = sanitizeStringArray(data.revision_checklist || data.rewrite?.why_this_is_better, 3);
    data.progress_status = inferProgressStatus(context.previousEvaluation, data.score_total);
    data.progress_reason = sanitizeString(data.progress_reason, data.progress_status === 'first_attempt'
        ? 'This is your first scored attempt in this scenario.'
        : data.progress_status === 'improved'
            ? 'You improved on the previous attempt by addressing part of the earlier gap.'
            : data.progress_status === 'regressed'
                ? 'This attempt lost one or more elements that were present before.'
                : 'The score stayed flat because the main blocking issue is still unresolved.');
    data.mode_applied = context.mode || sanitizeString(data.mode_applied, 'practice');

    const primaryDimension = CLEAR_DIMENSIONS.includes(data.primary_focus?.clear_dimension)
        ? data.primary_focus.clear_dimension
        : CLEAR_DIMENSIONS.reduce((lowest, dim) => {
            if (!lowest) return dim;
            return data.clear_scores[dim] < data.clear_scores[lowest] ? dim : lowest;
        }, null);

    data.primary_focus = {
        clear_dimension: primaryDimension,
        label: CLEAR_LABELS[primaryDimension],
        reason: sanitizeString(
            data.primary_focus?.reason,
            data.revision_target || `Focus on strengthening ${CLEAR_LABELS[primaryDimension]} next.`
        )
    };

    data.clear_feedback = normalizeClearFeedback(data.clear_feedback, data.clear_scores, primaryDimension);
    data.attempt_summary = sanitizeString(data.attempt_summary, data.progress_reason);

    data.coaching_state = sanitizeString(
        data.coaching_state,
        inferCoachingState(data.mode_applied, data.progress_status, data.score_total, threshold)
    );

    data.support_level = sanitizeString(
        data.support_level,
        inferSupportLevel(
            data.mode_applied,
            context.scenarioId,
            Number(context.attemptNumber) || 1,
            data.progress_status,
            data.score_total,
            threshold
        )
    );

    if (!data.scaffold || typeof data.scaffold !== 'object') {
        data.scaffold = { title: '', items: [], note: '' };
    }
    data.scaffold = {
        title: sanitizeString(data.scaffold.title, data.support_level === 'scaffolded' ? 'Blueprint for your next attempt' : data.support_level === 'narrowed' ? 'What to include next' : ''),
        items: sanitizeStringArray(data.scaffold.items, 3),
        note: sanitizeString(data.scaffold.note)
    };

    // Validate rewrite
    if (!data.rewrite || typeof data.rewrite !== 'object') {
        errors.push('rewrite must be an object');
    }
    data.rewrite = {
        best_practice_version: sanitizeString(data.rewrite?.best_practice_version),
        why_this_is_better: sanitizeStringArray(data.rewrite?.why_this_is_better, 3)
    };

    if (data.mode_applied === 'practice') {
        data.rewrite.best_practice_version = '';
        if (data.rewrite.why_this_is_better.length === 0) {
            data.rewrite.why_this_is_better = [...data.revision_checklist];
        }
    }

    // Validate one_coaching_question
    data.one_coaching_question = sanitizeString(data.one_coaching_question, 'What will you add or change first in your next attempt?');
    if (!data.one_coaching_question) {
        errors.push('one_coaching_question must be a non-empty string');
    }

    data.pass_rationale = sanitizeString(
        data.pass_rationale,
        data.score_total >= threshold ? 'This response now meets the threshold because the key blocking issue was addressed clearly.' : ''
    );

    return { data, errors };
}

function parseJSON(text) {
    console.log('[parseJSON] Raw input (first 500 chars):', text?.substring(0, 500));

    if (!text) return null;

    // Try multiple extraction patterns
    let cleanText = text;

    // Pattern 1: ```json ... ``` or ``` ... ```
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        cleanText = jsonMatch[1];
        console.log('[parseJSON] Extracted from code block');
    }

    // Pattern 2: Find first { and last } 
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
        console.log('[parseJSON] Extracted between braces');
    }

    // Sanitize common JSON issues from LLM output
    cleanText = cleanText
        .replace(/[\r\n]+/g, ' ')           // Replace newlines with spaces
        .replace(/,\s*([\]\}])/g, '$1')     // Remove trailing commas
        .replace(/[\x00-\x1f]/g, '')        // Remove control characters
        .trim();

    console.log('[parseJSON] Sanitized (first 300 chars):', cleanText.substring(0, 300));

    try {
        const parsed = JSON.parse(cleanText);
        console.log('[parseJSON] Successfully parsed JSON');
        return parsed;
    } catch (e) {
        console.error('[parseJSON] Failed to parse:', e.message);
        console.error('[parseJSON] Full sanitized text:', cleanText);
        return null;
    }
}

// --- MAIN HANDLER ---
export default async function handler(req, res) {
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
        const kbPath = path.join(process.cwd(), 'assertive_communication_kb.md');
        kbText = fs.readFileSync(kbPath, 'utf-8');
    } catch (e) {
        console.error('Failed to load KB:', e);
        return res.status(500).json({ error: 'Failed to load knowledge base' });
    }

    // Get API Key
    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('No API key configured');
        return res.status(500).json({ error: 'API key not configured' });
    }

    const threshold = SCENARIO_THRESHOLDS[scenarioId] || 75;
    const supportPolicy = scenarioId === 'S2'
        ? 'Escalate from diagnosis to checklist on repeated stalled attempts, then to a blueprint scaffold.'
        : scenarioId === 'S3'
            ? 'Keep scaffolding minimal. Narrow the guidance, but do not provide a model answer or a solving blueprint.'
            : 'Treat this as calibration. Provide the best-practice answer and light explanation only.';

    // Construct LLM Prompt
    const systemPrompt = `You are an expert communication coach evaluating assertive communication using ONLY the provided Knowledge Base.

Scenario ID: ${scenarioId}
Feedback mode: ${mode}
Passing threshold: ${threshold}
Attempt number: ${attemptNumber ?? 1}
Previous evaluation: ${previousEvaluation ? JSON.stringify(previousEvaluation) : 'none'}
Scenario support policy: ${supportPolicy}

KNOWLEDGE BASE:
${kbText}

OUTPUT CONTRACT:
- Return ONLY valid JSON.
- Use this schema exactly:
${JSON.stringify(EXPECTED_SCHEMA, null, 2)}

GLOBAL RULES:
- Use calm, concrete, learner-facing coaching language.
- Reference what the learner did or did not do.
- Never moralize.
- Never expose internal pattern IDs or evaluator mechanics.
- The "style" field is internal only; do not mention style labels in learner-facing text.
- CLEAR scores use 0=missing, 1=partial, 2=clear.
- Overall score is 0-100 and should reflect CLEAR coverage, clarity, tone, and next-step quality.

MODE RULES:
- In calibration mode:
  - Return one strong best-practice answer in rewrite.best_practice_version.
  - Keep the explanation lightweight.
  - Do not generate staged retry coaching.
  - one_improvement should explain what makes the model answer stronger than weaker answers.
- In practice mode:
  - rewrite.best_practice_version MUST be an empty string.
  - Never provide sentence wording, quoted phrases to copy, or a complete response.
  - Diagnose ONE primary blocking issue only.
  - Secondary issues must stay visibly lower priority.
  - revision_target must be one concrete learner action for the next attempt.
  - revision_checklist must be 2-3 structural checks, not wording examples.
  - If the learner is stuck, scaffold structurally with components, a blueprint, or sentence roles, but NOT a complete answer.

PROGRESS RULES:
- Compare this attempt with previousEvaluation when available.
- If the learner fixed part of the prior blocking issue, progress_status should reflect improvement.
- Do not remove previously earned strengths unless the learner clearly removed them.
- If the learner regressed, explain what was lost.
- attempt_summary should explain the current state in one sentence.

COACHING STATE RULES:
- coaching_state must be one of:
  - calibration
  - practice_progressing
  - practice_stalled
  - practice_regressed
  - practice_passed
- practice_passed should be used when the response meets or exceeds the passing threshold.

CLEAR FEEDBACK RULES:
- clear_feedback must cover connect, listen, express, align, review.
- Each dimension needs:
  - score
  - status
  - what_worked
  - what_to_fix
  - priority
- Exactly one dimension may have priority="primary" in practice mode.

SCAFFOLDING RULES:
- support_level must be one of normal, narrowed, scaffolded.
- For a first attempt, normal is preferred.
- For repeated stalled attempts, narrowed or scaffolded may be used according to the scenario support policy.
- scaffold.items must contain only structural prompts or components, never a full answer.

QUALITY BAR:
- The feedback must help the learner revise their own answer.
- The response must feel like coaching, not correction by replacement.
- The learner should always know what to do next without being handed wording.

EVALUATE THE FOLLOWING:`;

    const userPrompt = `Scenario: ${situationText}

Learner's Response: "${answer}"

Provide your evaluation as strict JSON only.`;

    // Call LLM (Gemini API) with retry handling
    // Step 6: Retry & Error UX - Automatic retry for transient failures (503, 429, timeout, network).
    // This ensures learner fairness: failed attempts do NOT count against learner.
    const RETRY_DELAYS = [500, 1200, 2500]; // Backoff delays in ms
    const MAX_ATTEMPTS = 3;
    let llmResponse;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent?key=${apiKey}`, {
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
                console.warn(`[Attempt ${attempt}/${MAX_ATTEMPTS}] ${lastError}, retrying...`);
                if (attempt < MAX_ATTEMPTS) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
                    continue;
                }
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`LLM API error (Status: ${response.status} ${response.statusText}):`, errorText.substring(0, 500));
                // Non-retryable error (e.g., 400, 401, 404)
                return res.status(500).json({ error: `LLM API request failed: ${response.status} ${response.statusText}` });
            }

            llmResponse = await response.json();
            break; // Success, exit retry loop

        } catch (e) {
            lastError = e.message || 'Network error';
            const isRetryable = e.name === 'AbortError' || e.message?.includes('fetch') || e.message?.includes('network') || e.message?.includes('timeout');

            console.warn(`[Attempt ${attempt}/${MAX_ATTEMPTS}] LLM fetch error: ${lastError}`);

            if (isRetryable && attempt < MAX_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
                continue;
            }

            // Non-retryable error or last attempt
            if (!isRetryable) {
                console.error('LLM fetch error (non-retryable):', e);
                return res.status(500).json({ error: 'Failed to call LLM API' });
            }
        }
    }

    // If we exhausted all retries without success
    // IMPORTANT (Step 6): This error response does NOT increment learner attempts.
    // The frontend only records attempts on successful evaluations.
    // Failed calls preserve the learner's pre-call state completely.
    if (!llmResponse) {
        console.error(`LLM API unavailable after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`);
        // Return 503 (not 500) with calm, neutral, retry-oriented message.
        // No technical details or blame language exposed to learner.
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
        console.error('Failed to extract LLM response text:', e);
        return res.status(500).json({ error: 'Invalid LLM response format' });
    }

    // Parse JSON
    let parsedData = parseJSON(responseText);

    // If invalid, retry once with fix instruction
    if (!parsedData) {
        console.log('First parse failed, retrying with fix instruction...');
        try {
            const fixPrompt = `Your previous response was not valid JSON. Please fix it to match this exact schema and output ONLY the JSON, no other text:
${JSON.stringify(EXPECTED_SCHEMA, null, 2)}

Your previous response was:
${responseText}

Output corrected JSON only:`;

            const retryResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent?key=${apiKey}`, {
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
            console.error('Retry failed:', e);
        }
    }

    // If still invalid, return error
    if (!parsedData) {
        return res.status(500).json({ error: 'Failed to get valid JSON from LLM after retry' });
    }

    // Validate and clamp response
    const { data: validatedData, errors } = validateAndClampResponse(parsedData, {
        mode,
        previousEvaluation,
        attemptNumber,
        scenarioId
    });

    if (errors.length > 0) {
        console.warn('Validation warnings:', errors);
    }

    // Return validated response (note: 'style' is included for internal logic but UI should NOT display it)
    return res.status(200).json(validatedData);
}
