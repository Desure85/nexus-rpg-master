import React, { useState, useEffect, useRef } from 'react';

interface PromptOptions {
  message: string;
  defaultValue?: string;
  isConfirm?: boolean;
}

let promptResolver: ((value: string | null) => void) | null = null;
let promptOptions: PromptOptions | null = null;

export const customPrompt = (message: string, defaultValue: string = ''): Promise<string | null> => {
  return new Promise((resolve) => {
    promptResolver = resolve;
    promptOptions = { message, defaultValue, isConfirm: false };
    window.dispatchEvent(new Event('custom-prompt'));
  });
};

export const customConfirm = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    promptResolver = (val) => resolve(val === 'true');
    promptOptions = { message, isConfirm: true };
    window.dispatchEvent(new Event('custom-prompt'));
  });
};

export const PromptModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<PromptOptions | null>(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handlePrompt = () => {
      setOptions(promptOptions);
      setInputValue(promptOptions?.defaultValue || '');
      setIsOpen(true);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    };
    window.addEventListener('custom-prompt', handlePrompt);
    return () => window.removeEventListener('custom-prompt', handlePrompt);
  }, []);

  if (!isOpen || !options) return null;

  const handleClose = (value: string | null) => {
    setIsOpen(false);
    if (promptResolver) promptResolver(value);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-4">{options.message}</h3>
        {!options.isConfirm && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-white mb-6 focus:outline-none focus:border-emerald-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleClose(inputValue);
              if (e.key === 'Escape') handleClose(null);
            }}
          />
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => handleClose(null)}
            className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => handleClose(options.isConfirm ? 'true' : inputValue)}
            className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-all font-bold"
          >
            {options.isConfirm ? 'Confirm' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};
