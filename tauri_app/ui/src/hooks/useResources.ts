import { useEffect, useState, MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ResourceHistory } from "../types";
import { MAX_HISTORY_POINTS } from "../constants";

export function useResources(
  activeProjectId: string,
  theme: "dark" | "light",
  cpuCanvasRef: MutableRefObject<HTMLCanvasElement | null>,
  ramCanvasRef: MutableRefObject<HTMLCanvasElement | null>,
) {
  const [resourceHistory, setResourceHistory] = useState<ResourceHistory>({});

  // Force kill a process by PID
  const forceKillProcess = async (pid: number) => {
    try {
      await invoke("force_kill_process", { pid });
    } catch (e: any) {
      alert(`Force kill failed: ${e}`);
    }
  };

  // Listen to real-time process tree resource updates
  useEffect(() => {
    const resourceListener = listen<any>("resource-update", (event) => {
      const payload = event.payload; // { project_id, cpu_percentage, ram_bytes }
      const ramMb = payload.ram_bytes / (1024 * 1024);

      setResourceHistory((prev) => {
        const pHistory = prev[payload.project_id] || { cpu: [], ram: [] };
        const newCpu = [...pHistory.cpu, payload.cpu_percentage].slice(
          -MAX_HISTORY_POINTS,
        );
        const newRam = [...pHistory.ram, ramMb].slice(-MAX_HISTORY_POINTS);
        return {
          ...prev,
          [payload.project_id]: {
            cpu: newCpu,
            ram: newRam,
          },
        };
      });
    });

    return () => {
      resourceListener.then((unlisten) => unlisten());
    };
  }, []);

  const activeHistory = resourceHistory[activeProjectId] || {
    cpu: [],
    ram: [],
  };

  // Draw high-density Canvas Graph Engine
  const drawCanvasChart = (
    canvas: HTMLCanvasElement | null,
    data: number[],
    strokeColor: string,
    isPercent: boolean,
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const gridStyle =
      document.documentElement.getAttribute("data-theme") === "light"
        ? "rgba(0, 0, 0, 0.05)"
        : "rgba(255, 255, 255, 0.05)";
    ctx.strokeStyle = gridStyle;
    ctx.lineWidth = 1;

    for (let i = 0; i <= 3; i++) {
      const y = (h * i) / 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (data.length === 0) return;

    const maxVal = isPercent ? 100 : Math.max(16, ...data) * 1.1;

    ctx.beginPath();
    data.forEach((val, idx) => {
      const x = (w * idx) / 29;
      const y = h - (h * val) / maxVal;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    const fillCtx = ctx;
    fillCtx.lineTo((w * (data.length - 1)) / 29, h);
    fillCtx.lineTo(0, h);
    fillCtx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, strokeColor.replace("1)", "0.15)"));
    gradient.addColorStop(1, strokeColor.replace("1)", "0.0)"));
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    data.forEach((val, idx) => {
      const x = (w * idx) / 29;
      const y = h - (h * val) / maxVal;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  // Render CPU chart dynamically
  useEffect(() => {
    drawCanvasChart(
      cpuCanvasRef.current,
      activeHistory.cpu,
      theme === "dark" ? "rgba(58, 134, 255, 1)" : "rgba(0, 86, 224, 1)",
      true,
    );
  }, [activeHistory.cpu, theme]);

  // Render RAM chart dynamically
  useEffect(() => {
    drawCanvasChart(
      ramCanvasRef.current,
      activeHistory.ram,
      "rgba(16, 185, 129, 1)",
      false,
    );
  }, [activeHistory.ram, theme]);

  return {
    resourceHistory,
    setResourceHistory,
    forceKillProcess,
  };
}
