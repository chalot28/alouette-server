// Settings icon removed

interface ConfigSetupProps {
  newProjName: string;
  setNewProjName: (v: string) => void;
  newProjRestart: boolean;
  setNewProjRestart: (v: boolean) => void;
  newProjCmd: string;
  setNewProjCmd: (v: string) => void;
  newProjArgs: string;
  setNewProjArgs: (v: string) => void;
  newProjCwd: string;
  setNewProjCwd: (v: string) => void;
  newProjPort: string;
  setNewProjPort: (v: string) => void;
  newProjCpu: string;
  setNewProjCpu: (v: string) => void;
  newProjRam: string;
  setNewProjRam: (v: string) => void;
  newProjSource: string;
  setNewProjSource: (v: string) => void;
  newProjTerminalMode: string;
  setNewProjTerminalMode: (v: string) => void;
  newProjToolchain: string;
  setNewProjToolchain: (v: string) => void;
  newProjToolchainVersion: string;
  setNewProjToolchainVersion: (v: string) => void;
  newProjMaxLogLines: string;
  setNewProjMaxLogLines: (v: string) => void;
  handleResetSetupForm: () => void;
  handleAddProject: () => void;
}

export default function ConfigSetup({
  newProjName,
  setNewProjName,
  newProjRestart,
  setNewProjRestart,
  newProjCmd,
  setNewProjCmd,
  newProjArgs,
  setNewProjArgs,
  newProjCwd,
  setNewProjCwd,
  newProjPort,
  setNewProjPort,
  newProjCpu,
  setNewProjCpu,
  newProjRam,
  setNewProjRam,
  newProjSource,
  setNewProjSource,
  newProjTerminalMode,
  setNewProjTerminalMode,
  newProjToolchain,
  setNewProjToolchain,
  newProjToolchainVersion,
  setNewProjToolchainVersion,
  newProjMaxLogLines,
  setNewProjMaxLogLines,
  handleResetSetupForm,
  handleAddProject
}: ConfigSetupProps) {
  return (
    <section className="yellow-zone-panel">

      <div className="setup-fields-scroll">
        <div className="form-row">
          <div className="form-group flex-2">
            <label className="form-label">Tab / Project Identifier</label>
            <input
              type="text"
              className="form-input-sm"
              placeholder="e.g. Node backend service"
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
            />
          </div>
          <div className="form-group flex-1">
            <label className="form-label">Auto Recovery</label>
            <div className="checkbox-wrapper">
              <input
                type="checkbox"
                id="auto_restart_sw"
                checked={newProjRestart}
                onChange={(e) => setNewProjRestart(e.target.checked)}
              />
              <label htmlFor="auto_restart_sw" className="checkbox-label">
                Auto restart
              </label>
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label className="form-label">Executor</label>
            <input
              type="text"
              className="form-input-sm"
              placeholder="npm, node, ping"
              value={newProjCmd}
              onChange={(e) => setNewProjCmd(e.target.value)}
            />
          </div>
          <div className="form-group flex-1">
            <label className="form-label">Command Arguments</label>
            <input
              type="text"
              className="form-input-sm"
              placeholder="run dev"
              value={newProjArgs}
              onChange={(e) => setNewProjArgs(e.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label className="form-label">Working Directory CWD (Optional)</label>
            <input
              type="text"
              className="form-input-sm"
              placeholder="e.g. d:\alouette-server"
              value={newProjCwd}
              onChange={(e) => setNewProjCwd(e.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label className="form-label">Clone / Copy Source (Optional)</label>
            <input
              type="text"
              className="form-input-sm"
              placeholder="Git URL or local path to copy..."
              value={newProjSource}
              onChange={(e) => setNewProjSource(e.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label className="form-label">Toolchain (Proto)</label>
            <select
              className="form-input-sm"
              value={newProjToolchain}
              onChange={(e) => setNewProjToolchain(e.target.value)}
            >
              <option value="">System Default (No strict isolation)</option>
              <option value="node">Node.js</option>
              <option value="go">Go</option>
              <option value="python">Python</option>
            </select>
          </div>
          {newProjToolchain && (
            <div className="form-group flex-1">
              <label className="form-label">Version</label>
              <input
                type="text"
                className="form-input-sm"
                placeholder="e.g. stable, 20.9.0"
                value={newProjToolchainVersion}
                onChange={(e) => setNewProjToolchainVersion(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label className="form-label">Terminal Mode</label>
            <select
              className="form-input-sm"
              value={newProjTerminalMode}
              onChange={(e) => setNewProjTerminalMode(e.target.value)}
            >
              <option value="log">Piped Log Stream (Mode B)</option>
              <option value="pty">Interactive PTY (Mode A)</option>
            </select>
          </div>
        </div>

        <div className="form-row-watchdogs">
          <div className="form-group">
            <label className="form-label">Scanner Port</label>
            <input
              type="number"
              className="form-input-sm"
              placeholder="e.g. 3000"
              value={newProjPort}
              onChange={(e) => setNewProjPort(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max CPU (%)</label>
            <input
              type="number"
              className="form-input-sm"
              placeholder="No limit"
              value={newProjCpu}
              onChange={(e) => setNewProjCpu(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max RAM (MB)</label>
            <input
              type="number"
              className="form-input-sm"
              placeholder="No limit"
              value={newProjRam}
              onChange={(e) => setNewProjRam(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max Log Lines</label>
            <input
              type="number"
              className="form-input-sm"
              placeholder="Default 5000"
              value={newProjMaxLogLines}
              onChange={(e) => setNewProjMaxLogLines(e.target.value)}
            />
          </div>
        </div>

        <div className="setup-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleResetSetupForm}>
            New / Reset Form
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleAddProject}>
            Save Tab Settings
          </button>
        </div>
      </div>
    </section>
  );
}
