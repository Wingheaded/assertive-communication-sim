# Branching Video Simulation — Vibe Coding Build Spec (Strategy A)

> **Purpose:** This document is a complete build specification for a **video-first branching simulation** (assertive communication) where the learner role-plays as **John** and must **explore all three response styles** (Passive, Aggressive, Assertive).
>
> **You (the coding tool)** must implement exactly what is described here. Do not invent new learning logic, scoring, or extra screens.

---

## 1) Product goal
Build a lightweight web app that plays pre-recorded video clips in a branching, state-driven flow.

- The learner **role-plays as John**.
- Anna introduces the issue in video.
- The learner chooses **one** response style at a decision hub:
  - Passive
  - Aggressive
  - Assertive
- For each chosen style, the app plays a fixed sequence of videos + one reflection overlay.
- After finishing a style branch, the learner returns to the decision hub.
- Completed styles are disabled and labeled **“Already explored”**.
- The learner must complete **all three** styles.
- When all three are explored, the simulation **ends cleanly** (for now). No follow-up exercise in this version.

---

## 2) Non-goals (do NOT implement)
- No scoring, points, badges, or “correct/incorrect” logic.
- No quiz questions.
- No AI-generated dialogue.
- No database.
- No login.
- No SCORM/xAPI in this version.
- No post-simulation exercise (we will add later).

---

## 3) Target runtime environments
The app must run:
- As a standalone web page (local or hosted)
- In modern desktop browsers (Chrome/Edge/Firefox/Safari)
- Responsively on mobile

**Optional compatibility:** should be embeddable inside an iframe (e.g., Storyline Web Object). Avoid features blocked by iframes.

---

## 4) UX principles
- Video is the primary content.
- UI is minimal, clean, and distraction-free.
- Reflection is a brief deliberate pause:
  - A text overlay appears after Anna’s reaction video.
  - Overlay has **one** button: **Continue**.

---

## 5) High-level flow
1. Intro video(s) (optional, configurable).
2. Decision hub with three choices (Passive/Aggressive/Assertive).
3. Learner selects one style.
4. App plays:
   - John response video (style-specific)
   - Anna reaction video (style-specific)
   - Reflection overlay (style-specific text)
   - Feedback video (style-specific)
5. Return to decision hub.
6. Previously completed style is disabled + labeled “Already explored”.
7. Repeat until all three styles completed.
8. End screen: “Simulation complete” + optional “Restart” (see requirements).

---

## 6) Required UI screens/components
### 6.1 Video Player Screen
- A single `<video>` element used for all playback.
- Must show a loading indicator while video is loading/buffering.
- Must support autoplay between states **when allowed** (see autoplay rules).
- Must handle missing video files gracefully (show an error overlay).

### 6.2 Decision Hub Screen
- Shows prompt: “Anna shares a concern. How does John respond?”
- Three buttons:
  - Passive
  - Aggressive
  - Assertive
- After a style is completed:
  - its button becomes disabled
  - it displays a small label/badge **“Already explored”**

### 6.3 Reflection Overlay
- Appears after Anna reaction video ends.
- Shows:
  - Title: “Let’s pause for a moment.”
  - Reflection text (provided per style)
  - One button: “Continue”
- Clicking Continue moves into the feedback video.

### 6.4 End Screen
After all three styles explored:
- Show: “Simulation complete.”
- Provide a “Restart” button that clears exploration progress and returns to hub.

---

## 7) Core rules
### 7.1 State machine (Strategy A)
Implement the experience as a **finite state machine**.
- Each state is either:
  - `hub` (choice state)
  - `video` (plays a video, then auto-advances)
  - `overlay` (shows reflection overlay, waits for Continue)
  - `end` (completion screen)

The app must move state-by-state exactly as defined in the **Scenario Map** section.

### 7.2 Exploration locking
- Maintain an in-memory set (and also persist in localStorage) called `exploredStyles`.
- Styles are: `passive`, `aggressive`, `assertive`.
- When the user completes a style branch (after its feedback video finishes), add that style to `exploredStyles`.
- At the hub:
  - Disable a style button if it is in `exploredStyles`.
  - Display label “Already explored”.
- When all three are explored, transition to `end`.

### 7.3 Autoplay rules
- Videos should autoplay when transitioning between video states.
- If the browser blocks autoplay:
  - Show a “Tap to play” overlay.
  - Once the user starts one video, autoplay should work for subsequent videos in most browsers.

### 7.4 Video controls
- Keep controls minimal.
- Recommended: hide native controls by default and provide custom minimal controls if needed.
- At minimum, provide:
  - Play/Pause
  - Restart current clip
- Optional: captions toggle (only if easy).

### 7.5 Accessibility & input
- Buttons must be keyboard accessible (Tab focus, Enter/Space activation).
- Reflection overlay must trap focus while open.

---

## 8) File/folder structure
Create a project with this structure:

```
project/
  index.html
  styles.css
  app.js
  scenario.js
  assets/
    videos/
      placeholders/
        intro.mp4
        anna_issue.mp4
        john_passive.mp4
        anna_passive_reaction.mp4
        feedback_passive.mp4
        john_aggressive.mp4
        anna_aggressive_reaction.mp4
        feedback_aggressive.mp4
        john_assertive.mp4
        anna_assertive_reaction.mp4
        feedback_assertive.mp4
```

### Notes
- The `assets/videos/placeholders/` videos can be dummy placeholders.
- The app must work even if the videos are placeholders.
- You must centralize all asset paths in `scenario.js`.

---

## 9) Scenario Map (exact states)
### 9.1 Style identifiers
- `passive`
- `aggressive`
- `assertive`

### 9.2 State list
Define the following states exactly (IDs must match):

1) `intro` (video, optional)
- video: `assets/videos/placeholders/intro.mp4`
- next: `anna_issue`

2) `anna_issue` (video)
- video: `assets/videos/placeholders/anna_issue.mp4`
- next: `hub`

3) `hub` (choice)
- prompt: “Anna shares a concern. How does John respond?”
- choices:
  - Passive → `passive_john_response`
  - Aggressive → `aggressive_john_response`
  - Assertive → `assertive_john_response`

#### Passive branch
4) `passive_john_response` (video)
- video: `assets/videos/placeholders/john_passive.mp4`
- next: `passive_anna_reaction`

5) `passive_anna_reaction` (video)
- video: `assets/videos/placeholders/anna_passive_reaction.mp4`
- next: `passive_reflection`

6) `passive_reflection` (overlay)
- title: “Let’s pause for a moment.”
- text:
  - “Now, let’s pause for a moment to reflect on how that exchange unfolded. What does this tell us about John’s communication style?”
- button: “Continue”
- next: `passive_feedback`

7) `passive_feedback` (video)
- video: `assets/videos/placeholders/feedback_passive.mp4`
- onComplete:
  - mark explored: `passive`
- next:
  - if all explored → `end`
  - else → `hub`

#### Aggressive branch
8) `aggressive_john_response` (video)
- video: `assets/videos/placeholders/john_aggressive.mp4`
- next: `aggressive_anna_reaction`

9) `aggressive_anna_reaction` (video)
- video: `assets/videos/placeholders/anna_aggressive_reaction.mp4`
- next: `aggressive_reflection`

10) `aggressive_reflection` (overlay)
- title: “Let’s pause for a moment.”
- text:
  - “Now, let’s pause for a moment to reflect on how that exchange unfolded. What does this tell us about John’s communication style?”
- button: “Continue”
- next: `aggressive_feedback`

11) `aggressive_feedback` (video)
- video: `assets/videos/placeholders/feedback_aggressive.mp4`
- onComplete:
  - mark explored: `aggressive`
- next:
  - if all explored → `end`
  - else → `hub`

#### Assertive branch
12) `assertive_john_response` (video)
- video: `assets/videos/placeholders/john_assertive.mp4`
- next: `assertive_anna_reaction`

13) `assertive_anna_reaction` (video)
- video: `assets/videos/placeholders/anna_assertive_reaction.mp4`
- next: `assertive_reflection`

14) `assertive_reflection` (overlay)
- title: “Let’s pause for a moment.”
- text:
  - “Now, let’s pause for a moment to reflect on how that exchange unfolded. What does this tell us about John’s communication style?”
- button: “Continue”
- next: `assertive_feedback`

15) `assertive_feedback` (video)
- video: `assets/videos/placeholders/feedback_assertive.mp4`
- onComplete:
  - mark explored: `assertive`
- next:
  - if all explored → `end`
  - else → `hub`

16) `end` (screen)
- show: “Simulation complete.”
- button: “Restart”
- restart behavior:
  - clears `exploredStyles` (memory + localStorage)
  - transitions to `hub`

---

## 10) Orientation copy (start-of-experience)
Before the first hub appears, show a short orientation line (either overlay text or small caption area):

> “You’ll explore different ways John can respond — one at a time.”

This must be **one line**. No long instructions.

---

## 11) Error handling requirements
### 11.1 Missing video
If a video fails to load/play:
- Show an overlay:
  - “Missing or failed video: <filename>”
- Provide buttons:
  - “Retry” (attempt reload)
  - “Back to hub” (go to `hub` without marking explored)

### 11.2 Invalid state
If the state machine is asked to load an unknown state:
- Show a fatal error screen with the missing state id.
- Provide “Restart”.

---

## 12) Persistence
Use `localStorage` to persist:
- exploredStyles (array or object)

On load:
- if exploredStyles exists, restore it
- start at `intro` by default
- (optional) allow a query param `?start=hub` to skip intro during testing

---

## 13) Styling requirements
- Clean, modern, neutral.
- Ensure the video area is centered, responsive, and keeps aspect ratio.
- Overlays should be semi-transparent with readable text.
- Hub buttons should be large, tappable.
- “Already explored” label should be subtle but clear.

---

## 14) Acceptance criteria (definition of done)
The build is correct only if all criteria below are met:

- [ ] App launches and plays `intro` then `anna_issue` then shows hub.
- [ ] Hub presents 3 choices and respects disabled/explored states.
- [ ] Selecting a style plays response → reaction → reflection overlay → feedback.
- [ ] Reflection overlay has only one button: Continue.
- [ ] After feedback completes, the user returns to hub and the chosen style shows “Already explored” and is disabled.
- [ ] After exploring all 3 styles, the app shows the end screen.
- [ ] Restart clears progress and returns to hub with all choices enabled.
- [ ] Missing video errors are handled gracefully.
- [ ] Works on desktop and mobile.

---

## 15) Implementation notes (developer guidance)
- Keep all scenario definitions in `scenario.js`.
- Keep state machine and UI rendering in `app.js`.
- Avoid frameworks unless necessary; prefer vanilla JS.
- Keep code readable and modular.

---

## 16) Future extension hooks (do not implement now)
- Add post-simulation exercise.
- Add analytics.
- Add SCORM/xAPI.
- Add subtitles and language switching.

(These are explicitly out of scope for this version.)

