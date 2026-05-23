import { Square, Play, Monitor } from "lucide-react";

interface Project {
  id: string;
  name: string;
  command: string;
  args: string[];
  port?: number;
}

interface ProcessState {
  type: "Stopped" | "Setup" | "Running" | "Crashing" | "Terminated" | "Fatal";
  data?: any;
}

interface ProcessMonitorProps {
  activeProject: Project | undefined;
  activeState: ProcessState;
  activeCpuVal: number;
  activeRamVal: number;
  cpuCanvasRef: React.RefObject<HTMLCanvasElement>;
  ramCanvasRef: React.RefObject<HTMLCanvasElement>;
  handleStart: () => void;
  handleStop: () => void;
}

export default function ProcessMonitor({
  activeProject,
  activeState,
  activeCpuVal,
  activeRamVal,
  cpuCanvasRef,
  ramCanvasRef,
  handleStart,
  handleStop
}: ProcessMonitorProps) {
  return (
    <section className="green-zone-panel">

      {activeProject ? (
        <div className="active-process-details">
          <div className="active-process-meta">
            <div className="name-and-status">
              <h3>{activeProject.name}</h3>
            </div>
            <p className="process-command-text">
              $ {activeProject.command} {activeProject.args.join(" ")}
            </p>
          </div>

          {/* Sparkline Canvas graphs */}
          <div className="sparklines-container">
            <div className="mini-chart-card">
              <div className="chart-header">
                <span>CPU LOAD</span>
                <strong className="value-cpu">
                  {activeState.type === "Running" ? `${activeCpuVal.toFixed(1)}%` : "0.0%"}
                </strong>
              </div>
              <div className="mini-canvas-wrapper">
                <canvas ref={cpuCanvasRef} />
              </div>
            </div>

            <div className="mini-chart-card">
              <div className="chart-header">
                <span>RAM RSS</span>
                <strong className="value-ram">
                  {activeState.type === "Running" ? `${activeRamVal.toFixed(1)} MB` : "0.0 MB"}
                </strong>
              </div>
              <div className="mini-canvas-wrapper">
                <canvas ref={ramCanvasRef} />
              </div>
            </div>
          </div>

          <div className="quick-metadata-row">
            <div className="meta-capsule">
              <span className="label">PID:</span>
              <span className="value mono">
                {activeState.type === "Running" ? activeState.data : "N/A"}
              </span>
            </div>
            {activeProject.port && (
              <div className="meta-capsule">
                <span className="label">PORT:</span>
                <span className="value mono success">{activeProject.port}</span>
              </div>
            )}
            <div className="quick-actions-buttons">
              {activeState.type === "Running" || activeState.type === "Setup" ? (
                <button className="btn btn-danger btn-sm" onClick={handleStop}>
                  <Square size={9} fill="currentColor" />
                  <span>Stop</span>
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={handleStart}>
                  <Play size={9} fill="currentColor" />
                  <span>Start</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-zone-message">
          <Monitor size={28} />
          <p>Select or configure a project tab below to track execution diagnostics.</p>
        </div>
      )}
    </section>
  );
}
