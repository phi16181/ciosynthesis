import { useRef, useState } from "react";
import { UploadCloud, FileText } from "lucide-react";

const ACCEPTED = ".pdf,.csv,.html,.htm,.xls,.xlsx,.doc,.docx";

export default function FileUpload({ onFileSelected, disabled }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(fileList) {
    const file = fileList?.[0];
    if (file) onFileSelected(file);
  }

  return (
    <div
      className={`uploader ${isDragging ? "uploader--drag" : ""} ${disabled ? "uploader--disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) inputRef.current?.click();
      }}
      aria-disabled={disabled}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        hidden
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <UploadCloud className="uploader__icon" size={28} strokeWidth={1.5} />
      <p className="uploader__title">Drop a CIOS report, or click to browse</p>
      <p className="uploader__hint">
        <FileText size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        PDF · CSV · HTML · XLS/XLSX · DOC/DOCX
      </p>
    </div>
  );
}
