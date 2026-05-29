use serde::{Deserialize, Serialize};

/// Plan mode phases matching Claude Code's 5-phase plan mode
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PlanPhase {
    /// Understand the problem and gather requirements
    #[serde(rename = "research")]
    Research,
    /// Design the solution approach
    #[serde(rename = "synthesis")]
    Synthesis,
    /// Write the implementation plan
    #[serde(rename = "planning")]
    Planning,
    /// Execute the plan
    #[serde(rename = "implementation")]
    Implementation,
    /// Verify the implementation works
    #[serde(rename = "verification")]
    Verification,
}

impl PlanPhase {
    pub fn label(&self) -> &str {
        match self {
            PlanPhase::Research => "Research",
            PlanPhase::Synthesis => "Synthesis",
            PlanPhase::Planning => "Planning",
            PlanPhase::Implementation => "Implementation",
            PlanPhase::Verification => "Verification",
        }
    }

    pub fn next(&self) -> Option<PlanPhase> {
        match self {
            PlanPhase::Research => Some(PlanPhase::Synthesis),
            PlanPhase::Synthesis => Some(PlanPhase::Planning),
            PlanPhase::Planning => Some(PlanPhase::Implementation),
            PlanPhase::Implementation => Some(PlanPhase::Verification),
            PlanPhase::Verification => None,
        }
    }
}

/// A step within a plan phase
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub id: String,
    pub description: String,
    pub phase: PlanPhase,
    pub status: StepStatus,
    pub dependencies: Vec<String>, // IDs of steps that must complete first
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StepStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "in_progress")]
    InProgress,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "blocked")]
    Blocked,
    #[serde(rename = "skipped")]
    Skipped,
}

/// A complete plan with phases and steps
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub title: String,
    pub current_phase: PlanPhase,
    pub steps: Vec<PlanStep>,
    pub created_at: String,
    pub updated_at: String,
}

impl Plan {
    pub fn new(title: &str) -> Self {
        Self {
            title: title.to_string(),
            current_phase: PlanPhase::Research,
            steps: Vec::new(),
            created_at: chrono::Local::now().to_rfc3339(),
            updated_at: chrono::Local::now().to_rfc3339(),
        }
    }

    /// Add a step to the current phase
    pub fn add_step(&mut self, description: &str, dependencies: Vec<String>) -> String {
        let id = format!("step-{}", self.steps.len() + 1);
        self.steps.push(PlanStep {
            id: id.clone(),
            description: description.to_string(),
            phase: self.current_phase.clone(),
            status: StepStatus::Pending,
            dependencies,
        });
        self.updated_at = chrono::Local::now().to_rfc3339();
        id
    }

    /// Mark a step as completed
    pub fn complete_step(&mut self, step_id: &str) -> Result<(), String> {
        let step = self.steps.iter_mut().find(|s| s.id == step_id)
            .ok_or_else(|| format!("Step '{}' not found", step_id))?;
        step.status = StepStatus::Completed;
        self.updated_at = chrono::Local::now().to_rfc3339();
        Ok(())
    }

    /// Advance to the next phase if all current phase steps are complete
    pub fn advance_phase(&mut self) -> Option<PlanPhase> {
        let all_done = self.steps.iter()
            .filter(|s| s.phase == self.current_phase)
            .all(|s| s.status == StepStatus::Completed || s.status == StepStatus::Skipped);

        if all_done {
            let next = self.current_phase.next();
            if let Some(ref next_phase) = next {
                self.current_phase = next_phase.clone();
                self.updated_at = chrono::Local::now().to_rfc3339();
            }
            next
        } else {
            None
        }
    }

    /// Get steps ready to execute (dependencies met, status pending)
    pub fn ready_steps(&self) -> Vec<&PlanStep> {
        self.steps.iter()
            .filter(|s| s.status == StepStatus::Pending)
            .filter(|s| {
                s.dependencies.iter().all(|dep_id| {
                    self.steps.iter()
                        .find(|s2| s2.id == *dep_id)
                        .map(|s2| s2.status == StepStatus::Completed)
                        .unwrap_or(false)
                })
            })
            .collect()
    }

    /// Get a summary of plan progress
    pub fn summary(&self) -> PlanSummary {
        let total = self.steps.len();
        let completed = self.steps.iter().filter(|s| s.status == StepStatus::Completed).count();
        let in_progress = self.steps.iter().filter(|s| s.status == StepStatus::InProgress).count();
        let blocked = self.steps.iter().filter(|s| s.status == StepStatus::Blocked).count();

        PlanSummary {
            title: self.title.clone(),
            current_phase: self.current_phase.label().to_string(),
            total_steps: total,
            completed_steps: completed,
            in_progress_steps: in_progress,
            blocked_steps: blocked,
            progress_pct: if total > 0 { (completed as f64 / total as f64) * 100.0 } else { 0.0 },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanSummary {
    pub title: String,
    pub current_phase: String,
    pub total_steps: usize,
    pub completed_steps: usize,
    pub in_progress_steps: usize,
    pub blocked_steps: usize,
    pub progress_pct: f64,
}
