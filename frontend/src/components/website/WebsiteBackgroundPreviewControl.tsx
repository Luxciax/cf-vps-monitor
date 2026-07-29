import { useRef } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';

export default function WebsiteBackgroundPreviewControl({
  customized,
  onSelect,
  onReset,
}: {
  customized: boolean;
  onSelect: (file: File) => void;
  onReset: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="website-background-preview-control">
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.target.value = '';
        }}
      />
      <button type="button" onClick={() => inputRef.current?.click()}>
        <ImagePlus size={14} aria-hidden="true" />
        更换背景
      </button>
      {customized && (
        <button type="button" className="is-reset" onClick={onReset} title="恢复默认预览背景">
          <RotateCcw size={14} aria-hidden="true" />
          <span className="website-background-reset-label">恢复默认</span>
        </button>
      )}
    </div>
  );
}
