import { useState, useCallback, useMemo } from "react";
import {
  ArrowDownTrayIcon,
  PencilSquareIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import { useI18n } from "../lib/i18n";
import type { UploadedFile } from "./FileUploader";

interface MockTxEditorProps {
  /** Current mock tx file */
  file: UploadedFile;
  /** Callback when file content is updated */
  onFileChange: (file: UploadedFile) => void;
  /** Whether the editor is disabled */
  disabled?: boolean;
}

export function MockTxEditor({ file, onFileChange, disabled = false }: MockTxEditorProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [editText, setEditText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  // Decode file content to JSON string
  const jsonText = useMemo(() => {
    try {
      const text = new TextDecoder().decode(file.content);
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return new TextDecoder().decode(file.content);
    }
  }, [file.content]);

  // Toggle expand/collapse
  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => {
      if (!prev) {
        // Opening: initialize edit text from current file
        setEditText(jsonText);
        setParseError(null);
        setApplied(false);
      }
      return !prev;
    });
  }, [jsonText]);

  // Download mock_tx.json
  const handleDownload = useCallback(() => {
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name || "mock_tx.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [jsonText, file.name]);

  // Apply edited JSON
  const handleApply = useCallback(() => {
    try {
      // Validate JSON
      JSON.parse(editText);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }

    const content = new TextEncoder().encode(editText);
    onFileChange({
      name: file.name,
      content,
      size: content.length,
    });
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  }, [editText, file.name, onFileChange]);

  return (
    <div className="space-y-2">
      {/* Action buttons row */}
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={disabled}
          className="inline-flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t("mockTxEditor.download")}
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          <span>{t("mockTxEditor.download")}</span>
        </button>
        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          className="inline-flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t("mockTxEditor.editJson")}
        >
          <PencilSquareIcon className="h-4 w-4" />
          <span>{t("mockTxEditor.editJson")}</span>
          {isExpanded ? (
            <ChevronUpIcon className="h-3 w-3" />
          ) : (
            <ChevronDownIcon className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Collapsible JSON editor */}
      {isExpanded && (
        <div className="space-y-2">
          <textarea
            value={editText}
            onChange={(e) => {
              setEditText(e.target.value);
              setParseError(null);
              setApplied(false);
            }}
            disabled={disabled}
            spellCheck={false}
            className="w-full h-80 p-3 font-mono text-xs text-gray-800 bg-gray-50 border border-gray-300 rounded-lg resize-y focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          />
          {parseError && (
            <p className="text-xs text-red-600">{t("mockTxEditor.jsonError")}: {parseError}</p>
          )}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={disabled}
              className={`inline-flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                applied
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              <CheckIcon className="h-4 w-4" />
              <span>{applied ? t("mockTxEditor.applied") : t("mockTxEditor.apply")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
