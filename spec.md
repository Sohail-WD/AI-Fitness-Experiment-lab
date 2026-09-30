# AI Fitness Experiment Lab

## Adaptive Computer-Vision Fitness Coach

---

# 1. Product & Technical Decisions

These decisions are fixed for the MVP unless explicitly changed later.

| Decision            | Choice                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Platform            | Web application / installable PWA                                                                         |
| Frontend            | React + TypeScript + Vite                                                                                 |
| Computer Vision     | MediaPipe Pose Landmarker                                                                                 |
| Backend             | Node.js + TypeScript                                                                                      |
| Database            | SQLite initially; PostgreSQL can be considered later                                                      |
| AI Provider         | Claude API                                                                                                |
| Camera Processing   | On-device in the browser                                                                                  |
| Camera Data Storage | Raw camera footage is never stored or uploaded                                                            |
| Target              | Student project → deployable product prototype                                                            |
| Initial Exercises   | Squat, lunge, bicep curl, shoulder press, push-up                                                         |
| AI Role             | Analysis, explanations, hypothesis generation, and adaptation suggestions                                 |
| Deterministic Logic | Rep counting, form rules, adherence, metrics, and other measurable values                                 |
| Experiment Data     | Real user data during normal use; simulated historical data for demonstrations                            |
| Health Restrictions | User-provided/professional-provided constraints; the system does not diagnose medical conditions          |
| CV Architecture     | Camera → Pose Detection → Smoothing → Joint Angles → Rep Detection → Form Rules → Feedback                |
| AI Architecture     | Structured Data → Deterministic Metrics → Claude Analysis → Structured Output → Validation → User Insight |

---

# 2. Product Overview

## 2.1 Product Name

**AI Fitness Experiment Lab**

## 2.2 Product Description

AI Fitness Experiment Lab is an adaptive fitness platform that combines personalized workout planning, computer vision, and AI-driven experimentation.

The system does not simply generate a workout and leave the user to follow it.

Instead, it follows a continuous loop:

**User Profile → Personalized Workout → Follow-Along Workout → Computer Vision Analysis → Performance Data → Experimentation → AI Analysis → Adapted Workout**

The system observes how the user actually performs and adheres to workouts, analyzes the resulting data, and uses those observations to personalize future workouts.

## 2.3 Core Product Principle

> The system does not just tell users what to do. It observes what happens, learns from the user's behavior and performance, and uses that information to continuously personalize the next step.

---

# 3. User Fitness Profile

Before generating workouts, the system collects information about the user.

## 3.1 Fitness Level

The user selects:

* Beginner
* Intermediate
* Advanced

## 3.2 Primary Goal

The user can select one or more goals:

* General fitness
* Strength
* Endurance
* Explosive strength
* Mobility
* Sport/performance
* Consistency/adherence

## 3.3 Training Context

The system supports different types of users, including:

* Beginners
* General fitness users
* Strength-focused users
* Athletes / sport-oriented users

The workout engine should adapt exercise selection and difficulty based on this context.

## 3.4 Available Equipment

The user specifies available equipment, for example:

* No equipment
* Dumbbells
* Resistance bands
* Barbell
* Bench
* Other equipment

The workout engine must not prescribe exercises requiring unavailable equipment.

## 3.5 Workout Environment

The user specifies:

* Available workout space
* Preferred workout location
* Any environmental limitations

## 3.6 Available Time

The user specifies their typical available workout duration.

Examples:

* 15 minutes
* 20 minutes
* 30 minutes
* 45 minutes
* 60 minutes

The workout engine should generate workouts that fit within the selected duration.

## 3.7 Preferred Schedule

The user can specify:

* Preferred workout days
* Preferred workout times
* Number of workouts per week

This information can later be used by the experimentation and adaptation systems.

---

# 4. Health Restrictions & Safety Constraints

The system may allow users to provide restrictions that have already been identified or recommended by a qualified healthcare professional.

Examples:

* Avoid high-impact movements
* Avoid jumping
* Avoid overhead loading
* Avoid floor exercises
* Avoid specific movement patterns

These restrictions are treated as **constraints**, not diagnoses.

## 4.1 Important Rules

The system must not:

* Diagnose medical conditions
* Infer medical conditions from movement or workout performance
* Determine whether a user is medically fit to exercise
* Prescribe medical treatment
* Override professional medical advice
* Claim that an exercise is medically safe for a particular condition

The system should instead use user-provided restrictions to filter exercises.

## 4.2 Restriction Representation

Where possible, restrictions should use predefined tags rather than allowing an AI model to interpret arbitrary medical text.

Example:

```text
avoid_high_impact
avoid_jumping
avoid_overhead_loading
avoid_floor_work
```

Free-text notes may be stored and displayed to the user, but should not automatically be interpreted as medical diagnoses or safety decisions.

---

# 5. Personalization Engine

The personalization engine combines the user's profile and constraints to determine appropriate workout requirements.

Inputs include:

* Fitness level
* Goal
* Training context
* Equipment
* Workout duration
* Available space
* Preferred schedule
* User-provided restrictions
* Previous workout performance
* Previous experiment results

The personalization engine produces structured workout requirements for the workout engine.

Example:

```text
Goal: Strength
Level: Intermediate
Equipment: Dumbbells
Duration: 30 minutes
Frequency: 4 days/week
Restrictions:
- avoid_high_impact
```

The system should prefer deterministic filtering and rules rather than relying on an LLM to make all decisions.

---

# 6. Workout Engine

The workout engine generates structured workouts from a predefined exercise library.

It should not depend entirely on unrestricted AI-generated exercise recommendations.

## 6.1 Exercise Library

Each exercise should contain structured information such as:

* Exercise name
* Movement category
* Target muscles
* Difficulty
* Required equipment
* Instructions
* Demonstration/reference
* Supported computer-vision analysis
* Required camera angle
* Rep-detection method
* Detectable form errors
* Corrective feedback
* Applicable goals
* Applicable fitness levels
* Restriction tags

## 6.2 Workout Structure

A workout may contain:

* Warm-up
* Main exercises
* Sets
* Repetitions
* Timed exercises
* Rest periods
* Cool-down

The MVP may simplify warm-up and cool-down functionality if necessary.

## 6.3 Workout Adaptation Inputs

The workout engine can later receive adjustments from the adaptation engine, including:

* Exercise selection
* Difficulty
* Sets
* Repetitions
* Duration
* Rest
* Exercise order
* Workout frequency
* Workout timing

---

# 7. Follow-Along Workout Interface

The user should be able to start a workout and follow it through an interactive interface.

The interface should display:

* Current exercise
* Exercise demonstration/reference
* Exercise instructions
* Current set
* Target repetitions or duration
* Rest timer
* Overall workout progress
* Camera status
* Rep count
* Valid/invalid movement feedback
* Form feedback

## 7.1 Controls

The user should be able to:

* Start
* Pause
* Resume
* Skip exercise
* Stop workout

## 7.2 Voice Feedback

Because users may not continuously look at the screen while exercising, the system should support spoken feedback using browser speech capabilities where appropriate.

Examples:

> "Keep your chest up."

> "Good rep."

> "Move slightly slower."

---

# 8. Computer Vision Movement System

Computer vision is responsible for observing measurable movement characteristics during workouts.

## 8.1 CV Pipeline

The primary pipeline is:

**Camera → Pose Detection → Smoothing → Joint Angles → Exercise State → Rep Detection → Form Rules → Feedback**

The CV system should run on-device in the browser where possible.

## 8.2 Pose Detection

The MVP will use:

**MediaPipe Pose Landmarker**

The system extracts body landmarks and uses them to calculate movement characteristics.

## 8.3 Camera Setup

Before starting an exercise, the system should check whether the user's camera setup is suitable.

The exercise definition should specify its required camera angle.

For example:

* Squat → side view
* Some alignment checks → front view

The system must not claim to measure something that cannot reliably be observed from the selected camera angle.

## 8.4 Rep Counting

Rep counting should use deterministic movement state machines rather than an LLM.

Example squat state machine:

```text
STANDING
    ↓
DESCENDING
    ↓
BOTTOM
    ↓
ASCENDING
    ↓
STANDING
    ↓
VALID REP
```

The exact joint-angle thresholds should be defined per exercise.

## 8.5 Confidence

The system should track pose-detection confidence.

If confidence becomes too low, the system should avoid presenting unreliable feedback.

Example:

> "I can't clearly see your full body. Please move farther from the camera."

---

# 9. Form Analysis

The system should detect predefined, measurable form issues.

Examples for a squat may include:

* Insufficient depth
* Excessively fast movement
* Unstable movement
* Incorrect body position where measurable from the available camera angle

The system should only check rules that can actually be supported by the camera angle and pose data.

## 9.1 Corrective Feedback

Feedback should be:

* Short
* Actionable
* Understandable
* Based on measurable movement

Examples:

> "Go slightly deeper."

> "Slow down the descent."

> "Keep your torso more upright."

The system must avoid pretending to provide professional medical or coaching certification.

---

# 10. Movement & Performance Metrics

The computer-vision system should produce structured performance data.

Examples:

```text
Detected reps: 12
Valid reps: 9
Invalid reps: 3
Average rep duration: 2.4 seconds
Pose confidence: 0.91
Detected form issues:
- insufficient_depth
- excessive_speed
```

These values are calculated by deterministic systems.

The AI should not invent or independently calculate these raw metrics.

---

# 11. Post-Workout Data Collection

After a workout, the system should collect user feedback.

The user can provide:

* Perceived effort: 1–10
* Enjoyment: 1–10
* Optional note
* Whether they would repeat the workout

The system combines this subjective information with objective workout metrics.

---

# 12. Experiment Engine

The Experiment Engine is the main learning component of the product.

It treats fitness improvement as an iterative experimentation process.

The system can create structured experiments around variables such as:

* Workout time
* Workout duration
* Workout structure
* Exercise selection
* Training frequency
* Rest duration
* Workout difficulty

## 12.1 Example Experiments

### Experiment A — Workout Timing

**Hypothesis:**

> The user may adhere better to morning workouts than evening workouts.

The system compares workout adherence across the defined periods.

### Experiment B — Workout Duration

**Hypothesis:**

> Shorter workouts may improve consistency for this user.

The system compares adherence and user feedback between shorter and longer sessions.

### Experiment C — Workout Structure

The system may compare two structured workout approaches.

---

# 13. Experiment Lifecycle

Every experiment follows a defined lifecycle:

**Hypothesis → Experiment Design → User Approval → Intervention → Data Collection → Analysis → Result → Adaptation**

## 13.1 User Approval

The system should not silently change the user's training plan because of an experiment.

The user should be able to:

* Accept
* Skip
* End

an experiment.

## 13.2 Experiment Duration

Experiments should have a defined duration or minimum number of observations.

The system should not claim a meaningful result when insufficient data has been collected.

## 13.3 Experiment Results

Results should be presented as observations about the individual user.

Example:

> "During this experiment, you completed 86% of your morning workouts compared with 63% of your evening workouts."

The system should not present this as universal scientific evidence.

Example of wording to avoid:

> "Morning workouts are scientifically better for you."

## 13.4 Demo Data

Because real experiments can take weeks, the application should support simulated historical data for demonstrations.

This allows the full experiment → analysis → adaptation loop to be demonstrated without pretending that simulated results are real user results.

---

# 14. Adherence Definition

For the MVP, adherence should be explicitly defined.

Example:

**Adherence = completed planned workouts / total planned workouts**

The system must use one consistent definition when calculating experiment results.

A workout should only count as completed according to a defined completion rule.

---

# 15. AI Analysis Engine

Claude is used for analysis and interpretation rather than raw metric calculation.

## 15.1 AI Responsibilities

The AI can:

* Analyze structured workout data
* Identify possible patterns
* Summarize experiment results
* Generate hypotheses
* Explain observed changes
* Suggest potential adaptations
* Generate understandable user-facing insights

## 15.2 AI Input

The AI receives structured data such as:

```text
Workout history
Experiment results
Adherence
User feedback
Movement metrics
Form observations
Current workout plan
User preferences
```

## 15.3 AI Output

The AI should produce structured output containing concepts such as:

```text
observations
possible_explanations
hypothesis
recommendation
confidence
```

The exact schema should be validated before being shown to the user.

## 15.4 AI Data Integrity

The AI must not invent:

* Rep counts
* Workout durations
* Adherence percentages
* Experiment results
* Form scores
* Other numerical measurements

All numerical values must originate from the application's stored data.

---

# 16. Adaptive Workout System

The adaptation engine uses workout and experiment data to propose changes to future workouts.

Possible adaptations include:

* Exercise selection
* Workout duration
* Difficulty
* Sets
* Repetitions
* Rest
* Exercise order
* Frequency
* Workout timing

## 16.1 Small Adaptations

Small changes may be applied automatically according to predefined rules.

Examples:

* Small repetition changes
* Small rest-time changes
* Small difficulty progressions

## 16.2 Significant Adaptations

Significant changes should require user approval.

Examples:

* Major workout-duration changes
* Major frequency changes
* Replacing major exercises
* Changing the user's training structure

The exact threshold for a "significant change" should be defined in the implementation.

---

# 17. End-to-End Example

A user creates a profile:

```text
Fitness level: Intermediate
Goal: Strength
Equipment: Dumbbells
Workout duration: 30 minutes
Frequency: 4 days/week
```

The system generates a personalized workout.

The user starts the workout.

The computer vision system detects:

```text
12 total squat reps
9 valid reps
3 invalid reps
```

It also detects repeated insufficient-depth issues.

After the workout, the user reports:

```text
Effort: 8/10
Enjoyment: 6/10
```

Over several workouts, the system records:

* Workout completion
* Rep performance
* Form observations
* Effort
* Enjoyment
* Workout duration

The experiment engine then proposes:

> "Let's compare your adherence between 20-minute and 30-minute workouts for the next two weeks."

The user accepts.

After sufficient data is collected, the system calculates the experiment results.

Claude receives the structured results and generates an explanation.

The adaptation engine then proposes a change to the user's future workout plan.

The user reviews and accepts the change.

The cycle repeats.

---

# 18. MVP Scope

The MVP should demonstrate the complete core loop rather than attempting to implement every possible fitness feature.

## 18.1 Initial Exercises

The MVP should target:

1. Squat
2. Lunge
3. Bicep curl
4. Shoulder press
5. Push-up

However, an exercise should only receive form analysis if the computer-vision implementation can reliably support the required measurements.

If an exercise cannot reliably support form analysis, it may initially support rep counting only.

## 18.2 MVP Features

The MVP should include:

* User profile
* Fitness goals
* Equipment selection
* Workout duration
* Restriction constraints
* Structured exercise library
* Personalized workout generation
* Follow-along workout interface
* Camera access
* Pose detection
* Rep counting
* Selected form checks
* Real-time feedback
* Post-workout feedback
* Workout history
* Performance metrics
* Experiment creation
* Experiment tracking
* Experiment analysis
* AI-generated insights
* Adaptive workout proposals
* User approval of significant adaptations

## 18.3 MVP Demonstration

The final demonstration should show:

**Profile → Workout → Camera Workout → Movement Analysis → Workout Data → Experiment → AI Analysis → Adaptation**

This complete loop is more important than having a large number of unrelated features.

---

# 19. Architecture Principles

## 19.1 Rule-Based Core, AI at the Edges

Use deterministic logic for measurable systems.

Examples:

* Rep counting
* Joint-angle calculations
* Form rules
* Adherence
* Workout metrics
* Experiment calculations

Use AI for:

* Interpretation
* Explanation
* Hypothesis generation
* Natural-language feedback
* Adaptation proposals

## 19.2 Exercises as Data

Exercise definitions should be represented as structured data rather than hard-coded separately throughout the application.

This makes it easier to add new exercises later.

## 19.3 On-Device Camera Processing

Camera processing should happen locally in the browser wherever possible.

The system should not upload or store raw workout video.

Only derived performance information should be stored.

## 19.4 Event-Based Data

Important workout events should be recorded.

Examples:

```text
workout_started
exercise_started
rep_detected
rep_validated
form_issue_detected
exercise_completed
workout_completed
experiment_started
experiment_completed
```

This creates a useful history for later analysis.

---

# 20. Proposed Technical Architecture

## Frontend

```text
React
TypeScript
Vite
MediaPipe Pose Landmarker
Browser Camera APIs
Browser Speech Synthesis
```

Main frontend areas:

```text
Profile UI
Workout Plan UI
Follow-Along Runner
Camera/CV System
Workout History
Experiments
Insights
```

## Computer Vision

```text
Camera
   ↓
Pose Model
   ↓
Smoothing
   ↓
Joint Angles
   ↓
Exercise State
   ↓
Rep Counter
   ↓
Form Rules
   ↓
Feedback
```

The CV pipeline may run inside a Web Worker to avoid blocking the main UI thread.

## Backend

```text
Node.js
TypeScript
Fastify
Zod
```

Responsibilities:

* User profile
* Workout requirements
* Workout data
* Session data
* Experiment data
* Metrics
* AI requests
* Adaptation proposals

## Database

MVP:

```text
SQLite
```

Potential future deployment:

```text
PostgreSQL
```

## AI

```text
Claude API
```

The API key must remain server-side and must never be exposed in the browser.

---

# 21. Important Data Contracts

The architecture should use structured contracts between components.

Important entities include:

```text
WorkoutRequirements
ExerciseDefinition
Workout
WorkoutSession
SessionEvent
PerformanceMetrics
Experiment
ExperimentResult
AnalysisReport
AdaptationProposal
UserProfile
UserConstraints
```

These contracts should be validated using schemas such as Zod.

---

# 22. Privacy

The application handles potentially sensitive information such as:

* Camera input
* Fitness information
* User-provided health restrictions
* Workout history

Therefore:

* Raw camera footage should not be stored.
* Raw camera footage should not be uploaded to the server.
* Camera processing should occur locally where possible.
* Only derived movement/performance metrics should be stored.
* API keys must remain server-side.
* User data should only be collected when required for the product.

---

# 23. Testing Requirements

The project should include tests for deterministic logic.

Examples:

### Rep Detection

Given a known sequence of joint angles:

```text
Standing → Descending → Bottom → Ascending → Standing
```

the system should produce exactly one completed rep.

### Form Detection

Given joint-angle data outside a defined threshold, the appropriate form issue should be detected.

### Adherence

Given:

```text
Planned workouts = 10
Completed workouts = 8
```

the system should calculate:

```text
Adherence = 80%
```

### Experiment Analysis

Given known experiment data, the system should calculate the expected comparison.

### AI Output

AI-generated structured output should be validated against the expected schema before being used by the application.

---

# 24. Computer Vision Testing

The project should not rely exclusively on manually testing the camera.

Recorded or labeled joint-position test data should be used where possible.

Testing should measure:

* Rep-count accuracy
* False rep detection
* Form-rule accuracy
* Pose confidence handling
* Performance under different camera positions

An initial engineering target may be:

> At least 90% of test sets should have rep counts within ±1 rep of the expected count.

This is a development target to be measured, not a guaranteed product claim.

---

# 25. Performance & Fallbacks

Computer vision can be computationally expensive on some devices.

The application should:

* Avoid unnecessarily processing every frame at maximum frequency.
* Use smoothing where appropriate.
* Consider Web Workers.
* Display camera-processing status.
* Handle low-confidence pose detection.
* Provide a usable fallback when camera access is unavailable.

Possible fallback:

The user can complete the workout without camera analysis while still recording the workout session.

---

# 26. Demonstration Strategy

The final demonstration should emphasize the product's complete feedback loop.

Recommended demonstration sequence:

### Step 1 — Create Profile

Show:

* Fitness level
* Goal
* Equipment
* Available time
* Restrictions

### Step 2 — Generate Workout

Show how the system creates a personalized workout.

### Step 3 — Start Follow-Along Workout

Show:

* Exercise instructions
* Timer/reps
* Camera
* Pose tracking

### Step 4 — Demonstrate Computer Vision

Perform several correct and incorrect repetitions.

Show:

* Rep counting
* Valid/invalid reps
* Form feedback
* Voice feedback

### Step 5 — Complete Workout

Show the recorded performance metrics and post-workout feedback.

### Step 6 — Run Experiment

Use real or clearly labeled simulated historical data.

### Step 7 — AI Analysis

Show Claude interpreting the structured experiment results.

### Step 8 — Adaptation

Show a proposed change to the next workout.

### Step 9 — User Approval

The user accepts or rejects the proposed adaptation.

This demonstrates the entire product loop.

---

# 27. Development Milestones

## M0 — Camera & Computer Vision Validation

Build only a minimal browser prototype:

```text
Camera
→ MediaPipe Pose
→ Landmark Overlay
→ Joint Angles
→ Basic Squat State Detection
→ Rep Counting
```

Do not build the complete product at this stage.

## M1 — Project Foundations

Set up:

* React
* TypeScript
* Vite
* Backend
* Database
* Shared types
* Validation

## M2 — Profile & Personalization

Implement:

* User profile
* Goals
* Equipment
* Duration
* Restrictions
* Workout requirements

## M3 — Workout & Follow-Along System

Implement:

* Exercise library
* Workout generation
* Workout runner
* Timers
* Progress
* Controls

## M4 — Computer Vision Rep Counting

Implement:

* Pose detection
* Smoothing
* Joint-angle calculations
* Exercise state machines
* Rep counting

## M5 — Form Analysis

Implement:

* Exercise-specific form rules
* Form issue detection
* Real-time feedback
* Voice feedback
* Camera setup checks

## M6 — Metrics & History

Implement:

* Session events
* Workout metrics
* Workout history
* Post-workout feedback

## M7 — Experiment Engine

Implement:

* Hypothesis
* Experiment design
* User approval
* Data collection
* Experiment completion
* Result calculation

## M8 — AI Analysis

Implement:

* Claude integration
* Structured AI input
* Structured output
* Validation
* User-facing insights

## M9 — Adaptive Workout System

Implement:

* Adaptation proposals
* Small deterministic adjustments
* Significant-change approval
* Updated workout plans

## M10 — Hardening & Deployment

Implement:

* Testing
* Error handling
* Performance improvements
* Privacy checks
* Fallbacks
* Production deployment

---

# 28. Non-Goals

The system is not intended to:

* Diagnose medical conditions
* Determine medical fitness to exercise
* Replace doctors, physiotherapists, or qualified fitness professionals
* Provide medical treatment
* Guarantee fitness results
* Claim scientific certainty from one-person experiments
* Independently make major medical or training decisions
* Store raw workout video
* Generate completely unrestricted workouts using an LLM
* Pretend that unreliable computer-vision measurements are accurate
* Automatically interpret arbitrary medical text as a diagnosis

---

# 29. Success Criteria

The MVP is successful if it can demonstrate the following complete loop:

```text
User Profile
      ↓
Personalized Workout
      ↓
Follow-Along Session
      ↓
Computer Vision
      ↓
Rep & Form Analysis
      ↓
Performance Data
      ↓
Experiment
      ↓
AI Analysis
      ↓
Adaptation Proposal
      ↓
User Approval
      ↓
Next Personalized Workout
```

The primary goal is not to build the largest fitness application.

The goal is to demonstrate a technically credible system that can:

1. Understand the user.
2. Generate a structured workout.
3. Observe the user's actual movement.
4. Measure performance.
5. Collect behavioral data.
6. Run controlled personal experiments.
7. Use AI to interpret the results.
8. Adapt future workouts based on those observations.
9. Keep the user in control of significant changes.
10. Operate as a deployable web application.
