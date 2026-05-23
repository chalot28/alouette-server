
interface DiagnosticsPanelProps {
  uptimeSeconds: number;
}

export default function DiagnosticsPanel({ uptimeSeconds }: DiagnosticsPanelProps) {
  return (
    <div className="lower-panel-user">
      <div className="panel-header-row" style={{ justifyContent: 'flex-end', paddingBottom: '4px' }}>
        <span className="uptime-clock">
          Uptime: {Math.floor(uptimeSeconds / 60)}m {uptimeSeconds % 60}s
        </span>
      </div>

      <div className="user-dashboard-grid">
        <div className="user-card diagnostic-connection">
          <h4>🔌 Connection Diagnostics</h4>
          <div className="ping-test-box">
            <span className="ping-title">Local Connection diagnostics</span>
            <span className="ping-cmd">$ ping 127.0.0.1 -n 20</span>
            <span className="ping-status status-stopped">Stopped</span>
          </div>
          <p className="desc">
            Diagnostic test sockets ensure sidecar process handlers can bind execution parameters cleanly.
          </p>
        </div>

        <div className="user-card sysinfo-specs">
          <h4>💻 Runtime System Metadata</h4>
          <div className="specs-list">
            <div className="spec-item">
              <span>OS Architecture</span>
              <strong>Windows x64 Native</strong>
            </div>
            <div className="spec-item">
              <span>Tauri API Bridge</span>
              <strong>v2.0.0-rc</strong>
            </div>
            <div className="spec-item">
              <span>React Hydration</span>
              <strong>Vite Dev Server (Active)</strong>
            </div>
            <div className="spec-item">
              <span>Environment Root</span>
              <strong className="mono">d:\alouette-server</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
