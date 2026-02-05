import { useState, useEffect } from "react";
import { useI18n } from "../lib/i18n";

export interface MockTxParams {
  cellIndex: number;
  cellType: "input" | "output";
  scriptGroupType: "lock" | "type";
  maxCycles: number;
}

interface MockTxParamsEditorProps {
  params: MockTxParams;
  onChange: (params: MockTxParams) => void;
  disabled?: boolean;
}

export function MockTxParamsEditor({ params, onChange, disabled }: MockTxParamsEditorProps) {
  const [localMaxCycles, setLocalMaxCycles] = useState(String(params.maxCycles));
  const [localCellIndex, setLocalCellIndex] = useState(String(params.cellIndex));
  const { t } = useI18n();

  useEffect(() => {
    setLocalMaxCycles(String(params.maxCycles));
  }, [params.maxCycles]);

  useEffect(() => {
    setLocalCellIndex(String(params.cellIndex));
  }, [params.cellIndex]);

  const handleMaxCyclesChange = (value: string) => {
    setLocalMaxCycles(value);
    const num = parseInt(value, 10);
    if (!isNaN(num) && num > 0) {
      onChange({ ...params, maxCycles: num });
    }
  };

  const handleCellIndexChange = (value: string) => {
    setLocalCellIndex(value);
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 0) {
      onChange({ ...params, cellIndex: num });
    }
  };

  return (
    <div className="space-y-4">
      {/* Cell 选择器 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("params.cellIndex")}
          </label>
          <input
            type="number"
            min="0"
            value={localCellIndex}
            onChange={(e) => handleCellIndexChange(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            placeholder="0"
          />
          <p className="text-xs text-gray-400 mt-1">--cell-index</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("params.cellType")}
          </label>
          <select
            value={params.cellType}
            onChange={(e) => onChange({ ...params, cellType: e.target.value as "input" | "output" })}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            <option value="input">input</option>
            <option value="output">output</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">--cell-type</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("params.scriptGroupType")}
          </label>
          <select
            value={params.scriptGroupType}
            onChange={(e) => onChange({ ...params, scriptGroupType: e.target.value as "lock" | "type" })}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            <option value="lock">lock</option>
            <option value="type">type</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">--script-group-type</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("params.maxCycles")}
          </label>
          <input
            type="text"
            value={localMaxCycles}
            onChange={(e) => handleMaxCyclesChange(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            placeholder="3500000000"
          />
          <p className="text-xs text-gray-400 mt-1">--max-cycles</p>
        </div>
      </div>

      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="text-sm text-blue-700">
          <strong>{t("params.equivalentCommand")}</strong>
        </p>
        <code className="text-xs text-blue-600 block mt-1 break-all">
          ckb-debugger --tx-file mock_tx.json --cell-index {params.cellIndex} --cell-type {params.cellType} --script-group-type {params.scriptGroupType}
        </code>
      </div>
    </div>
  );
}
