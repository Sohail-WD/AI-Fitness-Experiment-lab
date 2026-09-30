# CLAUDE.md

## Project

AI Fitness Experiment Lab

This is an adaptive fitness web application combining:

- Personalized workout generation
- Follow-along workouts
- Computer vision
- Exercise form analysis
- Rep counting
- Fitness experimentation
- AI analysis
- Adaptive workout recommendations

## Development Principles

1. Read `spec.md` before making implementation decisions.

2. Do not implement the entire application at once.

3. Work milestone-by-milestone.

4. Before beginning a milestone, explain:
   - What will be built
   - Which files will change
   - Important technical decisions
   - How it will be tested

5. Do not introduce unnecessary dependencies.

6. Prefer simple, testable, deterministic logic over unnecessary AI.

7. The LLM should not calculate fitness metrics.
   Metrics must be calculated by application code.

8. Computer vision should only report measurements that the
   implemented pose model and camera angle can reasonably support.

9. Never invent medical recommendations.

10. User-provided health restrictions must be treated as constraints,
    not interpreted as medical diagnoses.

11. Keep camera processing on-device whenever possible.

12. Do not upload or store raw camera footage.

13. Every major feature should have a fallback when possible.

14. Keep the application deployable.

15. Do not add features that are not in `spec.md` unless explicitly
    approved.

## Development Workflow

For each milestone:

1. Read the relevant requirements in `spec.md`.
2. Explain the implementation plan.
3. Implement the smallest working version.
4. Test it.
5. Fix issues.
6. Explain what was implemented.
7. Wait for approval before moving to the next major milestone.

## Code Quality

Use:

- TypeScript
- Clear component boundaries
- Reusable functions
- Strong typing
- Environment variables for secrets
- Validation for API inputs
- Meaningful names
- Minimal duplication

Do not hide complex logic inside huge React components.

## AI Architecture

The system should follow:

Structured Data
→ Deterministic Metrics
→ AI Analysis
→ Structured AI Output
→ Validation
→ User-facing Insight

Do not use the LLM where deterministic code is more appropriate.

## Computer Vision Architecture

The intended pipeline is:

Camera
→ Pose Detection
→ Landmark Smoothing
→ Joint Angles
→ Exercise State
→ Rep Detection
→ Form Rules
→ Feedback

Exercise-specific rules should be data-driven wherever practical.
