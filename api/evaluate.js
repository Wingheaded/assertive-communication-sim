import fs from 'fs';
import path from 'path';

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

    const { scenarioId, situationText, learnerAnswer, userAnswer } = req.body;
    const answer = learnerAnswer || userAnswer; // Accept both field names

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

    // Construct LLM Prompt
    const systemPrompt = `You are an expert communication coach. You evaluate learner responses using ONLY the concepts from the provided Knowledge Base. Do NOT introduce any new frameworks or terminology.

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
    "best_practice_version": "<1-3 sentences, must include concrete next step or request>",
    "why_this_is_better": ["<1-3 bullets referencing CLEAR or KB rules>"]
  },
  "one_coaching_question": "<prompt for reflection or second attempt>"
}

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

EVALUATE THE FOLLOWING:`;

    const userPrompt = `Scenario: ${situationText}

Learner's Response: "${answer}"

Provide your evaluation as strict JSON only.`;

    // Call LLM (Gemini API)
    let llmResponse;
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`LLM API error (Status: ${response.status} ${response.statusText}):`, errorText.substring(0, 500)); // Log status and first 500 chars
            return res.status(500).json({ error: `LLM API request failed: ${response.status} ${response.statusText}` });
        }

        llmResponse = await response.json();
    } catch (e) {
        console.error('LLM fetch error:', e);
        return res.status(500).json({ error: 'Failed to call LLM API' });
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

            const retryResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
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
    const { data: validatedData, errors } = validateAndClampResponse(parsedData);

    if (errors.length > 0) {
        console.warn('Validation warnings:', errors);
    }

    // Return validated response (note: 'style' is included for internal logic but UI should NOT display it)
    return res.status(200).json(validatedData);
}
