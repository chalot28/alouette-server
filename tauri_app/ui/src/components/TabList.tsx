import { Trash2 } from "lucide-react";

interface Project {
  id: string;
  name: string;
  command: string;
  args: string[];
}

interface ProcessState {
  type: "Stopped" | "Setup" | "Running" | "Crashing" | "Terminated" | "Fatal";
  data?: any;
}


interface TabListProps {
  filteredProjects: Project[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  projectStates: { [id: string]: ProcessState };
  setAutoScroll: (b: boolean) => void;
  handleDeleteProject: (id: string) => void;
}

export default function TabList({
  filteredProjects,
  activeProjectId,
  setActiveProjectId,
  projectStates,
  setAutoScroll,
  handleDeleteProject
}: TabListProps) {
  return (
    <div className="lower-panel-tab" style={{ padding: '8px 0', gap: '0' }}>
      <div className="tabs-grid-container" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {filteredProjects.length === 0 ? (
          <div className="no-projects-fallback" style={{ padding: '20px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '11px' }}>No active tabs.</p>
          </div>
        ) : (
          filteredProjects.map((p) => {
            const state = projectStates[p.id] || { type: "Stopped" };
            const isActive = p.id === activeProjectId;

            return (
              <div
                key={p.id}
                className={`tab-list-item ${isActive ? "active" : ""}`}
                onClick={() => {
                  setActiveProjectId(p.id);
                  setAutoScroll(true);
                }}
              >
                <div className="tab-item-left">
                  <span className={`tab-item-status-dot status-${state.type.toLowerCase()}`} />
                  <span className="tab-item-name">{p.name}</span>
                </div>
                <button
                  className="tab-item-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteProject(p.id);
                  }}
                  title="Delete tab"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
