import { Tab } from "@headlessui/react";
import { CommandLineIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import type { DebuggerMode } from "../hooks/useDebugger";

interface ModeSelectorProps {
  mode: DebuggerMode;
  onModeChange: (mode: DebuggerMode) => void;
  disabled?: boolean;
}

const modes: { id: DebuggerMode; name: string; description: string; icon: typeof CommandLineIcon }[] = [
  {
    id: "binary",
    name: "Binary 模式",
    description: "直接运行 RISC-V 二进制文件",
    icon: CommandLineIcon,
  },
  {
    id: "mockTx",
    name: "Mock TX 模式",
    description: "使用 mock_tx.json 模拟交易",
    icon: DocumentTextIcon,
  },
];

export function ModeSelector({ mode, onModeChange, disabled }: ModeSelectorProps) {
  const selectedIndex = modes.findIndex((m) => m.id === mode);

  return (
    <Tab.Group
      selectedIndex={selectedIndex}
      onChange={(index) => onModeChange(modes[index].id)}
    >
      <Tab.List className="flex space-x-2 rounded-xl bg-gray-100 p-1">
        {modes.map((modeItem) => (
          <Tab
            key={modeItem.id}
            disabled={disabled}
            className={({ selected }) =>
              `w-full rounded-lg py-3 px-4 text-sm font-medium leading-5 transition-all
              ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
              ${
                selected
                  ? "bg-white text-blue-600 shadow"
                  : "text-gray-600 hover:bg-white/50 hover:text-gray-800"
              }`
            }
          >
            <div className="flex items-center justify-center space-x-2">
              <modeItem.icon className="h-5 w-5" />
              <span>{modeItem.name}</span>
            </div>
          </Tab>
        ))}
      </Tab.List>
      <Tab.Panels className="mt-4">
        {modes.map((modeItem) => (
          <Tab.Panel key={modeItem.id}>
            <p className="text-sm text-gray-500">{modeItem.description}</p>
          </Tab.Panel>
        ))}
      </Tab.Panels>
    </Tab.Group>
  );
}
