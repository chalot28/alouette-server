
interface Project {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
}

interface ProcessState {
  type: "Stopped" | "Setup" | "Running" | "Crashing" | "Terminated" | "Fatal";
  data?: any;
}

interface ResourceHistory {
  [projectId: string]: {
    cpu: number[];
    ram: number[];
  };
}

interface ProcessManagerProps {
  projects: Project[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  projectStates: { [id: string]: ProcessState };
  resourceHistory: ResourceHistory;
  handleStartProject: (id: string) => void;
  handleStopProject: (id: string) => void;
  forceKillProcess: (pid: number) => Promise<void>;
  triggerConfirm: (message: string, onConfirm: () => void) => void;
  triggerToast: (message: string, type: "success" | "error" | "info") => void;
}

export default function ProcessManager({
  projects,
  activeProjectId,
  setActiveProjectId,
  projectStates,
  resourceHistory,
  handleStartProject,
  handleStopProject,
  forceKillProcess,
  triggerConfirm,
  triggerToast
}: ProcessManagerProps) {
  return (
    <div className="lower-panel-manager" style={{ padding: '8px', gap: '6px' }}>
      <div className="panel-header-row">
        <h3 style={{ fontSize: '11px' }}>Process Tree</h3>
        <span className="sys-badge" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>OS: Windows</span>
      </div>

      <div className="manager-table-wrapper">
        <table className="manager-table">
          <thead>
            <tr>
              <th>Tab Name</th>
              <th>Status</th>
              <th>PID</th>
              <th>CWD</th>
              <th>CPU Usage</th>
              <th>Memory RSS</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const state = projectStates[p.id] || { type: "Stopped" };
              const history = resourceHistory[p.id];
              const cpu = history && history.cpu.length > 0 ? history.cpu[history.cpu.length - 1] : 0;
              const ram = history && history.ram.length > 0 ? history.ram[history.ram.length - 1] : 0;
              const isActive = p.id === activeProjectId;

              return (
                <tr key={p.id} className={isActive ? "active-row" : ""}>
                  <td>
                    <strong>{p.name}</strong>
                  </td>
                  <td>
                    <span className={`status-pill status-${state.type.toLowerCase()}`}>
                      {state.type}
                    </span>
                  </td>
                  <td className="mono">
                    {state.type === "Running"
                      ? (typeof state.data === "object" ? state.data?.pid : state.data)
                      : "-"}
                  </td>
                  <td className="cwd-cell">{p.cwd || "System Root"}</td>
                  <td className="mono font-bold">
                    {state.type === "Running" ? `${cpu.toFixed(1)}%` : "0.0%"}
                  </td>
                  <td className="mono font-bold">
                    {state.type === "Running" ? `${ram.toFixed(1)} MB` : "0.0 MB"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {state.type === "Running" ? (
                        <button
                          className="btn btn-danger btn-xs"
                          onClick={() => {
                            setActiveProjectId(p.id);
                            handleStopProject(p.id);
                          }}
                        >
                          Kill
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary btn-xs"
                          onClick={() => {
                            setActiveProjectId(p.id);
                            handleStartProject(p.id);
                          }}
                        >
                          Run
                        </button>
                      )}
                      {state.type === "Running" && state.data && (
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => {
                            const pid = typeof state.data === "object" ? state.data?.pid : state.data;
                            triggerConfirm(`Are you sure you want to force kill PID ${pid}?`, async () => {
                              try {
                                await forceKillProcess(pid);
                                triggerToast(`Process ${pid} force killed.`, "success");
                              } catch (e: any) {
                                triggerToast(`Failed to kill process: ${e}`, "error");
                              }
                            });
                          }}
                        >
                          Force Kill
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
