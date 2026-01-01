const SCENARIO = {
    // DEV ONLY: start directly at CLEAR intro for testing
    initial: 'clear_model_intro',
    states: {
        // CLEAR Model Intro (before AI Coach)
        clear_model_intro: {
            id: 'clear_model_intro',
            type: 'reflection',
            prompt: `<div class="clear-intro">
    <h2 class="clear-intro-title">How Assertive Communication Works</h2>
    <div class="clear-intro-body">
        <p>Assertive communication is about expressing your needs clearly while still respecting the other person.</p>
        <p>It becomes especially important in moments of pressure, disagreement, or urgency — like the situation you just experienced.</p>
        <p class="clear-intro-lead">To help you reflect on how assertive communication shows up in practice, we'll use a simple framework called <strong>CLEAR</strong>.</p>
        <ul class="clear-steps">
            <li><span class="clear-step-label">Connect</span><span class="clear-step-desc">Start in a way that keeps the conversation human and respectful.</span></li>
            <li><span class="clear-step-label">Listen</span><span class="clear-step-desc">Show that you understand the other person's concern or perspective.</span></li>
            <li><span class="clear-step-label">Express</span><span class="clear-step-desc">Clearly state your own needs, limits, or point of view using "I" statements.</span></li>
            <li><span class="clear-step-label">Align</span><span class="clear-step-desc">Move the conversation toward a shared next step or solution.</span></li>
            <li><span class="clear-step-label">Review</span><span class="clear-step-desc">Confirm what was agreed or what will happen next.</span></li>
        </ul>
        <p class="clear-intro-footer">The AI Coach will use these five elements to give you feedback on your response.</p>
    </div>
</div>`,
            button: 'Continue to practice',
            next: 'activity'
        },
        anna_issue: {
            id: 'anna_issue',
            type: 'video',
            video: '/assets/videos/placeholders/01.TheIssue.mp4',
            next: 'hub'
        },
        hub: {
            id: 'hub',
            type: 'choice',
            prompt: 'Anna raises a concern about your work.\nHow does John respond?',
            contextOverlay: {
                text: "Anna is leading the meeting.\nShe’s raising a concern about a delay in your work.\nYou’re John. How you respond will shape what happens next.",
                buttonLabel: "Answer"
            },
            choices: [
                { label: 'Sorry… I’ve been swamped, but I’ll try to do better.', target: 'passive_john_response', styleId: 'passive' },
                { label: 'You keep bringing this up when I’m already stretched too thin.', target: 'aggressive_john_response', styleId: 'aggressive' },
                { label: 'I understand the delay has an impact. The challenge is that I need clearer priorities. Can we align what’s most urgent so I can deliver on time?', target: 'assertive_john_response', styleId: 'assertive' }
            ]
        },
        // Passive Branch
        passive_john_response: {
            id: 'passive_john_response',
            type: 'video',
            video: '/assets/videos/placeholders/01.JohnsPassiveAnwer.mp4',
            next: 'passive_reflection_1'
        },
        passive_reflection_1: {
            id: 'passive_reflection_1',
            type: 'reflection',
            prompt: "You have chosen the <span class='style-tag'>Passive</span> Communication Style. Let’s see how Anna reacts!\nPay attention to the body language as well.",
            button: 'Continue',
            next: 'passive_anna_reaction'
        },
        passive_anna_reaction: {
            id: 'passive_anna_reaction',
            type: 'video',
            video: '/assets/videos/placeholders/02.AnnaPassiveReaction.mp4',
            next: 'passive_reflection_2'
        },
        passive_reflection_2: {
            id: 'passive_reflection_2',
            type: 'reflection',
            prompt: "Now, let’s pause for a moment to reflect on how that exchange unfolded.\nWhat does this tell us about John’s communication style?",
            button: 'Continue',
            next: 'passive_feedback'
        },
        passive_feedback: {
            id: 'passive_feedback',
            type: 'video',
            video: '/assets/videos/placeholders/03.narratorPassivefeedback.mp4',
            onComplete: { markExplored: 'passive' },
            next: 'passive_after_feedback'
        },
        // Passive End Overlay
        passive_after_feedback: {
            id: 'passive_after_feedback',
            type: 'reflection',
            dynamicEndBranch: true
        },
        // Aggressive Branch
        aggressive_john_response: {
            id: 'aggressive_john_response',
            type: 'video',
            video: '/assets/videos/placeholders/01JohnsAggressiveAnwer.mp4',
            next: 'aggressive_reflection_after_john'
        },
        aggressive_reflection_after_john: {
            id: 'aggressive_reflection_after_john',
            type: 'reflection',
            prompt: "You have chosen the <span class='style-tag'>Aggressive</span> Communication Style. Let’s see how Anna reacts!\nPay attention to the body language as well.",
            button: 'Continue',
            next: 'aggressive_anna_reaction'
        },
        aggressive_anna_reaction: {
            id: 'aggressive_anna_reaction',
            type: 'video',
            video: '/assets/videos/placeholders/02.AnnaAggressiveReaction.mp4',
            next: 'aggressive_reflection_after_anna'
        },
        aggressive_reflection_after_anna: {
            id: 'aggressive_reflection_after_anna',
            type: 'reflection',
            prompt: "Now, let’s pause for a moment to reflect on how that exchange unfolded.\nWhat does this tell us about John’s communication style?",
            button: 'Continue',
            next: 'aggressive_feedback'
        },
        aggressive_feedback: {
            id: 'aggressive_feedback',
            type: 'video',
            video: '/assets/videos/placeholders/03.NarratorAgreesiveFeedback.mp4',
            onComplete: { markExplored: 'aggressive' },
            next: 'aggressive_after_feedback'
        },
        aggressive_after_feedback: {
            id: 'aggressive_after_feedback',
            type: 'reflection',
            dynamicEndBranch: true
        },
        // Assertive Branch
        assertive_john_response: {
            id: 'assertive_john_response',
            type: 'video',
            video: '/assets/videos/placeholders/01.JohnsAssertiveAnwer.mp4',
            next: 'assertive_reflection_after_john'
        },
        assertive_reflection_after_john: {
            id: 'assertive_reflection_after_john',
            type: 'reflection',
            prompt: "You have chosen the <span class='style-tag'>Assertive</span> Communication Style. Let’s see how Anna reacts!\nPay attention to the body language as well.",
            button: 'Continue',
            next: 'assertive_anna_reaction'
        },
        assertive_anna_reaction: {
            id: 'assertive_anna_reaction',
            type: 'video',
            video: '/assets/videos/placeholders/02.AnnaAssertiveReaction.mp4',
            next: 'assertive_reflection_after_anna'
        },
        assertive_reflection_after_anna: {
            id: 'assertive_reflection_after_anna',
            type: 'reflection',
            prompt: "Now, let’s pause for a moment to reflect on how that exchange unfolded.\nWhat does this tell us about John’s communication style?",
            button: 'Continue',
            next: 'assertive_feedback'
        },
        assertive_feedback: {
            id: 'assertive_feedback',
            type: 'video',
            video: '/assets/videos/placeholders/03.NarratorAssertiveFeedback.mp4',
            onComplete: { markExplored: 'assertive' },
            next: 'assertive_after_feedback'
        },
        assertive_after_feedback: {
            id: 'assertive_after_feedback',
            type: 'reflection',
            dynamicEndBranch: true
        },
        // AI Coach Activity (Post-Simulation)
        activity: {
            id: 'activity',
            type: 'aiCoach',
            scenarioId: 'S1',
            title: 'Practice Your Response',
            // Video shown to learner instead of text box
            videoSrc: '/assets/videos/placeholders/Scenario01.mp4',
            // Transcript for accessibility (plain text)
            transcriptText: "Anna (your manager) says: \"I wanted to talk about a few issues that have come up recently with our platform. Some things haven't been resolved as quickly as the team expected, and it's starting to affect how people work. I'd like to understand what's going on and how we can handle this better moving forward.\" You are Marcus, an IT professional. Respond assertively to Anna's concern.",
            // Optional: VTT captions file (future-proofing)
            // captionsSrc: 'assets/captions/coach_scenario.vtt',
            // situationText still sent to evaluator (unchanged contract)
            situationText: "Anna (your manager) says: \"I wanted to talk about a few issues that have come up recently. Some things haven't been resolved as quickly as the team expected, and it's starting to affect how people work. I'd like to understand what's going on and how we can handle this better moving forward.\" You are Marcus, an IT professional. Respond assertively to Anna's concern.",
            prompt: "Write Marcus's response:",
            next: 'activity_sofia',
            submitLabel: 'EVALUATE',
            continueLabel: 'CONTINUE'
        },

        // AI Coach Activity - Exercise 2 (Maria → Anna)
        // Maria is overwhelmed, learner plays Anna responding
        activity_sofia: {
            id: 'activity_sofia',
            type: 'aiCoach',
            scenarioId: 'S2',
            title: 'Practice Your Response',
            videoSrc: '/assets/videos/placeholders/Scenario02.mp4',
            transcriptText: `Maria (Project Coordinator) says:
"Anna, I need to be honest — I'm struggling to keep things under control right now.
I'm covering several moving parts, and when updates or dependencies come in late, everything backs up on my side.
At the moment, I'm spending a lot of time chasing information instead of coordinating work, and it's becoming unsustainable.
I need us to be more aligned, because I can't keep absorbing this level of uncertainty."

You are Anna. Respond assertively to Maria.`,
            situationText: `Maria (Project Coordinator) says: "Anna, I need to be honest — I'm struggling to keep things under control right now. I'm covering several moving parts, and when updates or dependencies come in late, everything backs up on my side. At the moment, I'm spending a lot of time chasing information instead of coordinating work, and it's becoming unsustainable. I need us to be more aligned, because I can't keep absorbing this level of uncertainty." You are Anna. Respond assertively to Maria. Acknowledge the pressure she's under, clarify responsibility, and realign expectations without taking on work that isn't yours.`,
            prompt: "Respond assertively to Maria. Acknowledge the pressure she's under, clarify responsibility, and realign expectations without taking on work that isn't yours.",
            suggestedAnswer: `I hear how much pressure you're under, Maria, and I understand why this feels unsustainable. You're right — when updates come in late, it creates knock-on effects, and that's something I need to be more consistent about. What I can commit to is clearer dependency updates and earlier risk signals, so you're not left chasing information. At the same time, I want to be clear about what I can realistically take ownership of, so we don't create more overload for either of us. Let's agree on a simple update rhythm that works for both sides.`,
            next: 'activity_daniel',
            submitLabel: 'EVALUATE',
            continueLabel: 'CONTINUE'
        },

        // AI Coach Activity - Exercise 3 (Daniel → Anna)
        // Final scenario - Daniel is direct about a process issue, learner plays Anna
        // Threshold: 90%, NO suggested answer shown
        activity_daniel: {
            id: 'activity_daniel',
            type: 'aiCoach',
            scenarioId: 'S3',
            title: 'Practice Your Response',
            videoSrc: '/assets/videos/placeholders/Scenario03.mp4',
            transcriptText: `Daniel (Customer Support Lead) says:
"Anna, I need to be direct.
We delayed a customer response by four hours last Friday because of the new approval process.
That delay triggered a formal complaint, and my team is taking the heat.
I understand why the process exists, but right now it's hurting our responsiveness.
This needs to change."

You are Anna. Respond to Daniel.`,
            situationText: `Daniel (Customer Support Lead) says: "Anna, I need to be direct. We delayed a customer response by four hours last Friday because of the new approval process. That delay triggered a formal complaint, and my team is taking the heat. I understand why the process exists, but right now it's hurting our responsiveness. This needs to change." You are Anna. Respond to Daniel. Address the incident, balance responsiveness and risk, and align next steps.`,
            prompt: "Respond to Daniel. Address the incident, balance responsiveness and risk, and align next steps.",
            next: 'end',
            submitLabel: 'EVALUATE',
            continueLabel: 'CONTINUE'
        },

        // End
        end: {
            id: 'end',
            type: 'end',
            text: 'Simulation complete.',
            button: 'Restart'
        }
    }
};

export { SCENARIO };
