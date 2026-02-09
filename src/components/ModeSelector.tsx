import { useI18n } from "../lib/i18n";

export type AppMode = "debugger" | "ipc";

interface ModeSelectorProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
  const { t } = useI18n();

  return (
    <div className="flex bg-gray-100 rounded-lg p-1">
      <button
        onClick={() => onChange("debugger")}
        className={`
          flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors
          ${
            mode === "debugger"
              ? "bg-white text-blue-700 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }
        `}
      >
        {t("mode.debugger")}
      </button>
      <button
        onClick={() => onChange("ipc")}
        className={`
          flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors
          ${
            mode === "ipc"
              ? "bg-white text-blue-700 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }
        `}
      >
        {t("mode.ipc")}
      </button>
    </div>
  );
}
