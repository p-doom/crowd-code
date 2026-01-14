<!-- markdownlint-disable first-line-h1 -->
<!-- markdownlint-disable html -->
<!-- markdownlint-disable no-duplicate-header -->

<div align="center">
  <img src="https://github.com/p-doom/crowd-code/blob/main/img/pdoom-logo.png?raw=true" width="60%" alt="p(doom)" />
</div>
<hr>
<div align="center" style="line-height: 1;">
  <a href="https://www.pdoom.org/"><img alt="Homepage"
    src="https://img.shields.io/badge/Homepage-p%28doom%29-white?logo=home&logoColor=black"/></a>
  <a href="https://huggingface.co/p-doom"><img alt="Hugging Face"
    src="https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-p--doom-ffc107?color=ffc107&logoColor=white"/></a>
  <br>
  <a href="https://discord.gg/G4JNuPX2VR"><img alt="Discord"
    src="https://img.shields.io/badge/Discord-p%28doom%29-7289da?logo=discord&logoColor=white&color=7289da"/></a>
  <a href="https://github.com/p-doom"><img alt="GitHub"
    src="https://img.shields.io/badge/GitHub-p--doom-24292e?logo=github&logoColor=white"/></a>
  <a href="https://twitter.com/prob_doom"><img alt="Twitter Follow"
    src="https://img.shields.io/badge/Twitter-prob__doom-white?logo=x&logoColor=white"/></a>
  <br>
  <a href="LICENSE" style="margin: 2px;">
    <img alt="License" src="https://img.shields.io/badge/License-Apache 2.0-f5de53?&color=f5de53" style="display: inline-block; vertical-align: middle;"/>
  </a>
  <br>
</div>

# `crowd-code`: Crowd-Sourcing Months-Long Software Engineering Trajectories

We introduce crowd-code 2.0, a complete redesign of crowd-code: a VS Code / Cursor extension for crowd-sourcing software engineering traces as action–observation rollouts. Install once, and forget about it.

> **_NOTE_**: This repository contains code for crowd-code 2.0. \
You can find the legacy codebase at https://github.com/p-doom/crowd-code-legacy

## Motivation

Models can win IMO gold medals yet struggle at tasks that would provide obvious economic value. This is not a capability problem, it is a data problem. Models do what they are trained to do.

Millions of people work every day. If we can record them and train on dense, long-horizon trajectories of the human workforce, we can unlock the next set of model capabilities (expanded task horizons, exploration, continual learning) through prolonged behaviour cloning. Humans do not write code by executing a fixed plan. They explore, revise, undo, test, change direction, and learn. We need data on the process of software engineering, not just the final code.

Architectural bottlenecks (state that grows with sequence length, long-horizon credit assignment) matter, but current frontier AI research is still in a regime that is severely data-bottlenecked.

## A Simplified Setting for Behaviour Cloning from Screencasts

Behaviour cloning from unlabeled videos means attaining policies given observation streams without action labels or rewards. [AGI-CAST](https://pdoom.org/agi_cast.html) captures raw screen recordings of AGI research, but training on videos is compute-expensive, and large-scale, open datasets of workforce screencasts beyond AGI-CAST that are suitable for training are non-existent.

**crowd-code 2.0 is a simplified setting to study behaviour cloning from screencasts**, where:

- **observations** correspond to what a human could see (editor and terminal viewports),
- **actions** correspond to edits, cursor movement, navigation, terminal interaction

The result is a sequence of action–observation rollouts, directly analogous to video-based imitation learning, but purely text-based. We subsample continuously changing viewports (scrolling, streaming terminal output) at 10 Hz matching the temporal granularity of video. This means we capture the state of interactive CLI tools like Claude Code, Codex CLI, `vim` and `less` in real-time.

## Why crowd-code 2.0?

**crowd-code 1.0 recorded events. crowd-code 2.0 combines state-based observations and event-based actions.**

The original crowd-code was not designed for the agent-heavy software engineering workflows that are now standard, and its data capturing logic is not reminiscent of the setting of behaviour cloning from videos. 

### Problems with crowd-code 1.0

| Issue | Consequence |
|-------|-------------|
| **Agent edits bypassed VS Code APIs** | Cursor's agent writes directly to the filesystem, not through VS Code's edit API. These edits were never captured and corrupted the file cache. |
| **Agent edits were only partially recorded** | When captured at all, agent edits were only recorded inside the active file and were not labeled as agent-generated. |
| **`git stash` / `git pull` corrupted the cache** | External filesystem changes were not recorded, causing the implicit file state to go out of sync, silently corrupting the dataset. |
| **`git checkout` required manual handling** | We explicitly handled checkouts via a full cache reset: a workaround, but not a solution. |
| **No workspace-wide visibility** | Changes outside the active editor were invisible to the recording. |

### What crowd-code 2.0 changes

crowd-code 2.0 moves beyond purely event-based recordings towards capturing **states** (observations) and **events** (actions), with states designed to be as close to human observations as possible.

**First-class actor differentiation.** We now capture edits workspace-wide and differentiate between:
- **User actions/edits**: keystrokes, navigation, commands
- **Agent edits**: changes made by Cursor, Copilot, or other IDE agents
- **External changes**: git operations, CLI tools, filesystem watchers

**Direct CLI agent capture.** We directly capture CLI agents like Claude Code and Codex. Their terminal output (including prompts and responses) is recorded as part of the terminal viewport stream.

**User edit correlation.** Attributing user edits to filesystem changes is non-trivial. Our solution: buffer user edits, correlate them with filesystem changes on save, and attribute uncorrelated changes to agents. We tested our implementation for edge-cases: if a save is triggered by an agent edit while user changes are pending, the agent edit is still correctly attributed.

## Workspace Snapshots

To reconstruct what context an agent had access to when making an edit, we capture a **compressed snapshot of the workspace immediately before each agent edit**.

This has an additional benefit: we can **replay the rollout with a different model** for on-policy data generation.

Output JSONs and workspace snapshots are compressed into a single `.tar.gz` before upload.

## From Capture to Training

crowd-code 2.0 **decouples the capture format from the training format**. The raw capture format is a sequence of timestamped actions and observations. Post-processing can transform this into:

- **Goal-conditioned trajectories** for behaviour cloning
- **Prompt/agent-response pairs** for constructing rewards from implicit human feedback
- **Teacher-forced next-action prediction sequences** for tab completion (without invalidation of the KV cache)

### Constructing synthetic rewards from implicit user feedback

Because agent edits are now explicit, we can **post-hoc reconstruct the prompt that led to each edit** using LLMs. For CLI agents like Claude Code, we often have direct access to the prompt via the terminal recording. Even when we don't, reconstruction is feasible from context.

From there, we can construct synthetic reward signals from implicit user feedback: training models on what humans accept, reject, and revise. With crowd-code 2.0, we hope to also enable the community to work on **methods and algorithms for product-feedback loops**.

### Replay and visualization

The [crowd-pilot-serializer](https://github.com/p-doom/crowd-pilot-serializer) includes a replayer for visualizing recordings.

<!-- TODO: Add GIF of replayer showing cursor movement, file switches, edits, CLI agent use & agent edits -->

## Limitations

**Capture-time attribution:**
- User actions that span beyond the current viewport (rename, search-and-replace) are partially misattributed as agent actions. *Easily fixable during post-processing.*
- Agent actions inside the viewport are partially misattributed as user actions. *Easily fixable during post-processing.*
- File creations/deletions cannot be attributed to user/agent at capture time. *Usually obvious during post-processing.*

**Undo/redo:**
- VS Code-native undo/redo is captured with full semantics.
- Undo via VIM extension is captured as a regular edit (no undo metadata).

**Memory:**
- We maintain an in-memory cache of the entire workspace (required to compute agent diffs and reconstruct rollouts). This is the minimal necessary state.

**Terminal:**
- We cannot capture terminal scrolling actions, only viewport state.

## Looking Forward

We believe that many capabilities are yet to be unlocked in current-generation architectures by behaviour-cloning them: Expanding the task horizon of models, working on single problems for hours and days at a time, imitating human exploration priors, learning on-the-go, knowing where to look (how to search by efficiently jumping around repositories, how to recall information out-of-working-memory; what we call **attention in environment-space**). Architectural bottlenecks only become imminent by constructing potential paths towards AGI. Architecture research prerequisites first exhausting the data regime.

Our long-term goal is not merely to train on crowd-code data.

We want to use it:
- **to train inverse dynamics models**, inferring actions from unlabeled observation sequences,
- **as a testbed for behaviour-cloning from videos** to gather insights transferable to the setting of AGI-CAST and beyond,
- **to bootstrap agents** that can [acquire the data they need when they encounter unfamiliar regimes](https://pdoom.org/thesis.html).

AGI will require systems that can expand their training distribution by knowing where to look.
We believe software engineering is one of the best environments to study these problems.

**We are greater than the sum of ours parts. <u>Together</u>.**