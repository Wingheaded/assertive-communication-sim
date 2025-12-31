## Step 4 — Implementation Guidance for Code Agent (No Re-Architecture)

### Goal
Implement the **post-simulation AI Coach activity** exactly as defined in:
- **Spec.md** (frozen core engine)
- **Spec_AICoach — Assertive Communication AI Coach Activity (MVP)** (extension)
- **assertive_communication_kb.md** (single source of truth; must ground all feedback)

Do **not** change any existing branching engine behavior.

---

## A) What to Implement (MVP Scope)

### 1) New state type: `aiCoach`
Add support for a new state type in the front-end state renderer (keeping existing state machine intact).

**Required fields (per spec):**
- `id` (string)
- `type`: `"aiCoach"`
- `situationText` (string — required for evaluation)
- `next` (string — next state ID)

**Optional fields:**
- `title`, `prompt`, `video`, `submitLabel`, `continueLabel` (as in spec)

### 2) UI behavior (front-end)
The `aiCoach` screen must support:
- Show `title` (if present)
- Show `situationText` clearly (this is the prompt context)
- Provide a **text input** for the learner’s response (John’s reply)
- Provide actions:
  - **Evaluate** (calls backend)
  - **Retry** (clears input and feedback, stays in same aiCoach state)
  - **Continue** (go to `next` state; only enabled after at least one evaluation)

### 3) Minimal backend proxy (security)
Implement **one endpoint**:
- `POST /api/evaluate`

Backend responsibilities:
- Load and inject KB from `/kb/assertive_communication_kb.md`
- Forward scenario + learner answer + KB to LLM provider (OpenAI/Gemini)
- Enforce **strict JSON output** (no markdown; no extra prose)
- Hide API keys (no keys in front-end)

---

## B) Required API Contract (per spec)

### Request body
```json
{
  "scenarioId": "ai_coach_activity_01",
  "situationText": "<string>",
  "userAnswer": "<string>"
}
```

### Response (STRICT JSON)
Spec_AICoach implies these required concepts:
- overall score **0–100**
- CLEAR sub-scores **0–2 each**
- coaching feedback grounded in KB
- best-practice rewrite (1–3 sentences)
- a single coaching question

**Implement a response object that includes at least:**
```json
{
  "scenarioId": "ai_coach_activity_01",
  "overall_score": 0,
  "clear_subscores": { "connect": 0, "listen": 0, "express": 0, "align": 0, "review": 0 },
  "strengths": ["..."],
  "one_improvement": "...",
  "risks": ["..."],
  "rewrite": {
    "best_practice_version": "...",
    "why_this_is_better": ["..."]
  },
  "one_coaching_question": "..."
}
```
Notes:
- Keep keys stable and predictable.
- `strengths` should be 1–3 items max.
- `one_improvement` must be exactly one focused change.
- `risks` can be empty; include flags like hostility/inappropriate language if present (per spec).

---

## C) Evaluator Logic (must match KB + Spec)

### What the evaluator judges (Scenario 01)
The evaluator must judge whether the learner can **produce** an assertive written reply under pressure.

### Observable criteria (KB-grounded)
Evaluation should look for:
- Respectful, calm, direct tone (not passive/aggressive)
- Acknowledgement of the other person’s concern ("I understand…")
- “I” language to express own position/limits
- Concrete next step/request (action-oriented)
- Clarity and structure

### Scoring mapping (practical)
Use CLEAR as the scoring frame:
- Each letter scored 0–2
  - 0 = missing / opposite
  - 1 = partial / weak
  - 2 = clearly present
- Overall score 0–100 derived deterministically from sub-scores + quality signals.
  - Example mapping approach (implementation detail): normalize (sum subscores / 10) * 100, then adjust within ±10 for clarity/tone.

### Rewrite constraints (per spec)
- 1–3 sentences
- Respectful, direct, collaborative
- Includes a clear request or next step

---

## D) Prompting rules for the LLM (backend)

### Hard constraints (must be in system/developer prompt)
- Use **only** the provided KB. Do not introduce new terminology/frameworks.
- Output **strict JSON** that matches the schema (no markdown, no extra text).
- If the learner input is hostile/inappropriate:
  - Add a risk flag
  - Still provide a respectful rewrite
- No medical/legal/HR advice.

### Prompt payload structure (recommended)
Send to the model:
- KB text
- scenarioId
- situationText
- userAnswer
- The exact JSON schema expected
- Scoring rules (0–100 overall, 0–2 CLEAR)

### Determinism controls (recommended)
- Use low temperature.
- Add JSON validation server-side.
- If invalid JSON returned: retry once with a “fix JSON to schema” prompt; if still invalid, return 500.

---

## E) Front-end rendering guidance (no redesign)

### Inputs
- `state.situationText`
- learner `userAnswer`

### Outputs to show
- overall score
- CLEAR sub-scores (simple row/labels)
- strengths (bullets)
- one improvement (single sentence)
- best-practice rewrite (quoted block)
- why this is better (1–3 bullets)
- one coaching question

### UX rules
- Keep it lightweight and consistent with existing UI.
- Never show internal labels like “passive/aggressive”; show coaching feedback instead.

---

## F) Scenario 01 integration
Add a single `aiCoach` state after the simulation completes:
- `scenarioId`: `ai_coach_activity_01`
- `situationText`: use the exact scenario text defined in the Scenario 01 canvas doc
- `next`: state that continues the learning experience after the activity

---

## G) Acceptance checkpoints (quick self-test)
- [ ] Existing branching simulation runs exactly as before (no behavior changes in frozen states).
- [ ] The new `aiCoach` state renders and is reachable from the post-simulation flow.
- [ ] The `aiCoach` screen displays `situationText` and provides a text input for the learner response.
- [ ] Clicking **Evaluate** sends `scenarioId`, `situationText`, and `userAnswer` to `POST /api/evaluate`.
- [ ] Backend uses a server-side API key (no keys shipped to the browser; no keys returned in responses).
- [ ] Backend injects the full KB text into the LLM request and instructs: **use only KB concepts**.
- [ ] Backend returns **valid JSON** matching the agreed schema (no markdown, no extra prose).
- [ ] UI renders: overall score, CLEAR subscores, strengths, one improvement, risks (if any), rewrite, why-better bullets, and one coaching question.
- [ ] **Retry** clears input + clears feedback and stays on the same `aiCoach` state.
- [ ] **Continue** is disabled until at least one successful evaluation; then it advances to `next`.
- [ ] Hostile/inappropriate learner input is handled gracefully: risks are flagged and feedback stays respectful.
- [ ] If the model returns invalid JSON, backend retries once with a “fix to schema” instruction; if still invalid, return an error and UI shows a safe message.
- [ ] Rewrite stays 1–3 sentences and includes a concrete next step/request.
- [ ] No new frameworks/terminology appear anywhere in feedback (strict KB alignment).

