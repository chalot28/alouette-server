import { useState, useEffect } from "react";
import { Plus, Trash2, Variable, Globe } from "lucide-react";

interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
}

interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
}

interface Props {
  onInsertVariable?: (varName: string) => void;
  refreshTrigger?: number;
}

export default function MiniPostmanEnvManager({
  onInsertVariable,
  refreshTrigger,
}: Props) {
  const [environments, setEnvironments] = useState<Environment[]>(() => {
    return loadEnvironments();
  });

  const loadEnvironments = (): Environment[] => {
    const saved = localStorage.getItem("postman_environments");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return [
      {
        id: "env-default",
        name: "Development",
        variables: [
          { key: "base_url", value: "http://localhost:8080", enabled: true },
          { key: "api_key", value: "dev-key-123", enabled: true },
          { key: "auth_token", value: "", enabled: true },
        ],
      },
      {
        id: "env-prod",
        name: "Production",
        variables: [
          { key: "base_url", value: "https://api.example.com", enabled: true },
          { key: "api_key", value: "", enabled: true },
          { key: "auth_token", value: "", enabled: true },
        ],
      },
    ];
  };

  // Reload when refreshTrigger changes (e.g., pm.environment.set from scripts)
  useEffect(() => {
    const envs = loadEnvironments();
    setEnvironments(envs);
  }, [refreshTrigger]);

  const [activeEnvId, setActiveEnvId] = useState(environments[0]?.id || "");
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarValue, setNewVarValue] = useState("");

  const activeEnv = environments.find((e) => e.id === activeEnvId);

  const saveEnvironments = (envs: Environment[]) => {
    setEnvironments(envs);
    localStorage.setItem("postman_environments", JSON.stringify(envs));
  };

  const addVariable = () => {
    if (!newVarKey.trim() || !activeEnv) return;
    const updated = environments.map((env) => {
      if (env.id === activeEnvId) {
        return {
          ...env,
          variables: [
            ...env.variables.filter((v) => v.key !== newVarKey.trim()),
            { key: newVarKey.trim(), value: newVarValue, enabled: true },
          ],
        };
      }
      return env;
    });
    saveEnvironments(updated);
    setNewVarKey("");
    setNewVarValue("");
  };

  const removeVariable = (key: string) => {
    if (!activeEnv) return;
    const updated = environments.map((env) => {
      if (env.id === activeEnvId) {
        return {
          ...env,
          variables: env.variables.filter((v) => v.key !== key),
        };
      }
      return env;
    });
    saveEnvironments(updated);
  };

  const updateVariable = (
    key: string,
    field: "key" | "value" | "enabled",
    val: any,
  ) => {
    if (!activeEnv) return;
    const updated = environments.map((env) => {
      if (env.id === activeEnvId) {
        return {
          ...env,
          variables: env.variables.map((v) =>
            v.key === key ? { ...v, [field]: val } : v,
          ),
        };
      }
      return env;
    });
    saveEnvironments(updated);
  };

  const addEnvironment = () => {
    const name = prompt("Environment name:");
    if (!name) return;
    const newEnv: Environment = {
      id: `env-${Date.now()}`,
      name,
      variables: [],
    };
    saveEnvironments([...environments, newEnv]);
    setActiveEnvId(newEnv.id);
  };

  const deleteEnvironment = (id: string) => {
    const updated = environments.filter((e) => e.id !== id);
    saveEnvironments(updated);
    if (activeEnvId === id && updated.length > 0) {
      setActiveEnvId(updated[0].id);
    }
  };

  const insertVar = (name: string) => {
    if (onInsertVariable) {
      onInsertVariable(`{{${name}}}`);
    }
  };

  /*
  const substituteVars = (text: string): string => {
    if (!activeEnv) return text;
    let result = text;
    activeEnv.variables.forEach((v) => {
      if (v.enabled && v.value) {
        result = result.replace(
          new RegExp(`\\{\\{${v.key}\\}\\}`, "g"),
          v.value,
        );
      }
    });
    return result;
  };

  /*
  const copySubstitutedUrl = (url: string) => {
    navigator.clipboard.writeText(substituteVars(url));
    setCopiedVar("url");
    setTimeout(() => setCopiedVar(""), 2000);
  };
  */

  return (
    <div className="env-manager-panel">
      {/* Environment Selector */}
      <div className="env-selector-bar">
        <Globe size={13} className="text-muted" />
        <select
          className="env-select"
          value={activeEnvId}
          onChange={(e) => setActiveEnvId(e.target.value)}
        >
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
        <button
          className="env-add-btn"
          onClick={addEnvironment}
          title="New Environment"
        >
          <Plus size={12} />
        </button>
        {environments.length > 1 && (
          <button
            className="env-del-btn"
            onClick={() => deleteEnvironment(activeEnvId)}
            title="Delete Environment"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Variables List */}
      <div className="env-vars-list">
        {activeEnv?.variables.length === 0 && (
          <div className="text-muted text-xs italic p-2">
            No variables defined
          </div>
        )}
        {activeEnv?.variables.map((v) => (
          <div key={v.key} className="env-var-row">
            <input
              type="checkbox"
              checked={v.enabled}
              onChange={(e) =>
                updateVariable(v.key, "enabled", e.target.checked)
              }
              className="env-var-check"
            />
            <input
              type="text"
              className="env-var-key"
              value={v.key}
              onChange={(e) => {
                const oldKey = v.key;
                // Re-create the variable with new key
                if (!activeEnv) return;
                const updated = environments.map((env) => {
                  if (env.id === activeEnvId) {
                    return {
                      ...env,
                      variables: env.variables.map((vv) =>
                        vv.key === oldKey ? { ...vv, key: e.target.value } : vv,
                      ),
                    };
                  }
                  return env;
                });
                saveEnvironments(updated);
              }}
            />
            <input
              type="text"
              className="env-var-value"
              value={v.value}
              onChange={(e) => updateVariable(v.key, "value", e.target.value)}
            />
            <button
              className="env-var-insert"
              onClick={() => insertVar(v.key)}
              title={`Insert {{${v.key}}}`}
            >
              <Variable size={11} />
            </button>
            <button
              className="env-var-del"
              onClick={() => removeVariable(v.key)}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      {/* Add Variable Form */}
      <div className="env-add-var">
        <input
          type="text"
          placeholder="Key"
          value={newVarKey}
          onChange={(e) => setNewVarKey(e.target.value)}
          className="env-new-key"
        />
        <input
          type="text"
          placeholder="Value"
          value={newVarValue}
          onChange={(e) => setNewVarValue(e.target.value)}
          className="env-new-value"
        />
        <button
          className="env-add-btn"
          onClick={addVariable}
          disabled={!newVarKey.trim()}
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Preview substituted URL */}
      {activeEnv && activeEnv.variables.some((v) => v.enabled && v.value) && (
        <div className="env-preview">
          <span className="text-xxs text-muted">Active variables:</span>
          <div className="env-badges">
            {activeEnv.variables
              .filter((v) => v.enabled && v.value)
              .map((v) => (
                <span
                  key={v.key}
                  className="env-badge"
                  title={`${v.key}=${v.value}`}
                >
                  <Variable size={9} />
                  {v.key}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
