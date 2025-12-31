Relationship to Spec.md
This specification extends the system defined in Spec.md.
It introduces a new post-simulation activity (aiCoach) that runs only after the initial branching scenario is completed.
All core engine behavior defined in Spec.md remains unchanged.

# Spec_AICoach.md — Assertive Communication AI Coach Activity (MVP)

## 1. Purpose
Add a new activity to the existing **branching-video-sim** app: a post-branch exercise where the learner types “John’s reply” to a new Anna situation and receives structured coaching feedback grounded in the course content (assertive communication + CLEAR framework).

**Non-goals (MVP)**
- No Storyline integration.
- No voice input/output.
- No streaming / real-time agent conversation.
- No user accounts, no database, no analytics pipeline.
- No advanced RAG platform (use a simple local KB file first).

---

## 2. Target Outcome
After completing the first branching scenario, the learner enters a new activity:

1) Anna presents a new situation (video or text)
2) Learner types John’s response
3) AI Coach returns:
- classification: passive / aggressive / assertive / mixed
- overall score (0–100)
- CLEAR sub-scores
- strengths & improvement points
- improved rewrite (assertive version)
- one coaching question to prompt a second attempt

Learner can iterate (“Try again”) and then continue the course flow.

---

## 3. Constraints & Assumptions
- The app is currently **100% static front-end** (index.html + app.js + scenario.js + styles.css).
- Model API keys must **not** be exposed in the browser.
- A **minimal backend proxy** is required to call the model securely.
- The AI must strictly follow the course definitions and frameworks.

---

## 4. Architecture Overview (MVP)

### Front-end
- Add one new state type: `aiCoach`
- Add one renderer function: `renderAiCoachState(state)`
- Add one HTTP call: `POST /api/evaluate`

### Backend (Proxy)
- One endpoint:
  - `POST /api/evaluate`
- Loads and injects a course knowledge base file:
  - `/kb/assertive_communication_kb.md`

### Model Provider
- Pluggable (Gemini or OpenAI).
- Contract is fixed:
  - Input: KB + scenario + learner answer
  - Output: strict JSON (no markdown, no prose outside schema)

---

## 5. Repository Additions

### New files / folders
- `/kb/assertive_communication_kb.md`
- `/specs/Spec_AICoach.md` (this file)
- Backend folder (choose one):
  - `/server/` (Node / Express)
  - `/api/` (serverless function, deployment-dependent)

### Modified files
- `scenario.js` — add new AI Coach state(s)
- `app.js` — add new render case + renderer + API call
- `styles.css` — minimal styles for textarea and feedback card

---

## 6. State Machine Changes

### New state type: `aiCoach`

**Required fields**
- `id` (string)
- `type`: `"aiCoach"`
- `situationText` (string — **required for evaluation**)
- `next` (string — next state ID)

**Optional fields**
- `title` (string)
- `prompt` (string)
- `video` (string — optional intro clip)
- `submitLabel` (string, default: "EVALUATE")
- `continueLabel` (string, default: "CONTINUE")
- `clearStage` (boolean)
- `allowRetry` (boolean, default: true)

### Placement in flow
- After first branching scenario completes:
  - `… → ai_coach_intro (video) → ai_coach_activity (aiCoach) → next_module`

---

## 7. UI / UX Requirements

### Layout
- Title + situation text (text version always present)
- Multi-line textarea for learner input
- Buttons:
  - Evaluate
  - Try Again
  - Continue
- Feedback panel displays:
  - Style classification + score
  - CLEAR breakdown
  - Strengths
  - Improvements
  - Suggested rewrite
  - Coaching question

### UX Rules
- Disable Evaluate until text is entered.
- Show "Evaluating…" state during API call.
- Do not auto-overwrite learner input.
- Graceful error handling (retry allowed).

---

## 8. API Contract

### Endpoint
`POST /api/evaluate`

### Request Body
```json
{
  "scenarioId": "ai_coach_activity_01",
  "situationText": "Anna describes the situation…",
  "userAnswer": "John’s response…"
}
```

### Response Body (STRICT JSON)
```json
{
  "style": "passive|aggressive|assertive|mixed",
  "score_total": 0,
  "clear_scores": {
    "connect": 0,
    "listen": 0,
    "express": 0,
    "align": 0,
    "review": 0
  },
  "evidence": [
    "Short quotes or paraphrases explaining the classification"
  ],
  "strengths": [
    "2–4 bullets"
  ],
  "risks": [
    "2–4 bullets"
  ],
  "rewrite": {
    "best_practice_version": "1–3 sentence assertive rewrite",
    "why_this_is_better": [
      "1–3 bullets referencing CLEAR or course rules"
    ]
  },
  "one_coaching_question": "Prompt for a second attempt"
}
```

### Error Responses
- `400` — missing required fields
- `500` — evaluation failure

---

## 9. Knowledge Base Requirements

File: `/kb/assertive_communication_kb.md`

Must include:
- Definition of assertive communication (course definition)
- Passive vs Aggressive vs Assertive comparison
- CLEAR framework definitions and examples
- Guidance on using "I" statements
- Common anti-patterns (blaming, avoidance, hostility)
- 2–3 good assertive examples

Style:
- Concise
- Bullet-heavy
- No external theory beyond the course

---

## 10. Evaluator Behavior Rules

- Act as a coach and evaluator, not a therapist or judge.
- Ground all feedback in the knowledge base.
- Do not invent new frameworks or terminology.
- Always return valid JSON matching the schema.

### Scoring Guidance
- Overall score: 0–100
- CLEAR sub-scores: 0–2 each

### Rewrite Constraints
- 1–3 sentences
- Respectful, direct, collaborative
- Includes a clear request or next step

---

## 11. Safety & Content Handling

- If learner input is hostile or inappropriate:
  - Flag in `risks`
  - Provide a respectful alternative rewrite
- No medical, legal, or HR advice

---

## 12. Acceptance Criteria (Definition of Done)

- `aiCoach` state renders correctly
- Learner receives structured feedback
- Retry and Continue flows work
- Backend proxy hides API key
- Feedback consistently references CLEAR and course rules

---

## 13. Future Enhancements (Out of Scope)

- Voice input/output
- Scenario randomization
- Progress tracking
- Advanced RAG
- Multi-language support

