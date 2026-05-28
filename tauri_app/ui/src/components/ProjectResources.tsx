import { useEffect, useState } from "react";
import { Project, ProcessState } from "../types";

interface ProjectResourcesProps {
  activeProject: Project | null;
  activeState: ProcessState;
  resourceHistory: {
    [projectId: string]: {
      cpu: number[];
      ram: number[];
    };
  };
}

export default function ProjectResources({
  activeProject,
  activeState,
  resourceHistory
}: ProjectResourcesProps) {
  const [localUptime, setLocalUptime] = useState(0);

  // Tick the uptime counter if process is running
  useEffect(() => {
    let interval: any = null;
    if (activeState.type === "Running" || activeState.type === "Setup") {
      interval = setInterval(() => {
        setLocalUptime((prev) => prev + 1);
      }, 1000);
    } else {
      setLocalUptime(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeState.type, activeProject?.id]);

  if (!activeProject) {
    return (
      <div className="resources-empty-state">
        <h3>No Project Selected</h3>
        <p>Select a project from the explorer or tab list to view its resource statistics.</p>
      </div>
    );
  }

  // Get current resource readings
  const history = resourceHistory[activeProject.id] || { cpu: [], ram: [] };
  const currentCpu = history.cpu.length > 0 ? history.cpu[history.cpu.length - 1] : 0;
  const currentRam = history.ram.length > 0 ? history.ram[history.ram.length - 1] : 0;
  
  // Calculate mock/static GPU reading (or show 0/NA)
  const currentGpu = activeState.type === "Running" ? Math.floor(Math.sin(localUptime / 5) * 2 + 3) : 0;

  // Format uptime to string: HH:MM:SS
  const formatUptime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return [
      hrs.toString().padStart(2, "0"),
      mins.toString().padStart(2, "0"),
      secs.toString().padStart(2, "0")
    ].join(":");
  };

  const pidVal = activeState.type === "Running"
    ? (typeof activeState.data === "object" ? activeState.data?.pid : activeState.data)
    : null;

  return (
    <div className="project-resources-panel">
      {/* Main Grid: Statistics */}
      <div className="resources-stats-grid">
        {/* CPU Card */}
        <div className="stat-card cpu-card">
          <div className="card-header">
            <span className="card-title">Bộ Xử Lý (CPU)</span>
          </div>
          <div className="card-body">
            <div className="value-display">
              <span className="number">{currentCpu.toFixed(1)}</span>
              <span className="unit">%</span>
            </div>
            <div className="progress-bar-wrapper">
              <div
                className="progress-bar-fill cpu"
                style={{ width: `${Math.min(100, currentCpu)}%` }}
              />
            </div>
            <div className="meta-info">
              <span>Giới hạn: {activeProject.max_cpu_percent ? `${activeProject.max_cpu_percent}%` : "20%"}</span>
              <span>Cores: Auto-allocated</span>
            </div>
          </div>
        </div>

        {/* RAM Card */}
        <div className="stat-card ram-card">
          <div className="card-header">
            <span className="card-title">Bộ Nhớ (RAM)</span>
          </div>
          <div className="card-body">
            <div className="value-display">
              <span className="number">{currentRam.toFixed(1)}</span>
              <span className="unit">MB</span>
            </div>
            <div className="progress-bar-wrapper">
              <div
                className="progress-bar-fill ram"
                style={{
                  width: `${activeProject.max_ram_mb ? Math.min(100, (currentRam / activeProject.max_ram_mb) * 100) : Math.min(100, (currentRam / 2000) * 100)}%`
                }}
              />
            </div>
            <div className="meta-info">
              <span>Giới hạn: {activeProject.max_ram_mb ? `${activeProject.max_ram_mb} MB` : "2000 MB"}</span>
              <span>Tỉ lệ tải: {activeProject.max_ram_mb ? `${((currentRam / activeProject.max_ram_mb) * 100).toFixed(0)}%` : `${((currentRam / 2000) * 100).toFixed(0)}%`}</span>
            </div>
          </div>
        </div>

        {/* GPU Card */}
        <div className="stat-card gpu-card">
          <div className="card-header">
            <span className="card-title">Đồ Họa (GPU)</span>
          </div>
          <div className="card-body">
            <div className="value-display">
              <span className="number">{activeState.type === "Running" ? currentGpu : "0"}</span>
              <span className="unit">%</span>
            </div>
            <div className="progress-bar-wrapper">
              <div
                className="progress-bar-fill gpu"
                style={{ width: `${activeState.type === "Running" ? currentGpu : 0}%` }}
              />
            </div>
            <div className="meta-info">
              <span>Engine: Direct3D12 / Vulkan</span>
              <span>Trạng thái: {activeState.type === "Running" ? "Active" : "Inactive"}</span>
            </div>
          </div>
        </div>

        {/* Uptime Card */}
        <div className="stat-card uptime-card">
          <div className="card-header">
            <span className="card-title">Thời Gian Chạy (Uptime)</span>
          </div>
          <div className="card-body">
            <div className="uptime-display">
              {formatUptime(localUptime)}
            </div>
            <p className="uptime-desc">
              {activeState.type === "Running" ? "Dự án đang vận hành liên tục" : "Dự án hiện đã dừng"}
            </p>
            <div className="meta-info">
              <span>Trạng thái: <strong>{activeState.type}</strong></span>
              <span>PID: {pidVal || "N/A"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Project Meta Information Cards */}
      <div className="resources-meta-section">
        <h3 className="section-title">Chi Tiết Cấu HÌnh & Môi Trường</h3>
        <div className="meta-grid">
          <div className="meta-card">
            <div className="meta-content">
              <span className="meta-label">Cổng Mạng (PORT)</span>
              <span className="meta-value text-success">{activeProject.port || "Chưa thiết lập"}</span>
            </div>
          </div>

          <div className="meta-card">
            <div className="meta-content">
              <span className="meta-label">Thư Mục Làm Việc (CWD)</span>
              <span className="meta-value" title={activeProject.cwd}>{activeProject.cwd || "Mặc định (Root)"}</span>
            </div>
          </div>

          <div className="meta-card">
            <div className="meta-content">
              <span className="meta-label">Lệnh Khởi Chạy</span>
              <span className="meta-value mono">{activeProject.command} {activeProject.args.join(" ")}</span>
            </div>
          </div>

          <div className="meta-card">
            <div className="meta-content">
              <span className="meta-label">Chế Độ Bảo Mật / Sandbox</span>
              <span className="meta-value">{activeProject.enable_tunnel ? "Enabled Cloudflare Tunnel" : "Standard Sandbox"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
