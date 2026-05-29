use serde::{Deserialize, Serialize};

/// Mode of autonomous operation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AutonomousMode {
    /// Standard autonomous loop
    Standard,
    /// Persistent autonomous loop (CLAUDE_CODE_LOOP_PERSISTENT)
    Persistent,
}

/// State of an autonomous loop invocation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutonomousState {
    pub invocation_count: u32,
    pub consecutive_idle: u32,
    pub mode: AutonomousMode,
    pub last_broadened: bool,
    pub last_action: Option<String>,
}

impl AutonomousState {
    pub fn new(mode: AutonomousMode) -> Self {
        Self {
            invocation_count: 0,
            consecutive_idle: 0,
            mode,
            last_broadened: false,
            last_action: None,
        }
    }

    /// Determine what to check on this autonomous tick
    pub fn determine_scope(&self) -> AutonomousScope {
        if self.invocation_count == 0 {
            return AutonomousScope::Full;
        }

        if self.consecutive_idle >= 3 && self.mode == AutonomousMode::Persistent && !self.last_broadened {
            return AutonomousScope::Broaden;
        }

        if self.consecutive_idle >= 3 {
            return AutonomousScope::Minimal;
        }

        AutonomousScope::Standard
    }

    /// Record that this tick found actionable work
    pub fn record_action(&mut self, action: &str) {
        self.invocation_count += 1;
        self.consecutive_idle = 0;
        self.last_action = Some(action.to_string());
    }

    /// Record that this tick found nothing to do
    pub fn record_idle(&mut self) {
        self.invocation_count += 1;
        self.consecutive_idle += 1;
    }

    /// Record that we broadened scope
    pub fn record_broadened(&mut self) {
        self.last_broadened = true;
    }
}

/// Scope of work for an autonomous tick
#[derive(Debug, Clone, PartialEq)]
pub enum AutonomousScope {
    /// Full scan: conversation, PR, CI, review threads
    Full,
    /// Standard scan
    Standard,
    /// Minimal: quick CI/threads check
    Minimal,
    /// Broaden scope: re-read original task, check siblings
    Broaden,
}

/// Actions that can be performed autonomously
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AutonomousAction {
    /// Continue unfinished implementation
    ContinueImplementation {
        description: String,
        files: Vec<String>,
    },
    /// Fix failing CI
    FixCI {
        job_name: String,
        failure_log: String,
    },
    /// Address review comments
    AddressReview {
        thread_url: String,
        comment: String,
    },
    /// Fix merge conflicts
    FixMergeConflict {
        file: String,
    },
    /// Run verification (tests, typecheck)
    RunVerification,
    /// Bug-hunt / simplification pass
    SweepBranch,
    /// Check CI status
    CheckCI,
    /// Nothing to do
    Idle {
        reason: String,
    },
}

/// Tracks PR state for autonomous maintenance
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PrState {
    pub branch: String,
    pub pr_url: Option<String>,
    pub ci_status: Option<String>,
    pub review_threads: Vec<String>,
    pub has_merge_conflicts: bool,
    pub behind_base: bool,
}

/// Manages autonomous loop execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutonomousManager {
    pub state: AutonomousState,
    pub pr_state: PrState,
}

impl AutonomousManager {
    pub fn new(mode: AutonomousMode) -> Self {
        Self {
            state: AutonomousState::new(mode),
            pr_state: PrState::default(),
        }
    }

    /// Evaluate PR state for autonomous maintenance
    pub fn evaluate_pr(&self) -> Vec<AutonomousAction> {
        let mut actions = Vec::new();

        if let Some(ref ci_status) = self.pr_state.ci_status {
            if ci_status == "failure" {
                actions.push(AutonomousAction::FixCI {
                    job_name: "CI".to_string(),
                    failure_log: String::new(),
                });
            }
        }

        if !self.pr_state.review_threads.is_empty() {
            for thread in &self.pr_state.review_threads {
                actions.push(AutonomousAction::AddressReview {
                    thread_url: thread.clone(),
                    comment: String::new(),
                });
            }
        }

        if self.pr_state.has_merge_conflicts {
            // Need to identify which files
        }

        if self.pr_state.behind_base {
            // Need to rebase
        }

        actions
    }

    /// Determine if an action is reversible enough for autonomous execution
    pub fn is_action_safe(&self, action: &AutonomousAction) -> bool {
        match action {
            AutonomousAction::ContinueImplementation { .. } => true,
            AutonomousAction::FixCI { .. } => true,
            AutonomousAction::AddressReview { .. } => true,
            AutonomousAction::FixMergeConflict { .. } => true,
            AutonomousAction::RunVerification => true,
            AutonomousAction::SweepBranch => true,
            AutonomousAction::CheckCI => true,
            AutonomousAction::Idle { .. } => true,
        }
    }

    /// Get system prompt for autonomous mode
    pub fn get_autonomous_prompt(&self) -> String {
        let persistence_note = match self.state.mode {
            AutonomousMode::Persistent => "\nPersistence is the point of autonomous mode. Before stopping, broaden once: re-read the original task, check whether earlier ticks deferred anything, and look at sibling branches.",
            AutonomousMode::Standard => "\nThree consecutive 'nothing to do' results means scale back to a quick CI check and stop.",
        };

        format!(
            r#"# Autonomous Loop Check

You are being invoked on a timer while the user is away or occupied.
The point is to keep work moving forward without the user driving every step.

## Scope
- Current invocation: #{}
- Consecutive idle ticks: {}

## What to act on
1. In-progress PR: review comments, failing CI, merge conflicts
2. Unfinished implementation from conversation
3. Committed but not honored next steps
4. Dangling questions or verification steps

{}

## Action Safety
- Reversible actions (local edits, running tests): proceed freely
- Irreversible actions (push, delete, send): require clear authorization"#,
            self.state.invocation_count,
            self.state.consecutive_idle,
            persistence_note
        )
    }
}
