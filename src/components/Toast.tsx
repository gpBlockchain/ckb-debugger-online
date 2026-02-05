import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from "react";
import { Transition } from "@headlessui/react";
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration = 5000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, duration }]);
    
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(true);
  }, []);

  const handleRemove = () => {
    setShow(false);
    setTimeout(() => onRemove(toast.id), 300);
  };

  const icons = {
    success: CheckCircleIcon,
    error: XCircleIcon,
    warning: ExclamationTriangleIcon,
    info: InformationCircleIcon,
  };

  const colors = {
    success: "bg-green-50 border-green-200 text-green-800",
    error: "bg-red-50 border-red-200 text-red-800",
    warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };

  const iconColors = {
    success: "text-green-500",
    error: "text-red-500",
    warning: "text-yellow-500",
    info: "text-blue-500",
  };

  const Icon = icons[toast.type];

  return (
    <Transition
      show={show}
      enter="transform transition duration-300 ease-out"
      enterFrom="translate-x-full opacity-0"
      enterTo="translate-x-0 opacity-100"
      leave="transform transition duration-200 ease-in"
      leaveFrom="translate-x-0 opacity-100"
      leaveTo="translate-x-full opacity-0"
    >
      <div className={`flex items-center space-x-3 px-4 py-3 rounded-lg border shadow-lg max-w-sm ${colors[toast.type]}`}>
        <Icon className={`h-5 w-5 flex-shrink-0 ${iconColors[toast.type]}`} />
        <p className="text-sm flex-1">{toast.message}</p>
        <button
          onClick={handleRemove}
          className="p-1 hover:opacity-70 transition-opacity"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </Transition>
  );
}
