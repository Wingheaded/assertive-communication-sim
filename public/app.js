import { SCENARIO } from './scenario.js';
import { SCENARIO_CONFIG, getScenarioConfig, getNextScenarioId, getActivityIdForScenario } from './scenario-config.js';

// =============================================================================
// PRACTICE MODE FLAG
// Set to true to bypass evaluation gating and enable Continue in all scenarios.
// Set to false for production behaviour (thresholds enforced).
// =============================================================================
const PRACTICE_MODE = false; // <-- Production mode: thresholds enforced

// =============================================================================
// TEST MODE FLAG
// Set to true to enable all Continue buttons for UI testing without API calls.
// Set to false for production behaviour.
// =============================================================================
const TEST_MODE = false; // <-- Flip to false for production

// --- Engine State ---
let currentStateId = null;
let previousStateId = null;

// --- Captions State ---
let captionsEnabled = true;

// --- Activity Progression State ---
// Tracks mastery-gated progress across all scenarios
let activityProgress = {
    currentScenarioId: 'S1',
    scenarios: {
        S1: { attempts: [], bestScore: 0, lastAttempt: null, scenarioPassed: false, failedAttempts: 0 },
        S2: { attempts: [], bestScore: 0, lastAttempt: null, scenarioPassed: false, failedAttempts: 0 },
        S3: { attempts: [], bestScore: 0, lastAttempt: null, scenarioPassed: false, failedAttempts: 0 }
    },
    activityStatus: 'IN_PROGRESS'
};

/**
 * Get current scenario's progress state
 */
function getCurrentScenarioProgress() {
    return activityProgress.scenarios[activityProgress.currentScenarioId];
}

/**
 * Check if suggested answer should be visible for current scenario
 */
function isSuggestedAnswerUnlocked(scenarioId) {
    const config = SCENARIO_CONFIG[scenarioId];
    const progress = activityProgress.scenarios[scenarioId];
    if (!config || !progress) return false;
    if (!config.suggested.enabled) return false;
    return progress.failedAttempts >= config.suggested.unlockAfterFailedAttempts;
}

/**
 * Record an evaluation attempt and update progression state
 */
function recordAttempt(scenarioId, overallScore, clearScores, responseText) {
    const config = SCENARIO_CONFIG[scenarioId];
    const progress = activityProgress.scenarios[scenarioId];
    if (!config || !progress) return;

    const attemptResult = {
        attemptIndex: progress.attempts.length + 1,
        responseText,
        overallScore,
        clearScores,
        timestamp: Date.now()
    };

    progress.attempts.push(attemptResult);
    progress.lastAttempt = attemptResult;
    progress.bestScore = Math.max(progress.bestScore, overallScore);

    // Sticky pass: once passed, stays passed
    if (overallScore >= config.threshold) {
        progress.scenarioPassed = true;
    }

    // Count failed attempts (for suggested answer unlock)
    if (overallScore < config.threshold) {
        progress.failedAttempts++;
    }
}

/**
 * Check if S3 Guided Reset help should be shown
 * Only shows after 2+ failed attempts in Scenario 3
 */
function shouldShowS3GuidedHelp() {
    const progress = activityProgress.scenarios.S3;
    return progress.failedAttempts >= 2 && !progress.scenarioPassed;
}

/**
 * S3 Guided Reset Help Content (Structural Check)
 */
const S3_GUIDED_HELP = {
    title: "Before you try again",
    intro: "This situation isn't about tone. It's about decisions under pressure.",
    listIntro: "Your response must include all three of these elements:",
    items: [
        "Incident ownership — clearly acknowledge the specific delay Daniel described.",
        "Dual-value recognition — explicitly recognise both customer responsiveness and the reason the process exists.",
        "Forward rule or trigger — propose a concrete rule, trigger, or decision path that would prevent this situation from happening again."
    ]
};

// --- AI Coach Navigation History ---
// Only these states participate in Back navigation (post-simulation)
const AI_COACH_STATES = ['clear_model_intro', 'activity', 'activity_sofia', 'activity_daniel'];
let aiCoachHistory = [];
let aiCoachUserInput = ''; // Preserved textarea input

function isAiCoachState(stateId) {
    return AI_COACH_STATES.includes(stateId);
}

function pushAiCoachHistory() {
    if (!isAiCoachState(currentStateId)) return;

    // Capture current textarea value if on activity screen
    const textarea = document.getElementById('ai-coach-input');
    if (textarea) {
        aiCoachUserInput = textarea.value;
    }

    aiCoachHistory.push({
        stateId: currentStateId,
        sessionData: { ...aiCoachSession },
        userInput: aiCoachUserInput
    });
    console.log(`[AI Coach History] Pushed: ${currentStateId}, stack size: ${aiCoachHistory.length}`);
}

function goBackAiCoach() {
    if (aiCoachHistory.length === 0) return;

    const prevEntry = aiCoachHistory.pop();
    console.log(`[AI Coach History] Popped: ${prevEntry.stateId}, stack size: ${aiCoachHistory.length}`);

    // Restore session state
    aiCoachSession = { ...prevEntry.sessionData };
    aiCoachUserInput = prevEntry.userInput;

    // Navigate without pushing to history
    previousStateId = currentStateId;
    currentStateId = prevEntry.stateId;
    renderCurrentState();
}

function canGoBackAiCoach() {
    return aiCoachHistory.length > 0;
}

// --- State Management ---
function getState(id) {
    const state = SCENARIO.states[id];
    if (!state) {
        console.error(`[Engine] State not found: ${id}`);
        return null;
    }
    return state;
}

function go(nextStateId) {
    const state = getState(nextStateId);
    if (!state) return;

    console.log(`[Engine] Transitioning to: ${nextStateId}`);

    // Push current AI Coach state to history before navigating
    if (isAiCoachState(currentStateId) && isAiCoachState(nextStateId)) {
        pushAiCoachHistory();
    }

    // Clear history if leaving AI Coach scope
    if (isAiCoachState(currentStateId) && !isAiCoachState(nextStateId)) {
        aiCoachHistory = [];
        aiCoachUserInput = '';
        console.log('[AI Coach History] Cleared (left AI Coach scope)');
    }

    previousStateId = currentStateId;
    currentStateId = nextStateId;
    renderCurrentState();
}

function renderCurrentState() {
    const state = getState(currentStateId);
    if (!state) return;

    console.log(`[Render] Processing state type: ${state.type}`);

    switch (state.type) {
        case 'video':
            renderVideoState(state);
            break;
        case 'choice':
            renderChoiceState(state);
            break;
        case 'overlay':
        case 'reflection':
            renderReflectionState(state);
            break;
        case 'end':
            renderEndState(state);
            break;
        case 'aiCoach':
            renderAiCoachState(state);
            break;
        case 'completion':
            renderCompletionScreen(state);
            break;
        case 'content':
            renderContentScreen(state);
            break;
        case 'wrapup':
            renderWrapupScreen(state);
            break;
        default:
            console.error(`[Render] Unknown state type: ${state.type}`);
    }
}

// --- LocalStorage Helpers ---
const STORAGE_KEY = 'branchingVideoSim.exploredStyles';

function getExploredStyles() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];
        return JSON.parse(stored);
    } catch (e) {
        console.error('Error reading localStorage', e);
        return [];
    }
}

function setExploredStyles(arr) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
        console.error('Error writing localStorage', e);
    }
}

function markStyleExplored(styleId) {
    const explored = getExploredStyles();
    if (!explored.includes(styleId)) {
        explored.push(styleId);
        setExploredStyles(explored);
        console.log(`[Progress] Marked explored: ${styleId}`);
    }
}

function isStyleExplored(styleId) {
    const explored = getExploredStyles();
    return explored.includes(styleId);
}

// --- DOM Helpers ---
function ensureStage() {
    const app = document.getElementById('app');
    let stage = document.getElementById('stage');
    if (!stage) {
        app.innerHTML = '';
        stage = document.createElement('div');
        stage.id = 'stage';
        stage.className = 'stage';
        app.appendChild(stage);
    }
    return stage;
}

function clearApp() {
    const app = document.getElementById('app');
    if (app) app.innerHTML = '';
    return app;
}

// --- Renderers ---
function renderVideoState(state) {
    console.log(`[Render] Video State: ${state.id} -> ${state.video}`);

    // Ensure we have the stage container
    const stage = ensureStage();

    // Remove any existing overlays from previous states (like hub)
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.remove();

    // Check for existing video element to reuse
    let video = stage.querySelector('video');
    if (!video) {
        video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'auto'; // corrected to string 'auto'
        stage.appendChild(video);
    }

    // Update video source
    video.src = state.video;

    // Clean up old listeners by replacing the element
    const newVideo = video.cloneNode(true);
    video.parentNode.replaceChild(newVideo, video);
    video = newVideo;

    video.controls = true;

    // --- Captions Track ---
    // Derive .vtt path (lowercase to match file naming)
    const videoDir = state.video.substring(0, state.video.lastIndexOf('/') + 1);
    const videoFileName = state.video.substring(state.video.lastIndexOf('/') + 1);
    const vttFileName = videoFileName.replace(/\.[^.]+$/, '.vtt').toLowerCase();
    const vttPath = videoDir + vttFileName;

    // Remove old tracks from cloned video
    while (video.firstChild) {
        video.removeChild(video.firstChild);
    }

    // Add caption track
    const track = document.createElement('track');
    track.kind = 'captions';
    track.src = vttPath;
    track.srclang = 'en';
    track.label = 'Captions';
    if (captionsEnabled) {
        track.default = true;
    }
    video.appendChild(track);

    // Set caption mode when video metadata loads
    video.addEventListener('loadedmetadata', () => {
        if (video.textTracks && video.textTracks.length > 0) {
            video.textTracks[0].mode = captionsEnabled ? 'showing' : 'hidden';
        }
    });

    // --- CC Toggle ---
    const existingCC = stage.querySelector('.cc-toggle-btn');
    if (existingCC) existingCC.remove();

    const ccBtn = document.createElement('button');
    ccBtn.className = 'cc-toggle-btn' + (captionsEnabled ? ' cc-active' : '');
    ccBtn.textContent = 'CC';
    ccBtn.setAttribute('aria-pressed', String(captionsEnabled));
    ccBtn.title = 'Captions';

    ccBtn.addEventListener('click', () => {
        captionsEnabled = !captionsEnabled;
        ccBtn.classList.toggle('cc-active', captionsEnabled);
        ccBtn.setAttribute('aria-pressed', String(captionsEnabled));
        if (video.textTracks[0]) {
            video.textTracks[0].mode = captionsEnabled ? 'showing' : 'hidden';
        }
    });

    stage.appendChild(ccBtn);

    // --- DEV: Reset Button (remove before production) ---
    const existingReset = stage.querySelector('.dev-reset-btn');
    if (existingReset) existingReset.remove();

    const resetBtn = document.createElement('button');
    resetBtn.className = 'cc-toggle-btn dev-reset-btn';
    resetBtn.textContent = 'RESET';
    resetBtn.style.right = '80px';
    resetBtn.title = 'Reset all progress (dev only)';

    resetBtn.addEventListener('click', () => {
        localStorage.removeItem('branchingVideoSim.exploredStyles');
        window._openingOverlayDismissed = false;
        alert('Progress reset! Refreshing...');
        location.reload();
    });

    stage.appendChild(resetBtn);

    // --- Opening Overlay (first screen only) ---
    const isOpeningScreen = state.id === 'anna_issue' && !window._openingOverlayDismissed;

    if (isOpeningScreen) {
        // Pause video initially
        video.pause();

        // Create opening overlay
        const openingOverlay = document.createElement('div');
        openingOverlay.id = 'opening-overlay';
        openingOverlay.className = 'opening-overlay';

        const openingContent = document.createElement('div');
        openingContent.className = 'opening-content';

        const openingText = document.createElement('p');
        openingText.className = 'opening-text';
        openingText.textContent = "You're about to step into a real workplace conversation.";
        openingContent.appendChild(openingText);

        const startBtn = document.createElement('button');
        startBtn.className = 'secondary-button opening-start-btn';
        startBtn.textContent = 'Start';
        startBtn.addEventListener('click', () => {
            // Mark as dismissed
            window._openingOverlayDismissed = true;

            // Check for reduced motion preference
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            if (prefersReducedMotion) {
                // Instant hide
                openingOverlay.remove();
                video.play();
            } else {
                // Fade out
                openingOverlay.style.transition = 'opacity 400ms ease';
                openingOverlay.style.opacity = '0';
                setTimeout(() => {
                    openingOverlay.remove();
                    video.play();
                }, 400);
            }
        });
        openingContent.appendChild(startBtn);

        openingOverlay.appendChild(openingContent);
        stage.appendChild(openingOverlay);
    } else {
        // Normal autoplay for other video states
        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log('[Autoplay] Blocked or failed:', error);
                // Controls are already enabled, so user can press play manually
            });
        }
    }

    video.addEventListener('ended', () => {
        // Handle onComplete actions (e.g., mark explored)
        if (state.onComplete && state.onComplete.markExplored) {
            markStyleExplored(state.onComplete.markExplored);
        }

        if (state.next) {
            go(state.next);
        }
    });
}

function renderChoiceState(state) {
    console.log(`[Render] Choice State: ${state.id} with ${state.choices.length} choices`);

    const stage = ensureStage();

    // Helper: Renders the actual choices
    const showChoices = () => {
        // 1. Overlay Backdrop
        const overlay = document.createElement('div');
        overlay.id = 'overlay';
        overlay.className = 'overlay-backdrop';

        // 2. Cinematic Card
        const card = document.createElement('div');
        card.className = 'cinematic-card';

        // 3. Content Panel (Text Box)
        const contentPanel = document.createElement('div');
        contentPanel.className = 'content-panel';

        const prompt = document.createElement('h2');
        prompt.style.whiteSpace = 'pre-line'; // Respect newlines
        prompt.textContent = state.prompt;
        contentPanel.appendChild(prompt);

        card.appendChild(contentPanel);

        // 4. Button Container
        const btnContainer = document.createElement('div');
        btnContainer.className = 'ui-button-container';

        state.choices.forEach(choice => {
            const btn = document.createElement('button');
            btn.textContent = choice.label;
            btn.className = 'primary-button';
            // Override standard button width for choices to look nice stacked
            btn.style.width = '100%';
            btn.style.textTransform = 'none'; // Keep normal case for long choice text
            btn.style.textAlign = 'left';
            btn.style.padding = '16px 24px';
            btn.style.lineHeight = '1.4';

            if (choice.styleId && isStyleExplored(choice.styleId)) {
                btn.disabled = true;
                btn.textContent += ' (Already explored)';
            } else {
                btn.addEventListener('click', () => {
                    console.log(`[Hub] Selected: ${choice.label}`);
                    overlay.remove();
                    go(choice.target);
                });
            }

            btnContainer.appendChild(btn);
        });

        card.appendChild(btnContainer);
        overlay.appendChild(card);
        stage.appendChild(overlay);
    };

    // Logic: Show Context Overlay first if present
    if (state.contextOverlay && previousStateId === 'anna_issue') {
        // 1. Overlay Backdrop
        const overlay = document.createElement('div');
        overlay.id = 'context-overlay';
        overlay.className = 'overlay-backdrop';

        // 2. Cinematic Card
        const card = document.createElement('div');
        card.className = 'cinematic-card';

        // 3. Content Panel
        const contentPanel = document.createElement('div');
        contentPanel.className = 'content-panel';

        const p = document.createElement('p');
        p.style.whiteSpace = 'pre-line';
        p.innerText = state.contextOverlay.text;
        contentPanel.appendChild(p);

        card.appendChild(contentPanel);

        // 4. Button
        const btnContainer = document.createElement('div');
        btnContainer.className = 'ui-button-container';

        const btn = document.createElement('button');
        btn.textContent = state.contextOverlay.buttonLabel || 'Answer';
        btn.className = 'primary-button';

        btn.addEventListener('click', () => {
            overlay.remove();
            showChoices();
        });

        btnContainer.appendChild(btn);
        card.appendChild(btnContainer);
        overlay.appendChild(card);
        stage.appendChild(overlay);

    } else {
        // If no context overlay, show choices immediately
        showChoices();
    }
}

// --- Final End State Renderer ---
function renderEndState(state) {
    console.log(`[Render] End State: ${state.id}`);

    const stage = ensureStage();
    stage.innerHTML = '';

    // Overlay backdrop
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay-backdrop end-screen-overlay';

    // Container
    const container = document.createElement('div');
    container.className = 'end-screen-container';

    // Primary message (larger text)
    if (state.primaryMessage) {
        const primary = document.createElement('p');
        primary.className = 'end-primary-message';
        primary.textContent = state.primaryMessage;
        container.appendChild(primary);
    }

    // Body text
    if (state.bodyText) {
        const body = document.createElement('p');
        body.className = 'end-body-text';
        body.innerHTML = state.bodyText.replace(/\n\n/g, '</p><p>');
        container.appendChild(body);
    }

    // Closing line
    if (state.closingLine) {
        const closing = document.createElement('p');
        closing.className = 'end-closing-line';
        closing.textContent = state.closingLine;
        container.appendChild(closing);
    }

    // Signature
    if (state.signature) {
        const sig = document.createElement('p');
        sig.className = 'end-signature';
        sig.innerHTML = state.signature;
        if (state.domain) {
            sig.innerHTML += `<br><a href="https://${state.domain}" target="_blank" class="end-domain">${state.domain}</a>`;
        }
        container.appendChild(sig);
    }

    overlay.appendChild(container);
    stage.appendChild(overlay);
}

function renderReflectionState(state) {
    console.log(`[Render] Reflection State: ${state.id}`);

    const stage = ensureStage();

    // Logic: Clear video/content if requested (e.g., for Activity placeholder)
    if (state.clearStage) {
        stage.innerHTML = '';
    }

    // 1. Overlay Backdrop
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay-backdrop';

    // 2. Cinematic Card
    const card = document.createElement('div');
    card.className = 'cinematic-card';

    // 3. Content Panel (Text Box)
    const contentPanel = document.createElement('div');
    contentPanel.className = 'content-panel';

    // Handle prompt/text
    let textContent = state.prompt || state.text;
    let nextTarget = state.next;

    // --- Dynamic End Branch Logic ---
    if (state.dynamicEndBranch) {
        const explored = getExploredStyles();
        const exploredCount = explored.length;
        const remainingCount = 3 - exploredCount;

        console.log(`[DynamicEnd] Explored: ${exploredCount}, Remaining: ${remainingCount}`);

        // Rule A - Dynamic Message
        if (exploredCount === 1) {
            textContent = "You’ve just seen how one response shapes the conversation.\nNow explore the other responses and notice what changes.";
        } else if (exploredCount === 2) {
            textContent = "You’ve explored two responses.\nNow explore the last one and notice what changes.";
        } else if (exploredCount >= 3) {
            textContent = "You’ve explored all three responses.\nContinue to the next activity.";
        }

        // Rule B - Dynamic Next Target
        if (remainingCount > 0) {
            nextTarget = 'hub';
        } else {
            nextTarget = 'clear_model_intro';
        }
    }

    const p = document.createElement('p');
    p.innerHTML = textContent; // Use innerHTML to support inline tags
    contentPanel.appendChild(p);

    card.appendChild(contentPanel);

    // 4. Button Container
    const btnContainer = document.createElement('div');
    btnContainer.className = 'ui-button-container';

    // Add Back button for AI Coach states
    if (isAiCoachState(state.id)) {
        const backBtn = document.createElement('button');
        backBtn.textContent = 'BACK';
        backBtn.className = 'secondary-button ai-coach-back-btn';
        backBtn.disabled = !canGoBackAiCoach();
        backBtn.addEventListener('click', () => {
            console.log('[Reflection] Back clicked');
            overlay.remove();
            goBackAiCoach();
        });
        btnContainer.appendChild(backBtn);
    }

    const btn = document.createElement('button');
    btn.textContent = state.button || 'CONTINUE'; // Use state.button if available, else default
    btn.className = 'primary-button';

    btn.addEventListener('click', () => {
        console.log(`[Reflection] Continue clicked`);
        overlay.remove();
        if (nextTarget) {
            go(nextTarget);
        } else {
            console.error('[Reflection] No next state defined');
        }
    });

    btnContainer.appendChild(btn);
    card.appendChild(btnContainer);
    overlay.appendChild(card);
    stage.appendChild(overlay);
}

// --- Scenario 3 Completion Screen Renderer ---
function renderCompletionScreen(state) {
    console.log(`[Render] Completion Screen: ${state.id}`);

    const stage = ensureStage();
    stage.innerHTML = '';

    // Overlay backdrop
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay-backdrop';

    // Card container (same style as coaching report)
    const card = document.createElement('div');
    card.className = 'completion-card ai-coach-container';

    // Title
    const title = document.createElement('h2');
    title.className = 'completion-title';
    title.textContent = state.title || 'Complete';
    card.appendChild(title);

    // Body text
    if (state.body) {
        const body = document.createElement('p');
        body.className = 'completion-body';
        body.innerHTML = state.body.replace(/\n/g, '<br>');
        card.appendChild(body);
    }

    // Micro-prompt (optional, muted)
    if (state.microPrompt) {
        const micro = document.createElement('p');
        micro.className = 'completion-micro-prompt';
        micro.textContent = state.microPrompt;
        card.appendChild(micro);
    }

    // Buttons
    const btnContainer = document.createElement('div');
    btnContainer.className = 'completion-buttons';

    // Secondary button (Review Coaching Report)
    if (state.secondaryButton && state.previous) {
        const secondaryBtn = document.createElement('button');
        secondaryBtn.textContent = state.secondaryButton;
        secondaryBtn.className = 'secondary-button';
        secondaryBtn.addEventListener('click', () => {
            console.log('[Completion] Review clicked - returning to S3 results');
            go(state.previous);
        });
        btnContainer.appendChild(secondaryBtn);
    }

    // Primary button (Continue)
    const primaryBtn = document.createElement('button');
    primaryBtn.textContent = state.primaryButton || 'CONTINUE';
    primaryBtn.className = 'primary-button';
    primaryBtn.addEventListener('click', () => {
        console.log('[Completion] Continue clicked');
        if (state.next) {
            go(state.next);
        }
    });
    btnContainer.appendChild(primaryBtn);

    card.appendChild(btnContainer);
    overlay.appendChild(card);
    stage.appendChild(overlay);
}

// --- Content Screen Renderer (wrap-up, etc.) ---
function renderContentScreen(state) {
    console.log(`[Render] Content Screen: ${state.id}`);

    const stage = ensureStage();
    stage.innerHTML = '';

    // Overlay backdrop
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay-backdrop';

    // Card container
    const card = document.createElement('div');
    card.className = 'content-card ai-coach-container';

    // Title
    if (state.title) {
        const title = document.createElement('h2');
        title.className = 'content-title';
        title.textContent = state.title;
        card.appendChild(title);
    }

    // Text content
    if (state.text) {
        const text = document.createElement('p');
        text.className = 'content-text';
        text.innerHTML = state.text.replace(/\n/g, '<br>');
        card.appendChild(text);
    }

    // Button
    const btnContainer = document.createElement('div');
    btnContainer.className = 'content-buttons';

    const btn = document.createElement('button');
    btn.textContent = state.button || 'CONTINUE';
    btn.className = 'primary-button';
    btn.addEventListener('click', () => {
        console.log('[Content] Continue clicked');
        if (state.next) {
            go(state.next);
        }
    });
    btnContainer.appendChild(btn);

    card.appendChild(btnContainer);
    overlay.appendChild(card);
    stage.appendChild(overlay);
}

// --- CLEAR Wrap-Up Screen Renderer ---
function renderWrapupScreen(state) {
    console.log(`[Render] Wrapup Screen: ${state.id}`);

    const stage = ensureStage();
    stage.innerHTML = '';

    // Overlay backdrop
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay-backdrop wrapup-overlay';

    // Main container
    const container = document.createElement('div');
    container.className = 'wrapup-container ai-coach-container';

    // Header
    const header = document.createElement('div');
    header.className = 'wrapup-header';

    const title = document.createElement('h2');
    title.className = 'wrapup-title';
    title.textContent = state.title || 'The CLEAR Model';
    header.appendChild(title);

    if (state.subheading) {
        const sub = document.createElement('p');
        sub.className = 'wrapup-subheading';
        sub.textContent = state.subheading;
        header.appendChild(sub);
    }
    container.appendChild(header);

    // CLEAR Infographic - Use image if available, otherwise fall back to HTML blocks
    if (state.infographicImage) {
        const infographic = document.createElement('div');
        infographic.className = 'clear-infographic-image-container';

        const img = document.createElement('img');
        img.src = state.infographicImage;
        img.alt = 'CLEAR Model Infographic';
        img.className = 'clear-infographic-image';

        // Click to zoom functionality
        img.addEventListener('click', () => {
            if (img.classList.contains('zoomed')) {
                // Zoom out
                img.classList.remove('zoomed');
                const backdrop = document.querySelector('.zoom-backdrop');
                if (backdrop) backdrop.remove();
            } else {
                // Zoom in
                const backdrop = document.createElement('div');
                backdrop.className = 'zoom-backdrop';
                backdrop.addEventListener('click', () => {
                    img.classList.remove('zoomed');
                    backdrop.remove();
                });
                document.body.appendChild(backdrop);
                img.classList.add('zoomed');
            }
        });

        infographic.appendChild(img);
        container.appendChild(infographic);
    } else if (state.clearModel) {
        const infographic = document.createElement('div');
        infographic.className = 'clear-infographic';

        ['C', 'L', 'E', 'A', 'R'].forEach(key => {
            const item = state.clearModel[key];
            if (!item) return;

            const block = document.createElement('div');
            block.className = 'clear-infographic-item';

            block.innerHTML = `
                <span class="clear-letter">${item.letter}</span>
                <span class="clear-name">${item.name}</span>
                <span class="clear-desc">${item.description}</span>
            `;
            infographic.appendChild(block);
        });

        container.appendChild(infographic);
    }

    // Audio Module
    if (state.audio) {
        const audioModule = document.createElement('div');
        audioModule.className = 'wrapup-audio-module';

        const audioTitle = document.createElement('h3');
        audioTitle.className = 'audio-module-title';
        audioTitle.textContent = state.audio.title || 'A final reflection';
        audioModule.appendChild(audioTitle);

        if (state.audio.subtitle) {
            const audioSub = document.createElement('p');
            audioSub.className = 'audio-module-subtitle';
            audioSub.textContent = state.audio.subtitle;
            audioModule.appendChild(audioSub);
        }

        // Audio controls
        const audioControls = document.createElement('div');
        audioControls.className = 'audio-controls';

        // Use video element for wave effect visualization
        const audio = document.createElement('video');
        audio.src = state.audio.src || '';
        audio.preload = 'metadata';
        audio.className = 'audio-wave-video';
        audioModule.appendChild(audio);

        const playBtn = document.createElement('button');
        playBtn.className = 'audio-btn audio-play-btn';
        playBtn.textContent = '▶ Play';
        playBtn.addEventListener('click', () => {
            if (audio.paused) {
                audio.play();
                playBtn.textContent = '⏸ Pause';
            } else {
                audio.pause();
                playBtn.textContent = '▶ Play';
            }
        });

        const replayBtn = document.createElement('button');
        replayBtn.className = 'audio-btn audio-replay-btn';
        replayBtn.textContent = '↻ Replay';
        replayBtn.addEventListener('click', () => {
            audio.currentTime = 0;
            audio.play();
            playBtn.textContent = '⏸ Pause';
        });

        audio.addEventListener('ended', () => {
            playBtn.textContent = '▶ Play';
        });

        audioControls.appendChild(playBtn);
        audioControls.appendChild(replayBtn);
        audioModule.appendChild(audioControls);

        // Transcript toggle
        const transcriptToggle = document.createElement('button');
        transcriptToggle.className = 'transcript-toggle-btn';
        transcriptToggle.textContent = 'Show transcript';

        const transcriptPanel = document.createElement('div');
        transcriptPanel.className = 'transcript-panel';
        transcriptPanel.style.display = 'none';
        transcriptPanel.innerHTML = `
<p>We're doing a deep dive today into a skill that I think sits at the heart of both professional success and, honestly, personal peace. It's assertive communication. I mean, how many times have you been in that situation where you need to set a boundary and it just, it either blows up into a fight or you just say nothing and walk away feeling resentful? It's such a common failure point.</p>

<p>Yeah. And people get it wrong because they think being assertive means being aggressive, but it's not. Right. It's that respectful middle ground. It's about being honest about your own rights and feelings, but, and this is the key, while respecting theirs. And it's a learned skill, right? Nobody's born with this.</p>

<p>Absolutely not. It has to be learned. And we found a great framework for that, a five-part model called CLEAR.</p>

<p>Okay, let's unpack that. CLEAR, starting with C, which is connect. And the source material is really specific here. You have to build some empathy or validation before you even bring up the problem. Which is the total opposite of what we normally do. We just jump right in with the complaint.</p>

<p>But if you start with something like, I know you've been slammed with deadlines this week, you're engaging what they call the helper empathy motivation. Ah, so you're not an adversary. You're framing it as a joint problem to solve. You're asking for their help instead of putting them on the defensive right away. That's a huge mindset shift.</p>

<p>Okay. So from there, we get to L, listen. Active listening. And this is so, so critical now that so many of us are working remotely. Because you lose the body language cues. You lose almost everything. So you have to be deliberate. I mean, actually close your other tabs. Look at the camera, not just the screen. And give those little verbal confirmations. Things like, I understand, or that makes sense. You have to bridge that digital gap and show them you're really with them.</p>

<p>We've connected. We've listened. Now we're at Express. This feels like the hard part. It's where the rubber meets the road for sure. And the golden rule here is to use specific I statements. It's all about owning your experience. So instead of you always turn this in late, you say, I feel frustrated when the report is late because it holds up my work. It's not an accusation. It's a statement about the impact on you. No use statements, no generalizations.</p>

<p>And what about the nonverbal side? When your voice is shaky, even if your words are good. Well, the old saying is true. If your mouth says one thing, but your body says another, people believe your body. Every time. So firm eye contact, not a death stare, just steady, straight posture, a calm, even tone. It has to be congruent.</p>

<p>Okay. That brings us to A, align. This is about solutions. This is the forward looking part. You've stated the problem. Now you align on the next steps. It's about making a clear, specific, and doable request. And the best way to do that is to give them a choice. Enlist their help. Don't just dictate. Ask something like, how can we work together to make sure this deadline works for both of us? So they co-own the solution. That way, it's not your rule they have to follow. It's our agreement we have to uphold.</p>

<p>Which flows right into the last step, our review, the follow-up. And this is the one most people skip. Review is about consistency. A boundary is useless if you don't enforce it. So if it happens again, you address it again. Calmly, quickly, and by referring back to your agreement, hey, we agreed to try this new approach. Let's get back to that. It teaches people how you expect to be treated.</p>

<p>So the whole CLEAR framework, it's really a roadmap. It takes you out of that passive aggressive cycle and into a more balanced place. A place where you can respect yourself and others.</p>

<p>And, you know, I think it's worth leaving you with this one thought about boundaries. Setting them isn't really about having the courage to say no to things you don't want. It's about having the courage to say yes to yourself. Yes to having more energy. Yes to feeling less resentment. And ultimately, yes to protecting your own peace. That's the real payoff here.</p>
`;

        transcriptToggle.addEventListener('click', () => {
            const isVisible = transcriptPanel.style.display !== 'none';
            transcriptPanel.style.display = isVisible ? 'none' : 'block';
            transcriptToggle.textContent = isVisible ? 'Show transcript' : 'Hide transcript';
        });

        audioModule.appendChild(transcriptToggle);
        audioModule.appendChild(transcriptPanel);
        container.appendChild(audioModule);
    }

    // Downloads Section
    if (state.downloads) {
        const downloads = document.createElement('div');
        downloads.className = 'wrapup-downloads';

        const dlLabel = document.createElement('p');
        dlLabel.className = 'downloads-label';
        dlLabel.textContent = state.downloads.label || 'Take this with you';
        downloads.appendChild(dlLabel);

        const dlLinks = document.createElement('div');
        dlLinks.className = 'downloads-links';

        state.downloads.items.forEach(item => {
            const link = document.createElement('a');
            link.href = item.href;
            link.className = 'download-link';
            link.textContent = item.text;
            link.target = '_blank';
            link.download = '';
            dlLinks.appendChild(link);
        });

        downloads.appendChild(dlLinks);
        container.appendChild(downloads);
    }

    // Navigation
    const navContainer = document.createElement('div');
    navContainer.className = 'wrapup-nav';

    const finishBtn = document.createElement('button');
    finishBtn.className = 'primary-button';
    finishBtn.textContent = state.primaryButton || 'Finish demo';
    finishBtn.addEventListener('click', () => {
        console.log('[Wrapup] Finish clicked');
        if (state.next) {
            go(state.next);
        }
    });
    navContainer.appendChild(finishBtn);

    container.appendChild(navContainer);
    overlay.appendChild(container);
    stage.appendChild(overlay);
}

// --- AI Coach State Renderer ---
// Session state for AI Coach (to track evaluation status)
let aiCoachSession = {
    hasEvaluated: false,
    lastFeedback: null,
    isLoading: false,
    // Attempt history for progress tracking
    previousAttempt: null,     // { userAnswer, clearScores }
    currentAttempt: null,      // { userAnswer, clearScores }
    retryFocus: null,          // { dimensionKey, label, hint }
    showRetryHint: true        // Controls visibility of hint (dismissible)
};

// --- Retry Focus & Progress Helpers ---

/**
 * Compute the focus for the learner's next retry attempt.
 * NOW: Uses the generated Coaching Report to find the best cue.
 */
function computeRetryFocus(clearScores, coachingReport) {
    const priorityOrder = ['listen', 'express', 'align', 'connect', 'review'];
    const labels = { connect: 'Connect', listen: 'Listen', express: 'Express', align: 'Align', review: 'Review' };

    // Find lowest score
    let lowestScore = Infinity;
    let focusKey = null;

    for (const key of priorityOrder) {
        const score = clearScores?.[key] ?? 0;
        if (score < lowestScore) {
            lowestScore = score;
            focusKey = key;
        }
    }

    // Tie-breaking: priorityOrder logic
    // If multiple dimensions have the same lowest score, pick based on priorityOrder
    const minScore = Math.min(...Object.values(clearScores || {}));
    const brokenKey = priorityOrder.find(k => (clearScores?.[k] ?? 0) === minScore);
    focusKey = brokenKey || 'align';

    const dimensionReport = coachingReport ? coachingReport[focusKey] : null;

    return {
        dimensionKey: focusKey,
        label: labels[focusKey],
        hint: dimensionReport ? dimensionReport.cue : "Focus on improving this area.",
        isComprehensive: false
    };
}

/**
 * Compare previous vs current attempt CLEAR scores and return a progress message.
 */
function computeProgressLine(previousScores, currentScores) {
    if (!previousScores || !currentScores) return null;

    const dimensions = ['connect', 'listen', 'express', 'align', 'review'];
    const labels = { connect: 'Connect', listen: 'Listen', express: 'Express', align: 'Align', review: 'Review' };

    const improvements = [];

    for (const key of dimensions) {
        const prev = previousScores[key] ?? 0;
        const curr = currentScores[key] ?? 0;
        if (curr > prev) {
            improvements.push(`${labels[key]} improved`);
        }
    }

    if (improvements.length === 0) {
        return 'No score change yet — keep practicing.';
    }

    return 'Progress: ' + improvements.join(', ') + '.';
}

/**
 * Build a structured CLEAR Coaching Report from evaluation data.
 */
function buildClearCoachingReport(data) {
    // Map API snake_case to internal variables
    const clearScores = data.clear_scores || data.clearScores || {};
    const strengths = data.strengths || [];
    const keyImprovement = data.one_improvement || data.keyImprovement || '';
    const risks = data.risks || [];
    const pointsToConsider = data.pointsToConsider || [];

    // Combine risks and pointsToConsider
    const improvementPoints = [...(risks || []), ...(pointsToConsider || [])];

    const dimensions = ['connect', 'listen', 'express', 'align', 'review'];
    const labels = { connect: 'Connect', listen: 'Listen', express: 'Express', align: 'Align', review: 'Review' };

    // Keywords for mapping strengths/gaps to dimensions
    const keywords = {
        connect: ['tone', 'respect', 'blame', 'empathy', 'intent', 'collaborative', 'warm', 'opener', 'apolog', 'calm', 'dismissive', 'confrontational'],
        listen: ['understand', 'reflect', 'clarify', 'acknowledge', 'paraphrase', 'question', 'concerns', 'heard', 'listening'],
        express: ['state', 'needs', 'boundary', 'statement', 'clarity', 'ownership', 'perspective', 'i feel', 'i need', 'vague', 'honest'],
        align: ['next step', 'plan', 'timeline', 'agree', 'propose', 'action', 'specifics', 'solution', 'move forward', 'fix', 'commitment'],
        review: ['follow-up', 'check-in', 'revisit', 'confirm', 'recap', 'summary', 'ensure']
    };

    const report = {};

    dimensions.forEach(dim => {
        const score = clearScores[dim] ?? 0;
        let statusMsg = '';
        let contextMsg = '';
        let cueMsg = '';

        // 1. Status Sentence
        if (score === 2) statusMsg = 'Strong.';
        else if (score === 1) statusMsg = 'Partial.';
        else statusMsg = 'Not demonstrated yet.';

        // 2. Context Sentence (Map strengths/points)
        const allBullets = [];
        if (score >= 1) allBullets.push(...strengths);
        if (score <= 1) allBullets.push(...improvementPoints);

        // Find relevant bullets
        const relevantBullets = allBullets.filter(txt =>
            keywords[dim].some(k => txt.toLowerCase().includes(k))
        );

        if (relevantBullets.length > 0) {
            // Use the first relevant bullet, max 140 chars
            contextMsg = relevantBullets[0];
            contextMsg = contextMsg.replace(/\.$/, '');
        } else {
            // Fallback context if no bullets match
            if (score === 2) contextMsg = `Effective use of ${labels[dim]} here`;
            else if (score === 1) contextMsg = `${labels[dim]} was attempted but missed nuance`;
            else contextMsg = `${labels[dim]} was missing`;
        }

        // 3. Cue Sentence (Next attempt)
        const keyImpLower = keyImprovement.toLowerCase();
        let useKeyImprovement = false;

        if (keyImpLower.includes(`(${dim})`) || keyImpLower.startsWith(`${dim}:`)) {
            useKeyImprovement = true;
        } else if (score < 2 && keywords[dim].some(k => keyImpLower.includes(k))) {
            useKeyImprovement = true;
        }

        if (useKeyImprovement) {
            cueMsg = keyImprovement.replace(new RegExp(`^\\(${dim}\\)\\s*`, 'i'), '');
        } else {
            // Generic cues
            const genericCues = {
                connect: "Start with a neutral, supportive opening.",
                listen: "Reflect back what you heard first.",
                express: "Use a clear 'I' statement.",
                align: "Propose a concrete solution.",
                review: "Summarize next steps."
            };

            if (score === 2) cueMsg = "";
            else cueMsg = `Try: ${genericCues[dim]}`;
        }

        // Assemble text
        let fullText = `${statusMsg} ${contextMsg}.`;
        if (cueMsg) fullText += ` ${cueMsg}`;

        if (fullText.length > 280) {
            fullText = fullText.substring(0, 277) + '...';
        }

        report[dim] = {
            label: labels[dim],
            score: score,
            text: fullText,
            cue: cueMsg || "Keep it up.",
            // Example will be added during rendering if showExamples is true
            example: CLEAR_EXAMPLES[dim] || ''
        };
    });

    return report;
}

/**
 * CLEAR Dimension Examples (shown after 2nd failed attempt)
 * Each example illustrates ONE dimension only — not a full response.
 */
const CLEAR_EXAMPLES = {
    connect: '"I see the impact this delay had on your team, and I want to address it directly."',
    listen: '"The four-hour delay created pressure for your team and led to escalation."',
    express: '"The approval step exists to manage risk, but it shouldn\'t block time-sensitive responses."',
    align: '"For urgent cases, we need a fast-track path instead of waiting for standard approval."',
    review: '"Let\'s test this approach this week and review the impact together."'
};

/**
 * Check if CLEAR examples should be shown (after 2+ failed attempts in current scenario)
 */
function shouldShowClearExamples(scenarioId) {
    if (!scenarioId) return false;
    const progress = activityProgress.scenarios[scenarioId];
    return progress && progress.failedAttempts >= 2 && !progress.scenarioPassed;
}

/**
 * Show the retry focus hint above the input section.
 * Renders comprehensive guidance when multiple areas need work.
 */
function showRetryFocusHint(inputSection) {
    // Remove any existing hint
    const existingHint = inputSection.querySelector('.retry-focus-hint');
    if (existingHint) existingHint.remove();

    if (!aiCoachSession.retryFocus || !aiCoachSession.showRetryHint) return;

    const focus = aiCoachSession.retryFocus;
    const hint = document.createElement('div');
    hint.className = 'retry-focus-hint';

    // Single focus mode (unified)
    hint.innerHTML = `
        <span class="retry-focus-label">Practice focus:</span>
        <span class="retry-focus-dimension">${focus.label}</span>
        <span class="retry-focus-text">— ${focus.hint}</span>
        <button class="retry-focus-dismiss" aria-label="Dismiss hint">×</button>
    `;

    // Dismiss button handler
    hint.querySelector('.retry-focus-dismiss').addEventListener('click', () => {
        aiCoachSession.showRetryHint = false;
        hint.remove();
    });

    // Insert at the beginning of the input section
    inputSection.insertBefore(hint, inputSection.firstChild);
}

function renderAiCoachState(state) {
    console.log(`[Render] AI Coach State: ${state.id}`);

    const stage = ensureStage();

    // Clear stage for AI Coach activity
    stage.innerHTML = '';

    // 1. Overlay Backdrop
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay-backdrop';

    // 2. AI Coach Container
    const container = document.createElement('div');
    container.className = 'ai-coach-container';

    // 3. Title (if present)
    if (state.title) {
        const title = document.createElement('h2');
        title.textContent = state.title;
        title.style.textAlign = 'center';
        title.style.marginBottom = '16px';
        title.style.color = '#fff';
        container.appendChild(title);
    }

    // 4. Scenario Video (or fallback)
    const scenarioSection = document.createElement('div');
    scenarioSection.className = 'ai-coach-scenario';

    if (state.videoSrc) {
        // Video player
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'ai-coach-video-wrapper';

        const video = document.createElement('video');
        video.className = 'ai-coach-video';
        video.src = state.videoSrc;
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;

        // Optional VTT captions
        if (state.captionsSrc) {
            const track = document.createElement('track');
            track.kind = 'captions';
            track.src = state.captionsSrc;
            track.srclang = 'en';
            track.label = 'English';
            if (captionsEnabled) {
                track.default = true;
            }
            video.appendChild(track);

            // Ensure captions state is applied when video loads
            video.addEventListener('loadedmetadata', () => {
                if (video.textTracks && video.textTracks.length > 0) {
                    video.textTracks[0].mode = captionsEnabled ? 'showing' : 'hidden';
                }
            });
        }

        // Error handling for missing video
        video.addEventListener('error', () => {
            videoWrapper.innerHTML = '<div class="ai-coach-video-fallback">Video unavailable</div>';
        });

        videoWrapper.appendChild(video);

        // --- CC Toggle for AI Coach video ---
        if (state.captionsSrc) {
            const ccBtn = document.createElement('button');
            ccBtn.className = 'cc-toggle-btn ai-coach-cc-btn' + (captionsEnabled ? ' cc-active' : '');
            ccBtn.textContent = 'CC';
            ccBtn.setAttribute('aria-pressed', String(captionsEnabled));
            ccBtn.title = 'Captions';

            ccBtn.addEventListener('click', () => {
                captionsEnabled = !captionsEnabled;
                ccBtn.classList.toggle('cc-active', captionsEnabled);
                ccBtn.setAttribute('aria-pressed', String(captionsEnabled));
                if (video.textTracks && video.textTracks.length > 0) {
                    video.textTracks[0].mode = captionsEnabled ? 'showing' : 'hidden';
                }
            });

            videoWrapper.appendChild(ccBtn);
        }

        scenarioSection.appendChild(videoWrapper);
    } else {
        // Fallback: no video source
        const fallback = document.createElement('div');
        fallback.className = 'ai-coach-video-fallback';
        fallback.textContent = 'Video unavailable';
        scenarioSection.appendChild(fallback);
    }

    // Transcript toggle (accessibility)
    if (state.transcriptText) {
        const transcriptToggle = document.createElement('button');
        transcriptToggle.className = 'ai-coach-transcript-toggle';
        transcriptToggle.textContent = 'Show transcript';
        transcriptToggle.setAttribute('aria-expanded', 'false');

        const transcriptPanel = document.createElement('div');
        transcriptPanel.className = 'ai-coach-transcript';
        transcriptPanel.textContent = state.transcriptText;
        transcriptPanel.hidden = true;

        transcriptToggle.addEventListener('click', () => {
            const isExpanded = transcriptPanel.hidden;
            transcriptPanel.hidden = !isExpanded;
            transcriptToggle.textContent = isExpanded ? 'Hide transcript' : 'Show transcript';
            transcriptToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        });

        // Auto-show transcript when video ends
        const video = scenarioSection.querySelector('video');
        if (video) {
            video.addEventListener('ended', () => {
                if (transcriptPanel.hidden) {
                    transcriptPanel.hidden = false;
                    transcriptToggle.textContent = 'Hide transcript';
                    transcriptToggle.setAttribute('aria-expanded', 'true');
                }
            });
        }

        scenarioSection.appendChild(transcriptToggle);
        scenarioSection.appendChild(transcriptPanel);
    }

    container.appendChild(scenarioSection);

    // 5. Input Section
    const inputSection = document.createElement('div');
    inputSection.className = 'ai-coach-input-section';

    const inputLabel = document.createElement('label');
    inputLabel.textContent = state.prompt || 'How would John respond?';
    inputSection.appendChild(inputLabel);

    const textarea = document.createElement('textarea');
    textarea.className = 'ai-coach-textarea';
    textarea.placeholder = 'Type your response here...';
    textarea.id = 'ai-coach-input';

    // Only restore preserved input if returning via Back (not a fresh scenario)
    // A fresh scenario has no previous attempts and aiCoachSession is reset
    if (aiCoachUserInput && aiCoachSession.previousAttempt) {
        textarea.value = aiCoachUserInput;
    }

    inputSection.appendChild(textarea);

    // Hide practice cue when user starts typing
    textarea.addEventListener('input', () => {
        const practiceCue = document.getElementById('practice-cue-box');
        if (practiceCue) {
            practiceCue.style.opacity = '0.3';
            practiceCue.style.pointerEvents = 'none';
        }
    });

    // Show practice cue when textarea loses focus (returns to viewing feedback)
    textarea.addEventListener('blur', () => {
        const practiceCue = document.getElementById('practice-cue-box');
        if (practiceCue && aiCoachSession.hasEvaluated) {
            practiceCue.style.opacity = '1';
            practiceCue.style.pointerEvents = 'auto';
        }
    });

    container.appendChild(inputSection);

    // 6. Buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'ai-coach-buttons';

    // Back Button
    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    backBtn.className = 'secondary-button ai-coach-back-btn';
    backBtn.id = 'ai-coach-back-btn';
    backBtn.disabled = false; // DEV: Always enabled for testing

    // Evaluate Button
    const evaluateBtn = document.createElement('button');
    evaluateBtn.textContent = state.submitLabel || 'EVALUATE';
    evaluateBtn.className = 'primary-button';
    evaluateBtn.id = 'ai-coach-evaluate-btn';

    // Revise Button (was Retry)
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Revise response';
    retryBtn.className = 'secondary-button revise-btn';
    retryBtn.id = 'ai-coach-retry-btn';

    // Continue Button — starts disabled until scenario is passed
    const continueBtn = document.createElement('button');
    continueBtn.textContent = state.continueLabel || 'CONTINUE';
    continueBtn.className = 'primary-button';
    continueBtn.id = 'ai-coach-continue-btn';

    // Check if scenario already passed (sticky pass) or practice mode
    const scenarioId = state.scenarioId;
    const scenarioProgress = scenarioId ? activityProgress.scenarios[scenarioId] : null;
    continueBtn.disabled = (PRACTICE_MODE || TEST_MODE) ? false : !(scenarioProgress && scenarioProgress.scenarioPassed);

    buttonContainer.appendChild(backBtn);
    buttonContainer.appendChild(evaluateBtn);
    buttonContainer.appendChild(retryBtn);
    buttonContainer.appendChild(continueBtn);
    container.appendChild(buttonContainer);

    // 7. Feedback Panel (initially hidden or shows previous feedback)
    const feedbackPanel = document.createElement('div');
    feedbackPanel.id = 'ai-coach-feedback-panel';
    container.appendChild(feedbackPanel);

    // If we have previous feedback, show it
    if (aiCoachSession.lastFeedback) {
        renderFeedback(feedbackPanel, aiCoachSession.lastFeedback);
    }

    overlay.appendChild(container);
    stage.appendChild(overlay);

    // --- Event Handlers ---

    // Evaluate Button Click
    evaluateBtn.addEventListener('click', async () => {
        const userAnswer = textarea.value.trim();

        if (!userAnswer) {
            alert('Please enter a response before evaluating.');
            return;
        }

        // Show loading state
        evaluateBtn.disabled = true;
        evaluateBtn.textContent = 'Evaluating...';
        feedbackPanel.innerHTML = '<div class="ai-coach-loading">Analyzing your response...</div>';
        aiCoachSession.isLoading = true;

        try {
            const response = await fetch('/api/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scenarioId: state.id,
                    situationText: state.situationText,
                    userAnswer: userAnswer
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Evaluation failed');
            }

            const feedback = await response.json();
            console.log('[AI Coach] Feedback received:', feedback);

            // Store feedback and update session
            aiCoachSession.lastFeedback = feedback;
            aiCoachSession.hasEvaluated = true;

            // Generate and store report
            aiCoachSession.lastReport = buildClearCoachingReport(feedback);

            // Store current attempt for progress comparison on retry
            aiCoachSession.currentAttempt = {
                userAnswer: userAnswer,
                clearScores: feedback.clear_scores
            };

            // --- Progression Tracking ---
            const scenarioId = state.scenarioId;
            if (scenarioId) {
                activityProgress.currentScenarioId = scenarioId;
                recordAttempt(scenarioId, feedback.score_total, feedback.clear_scores, userAnswer);
            }

            const scenarioProgress = scenarioId ? activityProgress.scenarios[scenarioId] : null;
            const config = scenarioId ? SCENARIO_CONFIG[scenarioId] : null;

            // Render feedback with progression context
            renderFeedback(feedbackPanel, feedback, state.situationText, scenarioId);

            // Gate Continue button based on sticky pass (or practice mode)
            if (PRACTICE_MODE || (scenarioProgress && scenarioProgress.scenarioPassed)) {
                continueBtn.disabled = false;
                continueBtn.style.display = '';
            } else {
                continueBtn.disabled = true;
                // Show threshold message
                if (config && feedback.score_total < config.threshold) {
                    const lockedMsg = document.createElement('div');
                    lockedMsg.className = 'continue-locked-message';
                    lockedMsg.textContent = `You need ${config.threshold} points to unlock the next scenario. You scored ${feedback.score_total}.`;
                    feedbackPanel.appendChild(lockedMsg);
                }

                // S3 Guided Reset: Show help after 2+ failed attempts
                if (scenarioId === 'S3' && shouldShowS3GuidedHelp()) {
                    const helpPanel = document.createElement('div');
                    helpPanel.className = 's3-guided-help';
                    helpPanel.innerHTML = `
                        <h4 class="s3-help-title">${S3_GUIDED_HELP.title}</h4>
                        <p class="s3-help-intro">${S3_GUIDED_HELP.intro}</p>
                        <p class="s3-help-list-intro">${S3_GUIDED_HELP.listIntro}</p>
                        <ul class="s3-help-list">
                            ${S3_GUIDED_HELP.items.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    `;
                    feedbackPanel.appendChild(helpPanel);
                }
            }

        } catch (error) {
            console.error('[AI Coach] Evaluation error:', error);
            feedbackPanel.innerHTML = `<div class="ai-coach-error">
                <p>Unable to evaluate your response. Please try again.</p>
                <p style="font-size: 12px; opacity: 0.7;">${error.message}</p>
            </div>`;
        } finally {
            // Keep Evaluate disabled after evaluation until user clicks Revise
            evaluateBtn.disabled = true;
            evaluateBtn.textContent = state.submitLabel || 'EVALUATE';
            aiCoachSession.isLoading = false;

            // Highlight Revise button to guide user
            retryBtn.classList.add('revise-btn-highlight');
        }
    });

    // Back Button Click
    backBtn.addEventListener('click', () => {
        console.log('[AI Coach] Back clicked');
        goBackAiCoach();
    });

    // Retry Button Click — Practice-focused transition
    retryBtn.addEventListener('click', () => {
        // Store previous attempt (for progress comparison)
        if (aiCoachSession.lastFeedback && aiCoachSession.currentAttempt) {
            aiCoachSession.previousAttempt = {
                userAnswer: aiCoachSession.currentAttempt.userAnswer,
                clearScores: aiCoachSession.currentAttempt.clearScores
            };

            // Compute retry focus based on lowest CLEAR dimension
            if (aiCoachSession.lastReport) {
                aiCoachSession.retryFocus = computeRetryFocus(
                    aiCoachSession.lastFeedback.clear_scores,
                    aiCoachSession.lastReport
                );
            }
        }

        // Keep previous response (prefilled for editing) — do NOT clear textarea
        // textarea.value stays as-is

        // Clear feedback panel
        feedbackPanel.innerHTML = '';

        // Reset evaluation state (not full session)
        aiCoachSession.lastFeedback = null;
        aiCoachSession.hasEvaluated = false;
        aiCoachSession.currentAttempt = null;
        aiCoachSession.showRetryHint = true;

        // Disable continue until next evaluation
        continueBtn.disabled = true;

        // Re-enable Evaluate button and remove highlight from Revise
        evaluateBtn.disabled = false;
        retryBtn.classList.remove('revise-btn-highlight');

        // Show practice focus hint
        showRetryFocusHint(inputSection);

        textarea.focus();
    });

    // Continue Button Click — Guarded by scenarioPassed (or PRACTICE_MODE)
    continueBtn.addEventListener('click', () => {
        const scenarioId = state.scenarioId;
        const progress = scenarioId ? activityProgress.scenarios[scenarioId] : null;

        // Guard: only proceed if scenario is passed (or practice mode is on)
        if (!PRACTICE_MODE && progress && !progress.scenarioPassed) {
            console.log('[AI Coach] Continue blocked - scenario not passed');
            return;
        }

        // Clear preserved user input for fresh start on next scenario
        aiCoachUserInput = '';
        // Reset AI Coach session for next activity (full reset)
        aiCoachSession = {
            hasEvaluated: false,
            lastFeedback: null,
            lastReport: null,
            isLoading: false,
            previousAttempt: null,
            currentAttempt: null,
            retryFocus: null,
            showRetryHint: true
        };

        // Determine next scenario
        const nextScenarioId = getNextScenarioId(scenarioId);

        if (nextScenarioId) {
            // Transition to next scenario
            activityProgress.currentScenarioId = nextScenarioId;
            const nextActivityId = getActivityIdForScenario(nextScenarioId);
            if (nextActivityId) {
                go(nextActivityId);
            } else if (state.next) {
                go(state.next);
            }
        } else {
            // Final scenario completed - show completion screen
            activityProgress.activityStatus = 'COMPLETED';
            if (state.next) {
                go(state.next);
            } else {
                go('end');
            }
        }
    });
}

function renderFeedback(container, feedback, situationText, scenarioId) {
    container.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'ai-coach-feedback';

    // --- Build sections (don't append yet) ---

    // Progress since last attempt (if retry)
    let progressSection = null;
    if (aiCoachSession.previousAttempt && feedback.clear_scores) {
        const progressText = computeProgressLine(
            aiCoachSession.previousAttempt.clearScores,
            feedback.clear_scores
        );

        if (progressText) {
            progressSection = document.createElement('div');
            progressSection.className = 'ai-coach-progress-line';
            progressSection.textContent = progressText;
        }
    }

    // Key Improvement (Removed/Integrated into Report)

    // Score Header
    const scoreHeader = document.createElement('div');
    scoreHeader.className = 'ai-coach-score-header';

    const scoreCircle = document.createElement('div');
    scoreCircle.className = 'ai-coach-score-circle';
    scoreCircle.textContent = feedback.score_total || 0;
    scoreHeader.appendChild(scoreCircle);

    const scoreLabel = document.createElement('div');
    scoreLabel.className = 'ai-coach-score-label';
    scoreLabel.textContent = 'Overall Score';
    scoreHeader.appendChild(scoreLabel);

    // CLEAR Scores Grid
    let clearGrid = null;
    if (feedback.clear_scores) {
        clearGrid = document.createElement('div');
        clearGrid.className = 'clear-score-grid';

        const clearLabels = ['Connect', 'Listen', 'Express', 'Align', 'Review'];
        const clearKeys = ['connect', 'listen', 'express', 'align', 'review'];
        const clearTooltips = [
            {
                definition: 'Acknowledge the person and keep the tone respectful and calm.',
                lookFor: 'Warm opener • Respectful language'
            },
            {
                definition: 'Show you understand their concern by reflecting it back or asking a clarifying question.',
                lookFor: 'Paraphrase • Clarify'
            },
            {
                definition: 'State your perspective clearly—facts, impact, and what you can/can\'t do—without blame.',
                lookFor: 'Clear "I" statements • Boundaries'
            },
            {
                definition: 'Propose a way forward that meets both needs: options, next steps, and collaboration.',
                lookFor: 'Options • Shared plan'
            },
            {
                definition: 'Confirm agreement and what happens next, including timing or a check-in.',
                lookFor: 'Summarize • Next checkpoint'
            }
        ];

        clearKeys.forEach((key, index) => {
            const item = document.createElement('div');
            item.className = 'clear-score-item';
            item.tabIndex = 0; // Keyboard accessibility

            // Unique ID for aria-describedby
            const tooltipId = `clear-tooltip-${key}`;
            item.setAttribute('aria-describedby', tooltipId);

            const label = document.createElement('div');
            label.className = 'label';
            label.textContent = clearLabels[index];
            item.appendChild(label);

            const value = document.createElement('div');
            value.className = 'value';
            value.textContent = feedback.clear_scores[key] ?? 0;
            item.appendChild(value);

            // Create tooltip in portal (document.body) for overflow escape
            const tooltip = document.createElement('div');
            tooltip.id = tooltipId;
            tooltip.className = 'clear-tooltip-portal';
            tooltip.setAttribute('role', 'tooltip');
            tooltip.innerHTML = `
                <div class="clear-tooltip-definition">${clearTooltips[index].definition}</div>
                <div class="clear-tooltip-lookfor"><span class="lookfor-label">Look for:</span> ${clearTooltips[index].lookFor}</div>
                <div class="clear-tooltip-scale">
                    <span class="scale-label">Scale:</span>
                    <span class="scale-item">0 = Not demonstrated</span>
                    <span class="scale-item">1 = Partially or implicitly</span>
                    <span class="scale-item">2 = Clearly demonstrated</span>
                </div>
            `;
            document.body.appendChild(tooltip);

            // Position tooltip relative to item with edge detection
            const positionTooltip = () => {
                const itemRect = item.getBoundingClientRect();

                // Temporarily make tooltip measurable (visible but transparent)
                tooltip.style.opacity = '0';
                tooltip.style.visibility = 'visible';
                tooltip.style.display = 'block';

                const tooltipRect = tooltip.getBoundingClientRect();
                const padding = 12; // viewport edge padding

                // Default: center above the item
                let left = itemRect.left + (itemRect.width / 2) - (tooltipRect.width / 2);
                let top = itemRect.top - tooltipRect.height - 8;

                // Edge detection: clamp left/right
                if (left < padding) {
                    left = padding;
                }
                if (left + tooltipRect.width > window.innerWidth - padding) {
                    left = window.innerWidth - tooltipRect.width - padding;
                }

                // Edge detection: flip below if near top
                if (top < padding) {
                    top = itemRect.bottom + 8;
                    tooltip.classList.add('tooltip-below');
                } else {
                    tooltip.classList.remove('tooltip-below');
                }

                tooltip.style.left = `${left}px`;
                tooltip.style.top = `${top}px`;

                // Reset inline styles, let CSS class handle visibility
                tooltip.style.opacity = '';
                tooltip.style.visibility = '';
                tooltip.style.display = '';
            };

            // Show/hide handlers
            const showTooltip = () => {
                positionTooltip();
                tooltip.classList.add('visible');
            };

            const hideTooltip = () => {
                tooltip.classList.remove('visible');
            };

            // Mouse events
            item.addEventListener('mouseenter', showTooltip);
            item.addEventListener('mouseleave', hideTooltip);

            // Keyboard events
            item.addEventListener('focus', showTooltip);
            item.addEventListener('blur', hideTooltip);

            // Mobile tap-to-toggle
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close any other open tooltips first
                document.querySelectorAll('.clear-tooltip-portal.visible').forEach(el => {
                    if (el !== tooltip) el.classList.remove('visible');
                });
                if (tooltip.classList.contains('visible')) {
                    hideTooltip();
                } else {
                    showTooltip();
                }
            });

            // Store reference for cleanup
            item._tooltip = tooltip;

            clearGrid.appendChild(item);
        });

        // Close tooltips when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.clear-score-item')) {
                document.querySelectorAll('.clear-tooltip-portal.visible').forEach(el => {
                    el.classList.remove('visible');
                });
            }
        });
    }

    if (clearGrid) panel.appendChild(clearGrid);

    // 3. New CLEAR Coaching Report Block
    const coachingReport = buildClearCoachingReport(feedback);

    const reportContainer = document.createElement('div');
    reportContainer.className = 'clear-coaching-report-container';

    const reportTitle = document.createElement('h3');
    reportTitle.className = 'clear-coaching-title';
    reportTitle.textContent = 'CLEAR Coaching Report';
    reportContainer.appendChild(reportTitle);

    const reportList = document.createElement('div');
    reportList.className = 'clear-coaching-list';

    // Check if examples should be shown (2+ failed attempts)
    const showExamples = shouldShowClearExamples(scenarioId);

    ['connect', 'listen', 'express', 'align', 'review'].forEach(dim => {
        const item = coachingReport[dim];
        const line = document.createElement('div');
        line.className = `clear-coaching-line score-${item.score}`;

        const header = document.createElement('div');
        header.className = 'clear-coaching-header';

        // Capitalize
        const label = item.label;

        header.innerHTML = `<span class="dim-name">${label}</span>`;

        const text = document.createElement('p');
        text.className = 'clear-coaching-text';
        text.textContent = item.text;

        line.appendChild(header);
        line.appendChild(text);

        // Add example if applicable (after 2+ failed attempts, for non-perfect dimensions)
        if (showExamples && item.score < 2 && item.example) {
            const exampleEl = document.createElement('p');
            exampleEl.className = 'clear-coaching-example';
            exampleEl.innerHTML = `<span class="example-label">Example:</span> ${item.example}`;
            line.appendChild(exampleEl);
        }

        reportList.appendChild(line);
    });

    reportContainer.appendChild(reportList);
    // reportContainer will be appended in the final section

    // Rewrite (Collapsible - default collapsed)
    // Only show if suggested answer is unlocked for this scenario
    let rewriteSection = null;
    const showSuggested = scenarioId ? isSuggestedAnswerUnlocked(scenarioId) : true;
    if (feedback.rewrite && showSuggested) {
        rewriteSection = document.createElement('div');
        rewriteSection.className = 'ai-coach-section ai-coach-collapsible';

        // Toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'ai-coach-toggle-btn';
        toggleBtn.textContent = 'Show suggested response';
        toggleBtn.setAttribute('aria-expanded', 'false');
        rewriteSection.appendChild(toggleBtn);

        // Collapsible content wrapper
        const rewriteContent = document.createElement('div');
        rewriteContent.className = 'ai-coach-collapsible-content';
        rewriteContent.style.display = 'none'; // Collapsed by default

        const rewriteBox = document.createElement('div');
        rewriteBox.className = 'rewrite-box';

        if (feedback.rewrite.best_practice_version) {
            const rewriteText = document.createElement('div');
            rewriteText.className = 'rewrite-text';
            rewriteText.textContent = `"${feedback.rewrite.best_practice_version}"`;
            rewriteBox.appendChild(rewriteText);
        }

        if (feedback.rewrite.why_this_is_better && feedback.rewrite.why_this_is_better.length > 0) {
            const whyList = document.createElement('ul');
            feedback.rewrite.why_this_is_better.forEach(w => {
                const li = document.createElement('li');
                li.textContent = w;
                whyList.appendChild(li);
            });
            rewriteBox.appendChild(whyList);
        }

        rewriteContent.appendChild(rewriteBox);
        rewriteSection.appendChild(rewriteContent);

        // Toggle logic
        toggleBtn.addEventListener('click', () => {
            const isExpanded = rewriteContent.style.display !== 'none';
            rewriteContent.style.display = isExpanded ? 'none' : 'block';
            toggleBtn.textContent = isExpanded ? 'Show suggested response' : 'Hide suggested response';
            toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
        });
    }

    // Practice Cue (replaces Coaching Question)
    // Find lowest CLEAR dimension and use its cue
    let practiceCueSection = null;
    if (coachingReport) {
        const priorityOrder = ['listen', 'express', 'align', 'connect', 'review'];
        const clearScores = feedback.clear_scores || {};

        // Find lowest score with priority tie-breaking
        const minScore = Math.min(...Object.values(clearScores));
        const focusKey = priorityOrder.find(k => (clearScores[k] ?? 0) === minScore) || 'listen';
        const focusDim = coachingReport[focusKey];

        if (focusDim && focusDim.cue) {
            practiceCueSection = document.createElement('div');
            practiceCueSection.className = 'practice-cue';
            practiceCueSection.id = 'practice-cue-box';

            // Format: "Practice cue (Listen)"
            const cueLabel = document.createElement('span');
            cueLabel.className = 'practice-cue-label';
            cueLabel.textContent = `Practice cue (${focusDim.label})`;

            const cueText = document.createElement('p');
            cueText.className = 'practice-cue-text';

            // Build practice cue: max 110 chars, one complete sentence
            let rawCue = focusDim.cue.replace(/\?/g, '').trim();
            // Remove leading "Try:" or "Try to:" if present
            rawCue = rawCue.replace(/^Try:?\s*/i, '').replace(/^Try to:?\s*/i, '');
            // Remove trailing periods
            rawCue = rawCue.replace(/\.+$/, '').trim();

            // Build the full cue
            const prefix = 'On your next attempt, try ';
            let actionPart = rawCue.charAt(0).toLowerCase() + rawCue.slice(1);
            let cueContent = prefix + actionPart + '.';

            // If too long, shorten the action part intelligently
            const maxLen = 110;
            if (cueContent.length > maxLen) {
                // Try to find a natural break point (comma, semicolon, or word boundary)
                const availableLen = maxLen - prefix.length - 1; // -1 for final period
                let shortened = actionPart.substring(0, availableLen);

                // Find last complete word boundary
                const lastSpace = shortened.lastIndexOf(' ');
                if (lastSpace > availableLen * 0.5) {
                    shortened = shortened.substring(0, lastSpace);
                }

                // Clean up any trailing punctuation or incomplete phrases
                shortened = shortened.replace(/[,;:\s]+$/, '').trim();

                cueContent = prefix + shortened + '.';
            }

            cueText.textContent = cueContent;

            practiceCueSection.appendChild(cueLabel);
            practiceCueSection.appendChild(cueText);
        }
    }

    // --- Append in layout order ---
    // 0. Progress since last attempt (if retry)
    if (progressSection) panel.appendChild(progressSection);
    // 1. Overall Score (TOP)
    panel.appendChild(scoreHeader);
    // 2. CLEAR Score Tiles
    if (clearGrid) panel.appendChild(clearGrid);
    // 3. CLEAR Coaching Report (detailed feedback)
    panel.appendChild(reportContainer);
    // 4. Suggested Response (collapsible)
    if (rewriteSection) panel.appendChild(rewriteSection);
    // 5. Practice Cue (action bridge at bottom)
    if (practiceCueSection) panel.appendChild(practiceCueSection);

    container.appendChild(panel);
}

// --- Boot ---
function init() {
    // Check for reset flag
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('reset') && urlParams.get('reset') === '1') {
        localStorage.removeItem(STORAGE_KEY);
        console.log('[Debug] Progress reset');
    }

    const initialId = SCENARIO.initial || 'intro';
    go(initialId);
}

init();

// Expose for debugging
window.app = {
    go,
    getExploredStyles,
    markStyleExplored,
    isStyleExplored
};
