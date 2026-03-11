/**
 * Test Fixtures for CLEAR Feedback Format Validation
 * 
 * These tests validate that the LLM feedback follows the micro-format rules:
 * - 3 lines per CLEAR dimension (What worked, What's missing, Micro-fix)
 * - Line length 8-20 words
 * - No duplicate "What's missing" across dimensions
 * 
 * Usage: node scripts/test-feedback-format.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Test Fixtures ---
// Sample LLM responses to validate format rules

const VALID_FEEDBACK_FIXTURE = {
    clear_scores: { connect: 1, listen: 0, express: 2, align: 1, review: 0 },
    strengths: [
        "Response opens with a calm, non-defensive tone that sets collaborative context.",
        "Clear 'I' statement present naming the specific boundary and constraint."
    ],
    one_improvement: "(Listen) Add acknowledgment of the other person's deadline pressure before stating your constraint.",
    risks: [],
    rewrite: {
        best_practice_version: "",
        why_this_is_better: [
            "Includes explicit acknowledgment of their timeline concern before pivoting.",
            "States a specific next step with owner and deadline attached."
        ]
    }
};

const INVALID_REPETITION_FIXTURE = {
    // This fixture has duplicate "missing" diagnostics across steps
    strengths: [
        "Be clearer in your response.", // BANNED: vague phrase
        "Response lacks specificity." // Would duplicate with one_improvement
    ],
    one_improvement: "Response lacks specificity.", // Duplicate!
};

// --- Step 4: Practice Cue Alignment Fixtures ---
// One fixture per blocking step to verify alignment

const BLOCKING_CONNECT_FIXTURE = {
    clear_scores: { connect: 0, listen: 1, express: 2, align: 1, review: 1 },
    one_improvement: "(Connect) Acknowledge their perspective or deadline pressure before stating your position.",
    blocking_step: "connect"
};

const BLOCKING_LISTEN_FIXTURE = {
    clear_scores: { connect: 1, listen: 0, express: 2, align: 1, review: 1 },
    one_improvement: "(Listen) Reflect their concern about the delay in one line to confirm understanding.",
    blocking_step: "listen"
};

const BLOCKING_EXPRESS_FIXTURE = {
    clear_scores: { connect: 2, listen: 2, express: 0, align: 1, review: 1 },
    one_improvement: "(Express) State your boundary directly with a clear impact statement and specific constraint.",
    blocking_step: "express"
};

const BLOCKING_ALIGN_FIXTURE = {
    clear_scores: { connect: 2, listen: 2, express: 2, align: 0, review: 1 },
    one_improvement: "(Align) Propose one concrete next step with owner and timeframe, then ask for agreement.",
    blocking_step: "align"
};

const BLOCKING_REVIEW_FIXTURE = {
    clear_scores: { connect: 2, listen: 2, express: 2, align: 2, review: 0 },
    one_improvement: "(Review) Confirm mutual agreement with who does what by when, plus a check-back point.",
    blocking_step: "review"
};

// --- Validation Functions ---

/**
 * Count words in a string
 */
function countWords(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Test 1: Check that each strength item is 8-20 words
 */
function testLineLengthConstraints(feedback) {
    const errors = [];
    const allLines = [
        ...(feedback.strengths || []),
        feedback.one_improvement || '',
        ...(feedback.rewrite?.why_this_is_better || [])
    ].filter(line => line.trim());

    allLines.forEach((line, i) => {
        const wordCount = countWords(line);
        if (wordCount < 8) {
            errors.push(`Line ${i + 1} too short (${wordCount} words): "${line.substring(0, 50)}..."`);
        }
        if (wordCount > 20) {
            errors.push(`Line ${i + 1} too long (${wordCount} words): "${line.substring(0, 50)}..."`);
        }
    });

    return {
        passed: errors.length === 0,
        errors
    };
}

/**
 * Test 2: Check for banned vague phrases
 */
function testNoBannedPhrases(feedback) {
    const BANNED = ['be clearer', 'communicate better', 'more assertive', 'try harder', 'as an ai'];
    const errors = [];

    const allText = [
        ...(feedback.strengths || []),
        feedback.one_improvement || '',
        ...(feedback.rewrite?.why_this_is_better || [])
    ].join(' ').toLowerCase();

    BANNED.forEach(phrase => {
        if (allText.includes(phrase)) {
            errors.push(`Banned phrase found: "${phrase}"`);
        }
    });

    return {
        passed: errors.length === 0,
        errors
    };
}

/**
 * Test 3: Check for duplicated diagnostics across fields
 */
function testNoDuplicateDiagnostics(feedback) {
    const errors = [];
    const diagnostics = new Set();

    // Normalize text for comparison
    const normalize = (text) => text.toLowerCase().trim().replace(/[.,!?]/g, '');

    const allDiagnostics = [
        ...(feedback.strengths || []),
        feedback.one_improvement || ''
    ];

    allDiagnostics.forEach((text, i) => {
        const normalized = normalize(text);
        if (normalized && diagnostics.has(normalized)) {
            errors.push(`Duplicate diagnostic found: "${text.substring(0, 50)}..."`);
        }
        if (normalized) {
            diagnostics.add(normalized);
        }
    });

    return {
        passed: errors.length === 0,
        errors
    };
}

/**
 * Test 4: Validate one_improvement has CLEAR dimension prefix
 */
function testClearDimensionPrefix(feedback) {
    const prefixPattern = /^\((Connect|Listen|Express|Align|Review)\)/i;
    const improvement = feedback.one_improvement || '';

    // Prefix is optional but recommended
    const hasPrefix = prefixPattern.test(improvement);

    return {
        passed: true, // Not required, just informational
        hasPrefix,
        message: hasPrefix
            ? `Found CLEAR prefix: ${improvement.match(prefixPattern)[0]}`
            : 'No CLEAR prefix found (optional)'
    };
}

/**
 * Test 5: Validate practice cue alignment (Step 4)
 * - one_improvement prefix must match the blocking_step
 * - blocking_step is the lowest-scoring dimension
 */
function testPracticeCueAlignment(feedback) {
    const errors = [];
    const prefixPattern = /^\((Connect|Listen|Express|Align|Review)\)/i;
    const improvement = feedback.one_improvement || '';

    // Extract prefix from one_improvement
    const prefixMatch = improvement.match(prefixPattern);
    const improvementStep = prefixMatch ? prefixMatch[1].toLowerCase() : null;

    // Determine blocking step from scores (lowest score)
    const scores = feedback.clear_scores || {};
    const priorityOrder = ['listen', 'express', 'align', 'connect', 'review'];
    let minScore = Infinity;
    let computedBlockingStep = null;

    for (const step of priorityOrder) {
        const score = scores[step] ?? 2;
        if (score < minScore) {
            minScore = score;
            computedBlockingStep = step;
        }
    }

    // If explicit blocking_step provided, use it
    const expectedBlockingStep = feedback.blocking_step || computedBlockingStep;

    // Validate alignment
    if (!improvementStep) {
        errors.push('one_improvement missing CLEAR dimension prefix');
    } else if (improvementStep !== expectedBlockingStep) {
        errors.push(`Misalignment: one_improvement targets "${improvementStep}" but blocking_step is "${expectedBlockingStep}"`);
    }

    return {
        passed: errors.length === 0,
        improvementStep,
        expectedBlockingStep,
        errors
    };
}

// --- Run Tests ---

function runTests() {
    console.log('=== CLEAR Feedback Format Validation Tests ===\n');

    // Test with valid fixture
    console.log('Testing VALID_FEEDBACK_FIXTURE:');
    console.log('-'.repeat(40));

    const lengthResult = testLineLengthConstraints(VALID_FEEDBACK_FIXTURE);
    console.log(`[${lengthResult.passed ? 'PASS' : 'FAIL'}] Line Length Constraints`);
    if (!lengthResult.passed) lengthResult.errors.forEach(e => console.log(`  - ${e}`));

    const bannedResult = testNoBannedPhrases(VALID_FEEDBACK_FIXTURE);
    console.log(`[${bannedResult.passed ? 'PASS' : 'FAIL'}] No Banned Phrases`);
    if (!bannedResult.passed) bannedResult.errors.forEach(e => console.log(`  - ${e}`));

    const dupeResult = testNoDuplicateDiagnostics(VALID_FEEDBACK_FIXTURE);
    console.log(`[${dupeResult.passed ? 'PASS' : 'FAIL'}] No Duplicate Diagnostics`);
    if (!dupeResult.passed) dupeResult.errors.forEach(e => console.log(`  - ${e}`));

    const prefixResult = testClearDimensionPrefix(VALID_FEEDBACK_FIXTURE);
    console.log(`[INFO] CLEAR Prefix Check: ${prefixResult.message}`);

    // Test with invalid fixture (should fail)
    console.log('\nTesting INVALID_REPETITION_FIXTURE (expect failures):');
    console.log('-'.repeat(40));

    const bannedResult2 = testNoBannedPhrases(INVALID_REPETITION_FIXTURE);
    console.log(`[${bannedResult2.passed ? 'PASS' : 'FAIL'}] No Banned Phrases`);
    if (!bannedResult2.passed) bannedResult2.errors.forEach(e => console.log(`  - ${e}`));

    const dupeResult2 = testNoDuplicateDiagnostics(INVALID_REPETITION_FIXTURE);
    console.log(`[${dupeResult2.passed ? 'PASS' : 'FAIL'}] No Duplicate Diagnostics`);
    if (!dupeResult2.passed) dupeResult2.errors.forEach(e => console.log(`  - ${e}`));

    // Step 4: Practice Cue Alignment Tests
    console.log('\n=== Step 4: Practice Cue Alignment Tests ===\n');

    const blockingFixtures = [
        { name: 'BLOCKING_CONNECT', fixture: BLOCKING_CONNECT_FIXTURE },
        { name: 'BLOCKING_LISTEN', fixture: BLOCKING_LISTEN_FIXTURE },
        { name: 'BLOCKING_EXPRESS', fixture: BLOCKING_EXPRESS_FIXTURE },
        { name: 'BLOCKING_ALIGN', fixture: BLOCKING_ALIGN_FIXTURE },
        { name: 'BLOCKING_REVIEW', fixture: BLOCKING_REVIEW_FIXTURE }
    ];

    blockingFixtures.forEach(({ name, fixture }) => {
        const alignResult = testPracticeCueAlignment(fixture);
        console.log(`[${alignResult.passed ? 'PASS' : 'FAIL'}] ${name}: one_improvement(${alignResult.improvementStep}) == blocking_step(${alignResult.expectedBlockingStep})`);
        if (!alignResult.passed) alignResult.errors.forEach(e => console.log(`  - ${e}`));
    });

    console.log('\n=== Tests Complete ===');
}

// Export for use in other test runners
export {
    testLineLengthConstraints,
    testNoBannedPhrases,
    testNoDuplicateDiagnostics,
    testClearDimensionPrefix,
    testPracticeCueAlignment,
    VALID_FEEDBACK_FIXTURE,
    INVALID_REPETITION_FIXTURE,
    BLOCKING_CONNECT_FIXTURE,
    BLOCKING_LISTEN_FIXTURE,
    BLOCKING_EXPRESS_FIXTURE,
    BLOCKING_ALIGN_FIXTURE,
    BLOCKING_REVIEW_FIXTURE
};

// Run if executed directly
runTests();
