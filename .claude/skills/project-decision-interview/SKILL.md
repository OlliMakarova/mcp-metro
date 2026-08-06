---
name: project-decision-interview
description: Runs an interactive investigation of an existing project, uncovers unanswered product and technical decisions, records the answers, and asks strictly one question at a time. Use when the user asks to analyze the whole project, to close open questions one by one, to clarify a proposal or a plan before implementation, or to keep working in a question-by-question mode.
---

# Interactive project decision interview

## Goal

Bring the task to a consistent and implementable target state. Do not stop at conversation: persist decisions, update
the affected documents, and once the questions are over, carry out the implementation if it is part of the request.

## Order of work

1. Read the project rules, the state of the working copy, and the documents the user pointed to.
2. Investigate the requirements, documentation, code, settings, data structures, checks, and change history that relate
   to the task. If the user named specific commits, study them and the resulting state of the code without fail.
3. Compare the current design with the user's goal. Separate the facts that can be established from the project itself
   from the decisions that genuinely require the user's choice.
4. Look for an existing working document with a plan or a decision register. If there is none and the user asked for
   decisions to be recorded, create a suitable document following the project rules.
5. Build an internal list of the forks in the road, ordered by decreasing impact. Start with decisions that change the
   purpose of the system, the data model, permissions, data safety, or the user scenario.
6. Ask one question, get the answer, immediately record the decision that was made, and only then move on to the
   next question.
7. After the last answer, check that the target model is complete, carry out the implementation the request calls for,
   and confirm the result with checks.

## How to ask questions

- Ask exactly one question per message.
- Ask a multiple-choice question with the `AskUserQuestion` tool: two to four options, the recommended one first and
  marked "(Recommended)" in its label, each option carrying a description of its observable consequences. The free-form
  "Other" option is added by the tool itself. If the question does not reduce to a choice among options, ask it as
  plain text.
- Before each question, briefly state which previous decision has been recorded and what it leads to.
- Explain an unclear term with a concrete example before repeating the question.
- Offer the recommended option and describe its observable behavior clearly.
- Where possible, phrase the question so that it can be answered with "yes" or "no".
- Do not ask a question whose answer can be reliably obtained from the code, the history, the settings, or the
  documentation.
- Do not push minor technical decisions onto the user. Make them yourself, following the project rules.
- If the user has not chosen an option, do not record it as accepted.
- If the user corrected a decision, replace the previous target state and delete the wording that contradicts it.
- If the user added a new thought, record its consequences and continue with the single most important fork in the road.

## What to investigate

Check only the areas that relate to the task, but do not skip the connections that matter:

- the purpose of the result, its users, and the observable scenario;
- overlap with existing sources, features, and metrics;
- the set of entities, their identity, validity periods, and history;
- the origin, cleaning, storage, deletion, and permitted recipients of the data;
- access roles, the scope of authority, logging, and error correction;
- algorithms, formulas, coefficients, thresholds, reference books, and settings;
- handling of uncertainty, retries, failures, delays, and incomplete data;
- the user interface, background jobs, and notification methods;
- performance, cost, verifiability, and operational control;
- changes to the data structure, migrations, checks, and permanent documentation.

## Keeping track of decisions

- Give decisions stable identifiers if the document already uses such a register.
- After each answer, write down the rule in its target state, not the history of the transition.
- Keep the substantive rule and its consequences for the interface, the data, and the algorithm next to each other.
- Do not mix an accepted decision, an established fact, and an open question.
- Mark plan items as done only after the actual implementation and verification.
- If the working document is temporary, move every unique decision into permanent documentation before the task ends
  and make sure the temporary file is not left as the only source of information.

## Completeness of the working model

If the user expects a working model, ask for every number, formula, weight, threshold, rule, judgment call, reference
book, and piece of data that is needed. The absence of a ready expert value does not justify an empty field, a stub, a
dead branch, or handing the choice back to the user. Follow the stricter rules of the specific project.

A configurable value must have a concrete effective value and must take part in the computation. Do not add markers,
states, or warnings that present working values or results as preliminary or trial.

## Finishing

Before finishing:

1. Review every open item of the working document and separate work that is not done yet from forks that are unresolved.
2. Remove contradictions, empty rules, and values that were never set.
3. Move decisions out of temporary files into permanent documents.
4. Carry out the implementation, the checks, and the documentation update, if the user asked for them.
5. Report the result, the changed files, the checks that were run, and only genuine external obstacles.
