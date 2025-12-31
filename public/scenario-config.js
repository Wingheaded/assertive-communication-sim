/**
 * Scenario Progression Configuration
 * Source of truth for mastery-gated progression rules.
 */

const SCENARIO_CONFIG = {
    S1: {
        id: 'S1',
        activityId: 'activity',
        threshold: 75,
        suggested: {
            enabled: true,
            unlockAfterFailedAttempts: 1
        }
    },
    S2: {
        id: 'S2',
        activityId: 'activity_sofia',
        threshold: 85,
        suggested: {
            enabled: true,
            unlockAfterFailedAttempts: 2
        }
    },
    S3: {
        id: 'S3',
        activityId: 'activity_daniel',
        threshold: 90,
        suggested: {
            enabled: false,
            unlockAfterFailedAttempts: Infinity
        }
    }
};

// Map activity IDs to scenario IDs
const ACTIVITY_TO_SCENARIO = {
    'activity': 'S1',
    'activity_sofia': 'S2',
    'activity_daniel': 'S3'
};

// Scenario order for progression
const SCENARIO_ORDER = ['S1', 'S2', 'S3'];

/**
 * Get scenario config by activity ID
 */
function getScenarioConfig(activityId) {
    const scenarioId = ACTIVITY_TO_SCENARIO[activityId];
    return scenarioId ? SCENARIO_CONFIG[scenarioId] : null;
}

/**
 * Get next scenario ID after the given one
 */
function getNextScenarioId(currentScenarioId) {
    const idx = SCENARIO_ORDER.indexOf(currentScenarioId);
    if (idx >= 0 && idx < SCENARIO_ORDER.length - 1) {
        return SCENARIO_ORDER[idx + 1];
    }
    return null; // No next scenario (activity complete)
}

/**
 * Get activity ID for a scenario ID
 */
function getActivityIdForScenario(scenarioId) {
    return SCENARIO_CONFIG[scenarioId]?.activityId || null;
}

export {
    SCENARIO_CONFIG,
    ACTIVITY_TO_SCENARIO,
    SCENARIO_ORDER,
    getScenarioConfig,
    getNextScenarioId,
    getActivityIdForScenario
};
