import { useCallback, useState } from "react";
import { ArrowUpTrayIcon, DocumentIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useI18n } from "../lib/i18n";

export interface UploadedFile {
  name: string;
  content: Uint8Array;
  size: number;
}

interface FileUploaderProps {
  /** 接受的文件类型 */
  accept?: string;
  /** 标签文本 */
  label: string;
  /** 帮助文本 */
  helpText?: string;
  /** 上传的文件 */
  file: UploadedFile | null;
  /** 文件变化回调 */
  onFileChange: (file: UploadedFile | null) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

export function FileUploader({
  accept,
  label,
  helpText,
  file,
  onFileChange,
  disabled = false,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const { t } = useI18n();

  const handleFile = useCallback(
    async (inputFile: File) => {
      const arrayBuffer = await inputFile.arrayBuffer();
      const content = new Uint8Array(arrayBuffer);
      onFileChange({
        name: inputFile.name,
        content,
        size: inputFile.size,
      });
    },
    [onFileChange]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [disabled, handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemove = useCallback(() => {
    onFileChange(null);
  }, [onFileChange]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      
      {file ? (
        // 已上传文件显示
        <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center space-x-3">
            <DocumentIcon className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            disabled={disabled}
            className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-50 transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      ) : (
        // 文件上传区域
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            dropzone cursor-pointer
            ${isDragging ? "active" : ""}
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          `}
        >
          <input
            type="file"
            accept={accept}
            onChange={handleInputChange}
            disabled={disabled}
            className="hidden"
            id={`file-upload-${label}`}
          />
          <label
            htmlFor={`file-upload-${label}`}
            className={`flex flex-col items-center ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            <ArrowUpTrayIcon className="h-10 w-10 text-gray-400 mb-2" />
            <span className="text-sm text-gray-600">
              {t("fileUpload.dropzone")} <span className="text-blue-500 hover:underline">{t("fileUpload.clickToSelect")}</span>
            </span>
            {helpText && (
              <span className="text-xs text-gray-400 mt-1">{helpText}</span>
            )}
          </label>
        </div>
      )}
    </div>
  );
}
