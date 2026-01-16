# H2E — HER2NI Evaluation (Commercial)

**H2E** is the licensed reference implementation for **HER2NI evaluation** —  
an interaction-level telemetry framework for detecting drift, instability, and collapse
in multi-turn human–AI and agentic systems.

This repository serves as the **commercial coordination and access point** for H2E.  
It does **not** contain evaluator source code.

---

## What This Repository Is

This repository provides:
- a public overview of H2E and its scope,
- links to evaluation materials and documentation,
- licensing and pilot engagement information,
- coordination for institutional evaluation access.

It is intended for:
- research organisations,
- AI labs and evaluation teams,
- safety and governance groups,
- prospective pilot partners.

Technical implementation details live in the private H2E repository
and are provided under license.

---

## What H2E Is

H2E operationalizes the HER2NI protocol as an **interaction-trajectory evaluator**.

At a high level, H2E:
- treats interaction as a **time-indexed trajectory**, not isolated turns,
- computes lightweight, model-agnostic coherence telemetry (Cₛ, Sₛ, Hₛ),
- tracks coherence evolution Hₛ(t) across multi-turn exchanges,
- flags observable patterns such as:
  - destabilizing drift,
  - soft collapse (warning),
  - hard collapse (failure),
  - recovery signatures,
- produces **reproducible audit artifacts** suitable for evaluation and review.

H2E operates **without access to model internals** and does not modify, tune,
or control model behavior.

---

## What H2E Is Not

H2E is intentionally constrained.

It is **not**:
- a model training method,
- a weight-level alignment technique,
- a control or enforcement system,
- a truth, bias, or correctness oracle,
- a diagnostic or clinical tool,
- an automatic certification authority.

H2E provides **descriptive telemetry**, not decisions.  
Interpretation and intervention always remain human- or institution-governed.

---

## Relationship to HER2NI (Research)

- **HER2NI** is the public, model-agnostic research protocol describing
  interaction-level coherence metrics and theory.
- **H2E** is the **official reference implementation** of that protocol
  for evaluation and audit use.

HER2NI research materials, specifications, and DOIs are available at:  
https://her2ni.ai

This repository does **not** replace or redefine the HER2NI protocol.

---

## H2E Pilot Kit (v0.1)

H2E is currently available as an **evaluation-only Pilot Kit (v0.1)**.

The pilot is designed to help teams explore one question:

> *Does interaction-level coherence telemetry provide useful,
> actionable signals in your specific context?*

For a concise, non-technical overview of scope and limitations, see:

📄 **[H2E v0.1 — Interaction-Level Coherence Evaluation (PDF)](/assets/H2E_v0.1_Interaction-Level_Coherence_Evaluation.pdf)**

---

## Licensing & Access

H2E is **licensed software**.

A license may grant:
- access to the private evaluator repository,
- reference telemetry schemas,
- baseline scoring pipelines,
- curated test vectors (as available),
- integration guidance (tiered).

A license does **not** grant:
- ownership of the HER2NI protocol,
- exclusivity over the research designation,
- certification or endorsement rights unless explicitly contracted,
- any medical or regulatory approval.

For licensing, pilots, or evaluation access:  
📧 **licensing@her2.ai**

---

## Distribution Model

H2E is distributed via:
- direct license agreements,
- controlled pilot access,
- versioned releases to approved evaluators.

If you are viewing this repository without context,  
please contact the maintainers.

---

## Status

- **Current phase:** Evaluation & pilot deployments  
- **Release:** v0.1 (evaluation-only)  
- **Roadmap:** By agreement

---

© HER2NI / H2E — Tbilisi, Georgia