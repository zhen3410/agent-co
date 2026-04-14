import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseChatComposerOptions {
  disabled?: boolean;
  onSubmit: (message: string) => Promise<void>;
}

export interface UseChatComposerResult {
  value: string;
  setValue: (value: string) => void;
  errorMessage: string | null;
  isSubmitting: boolean;
  canSubmit: boolean;
  textareaRef: { current: HTMLTextAreaElement | null };
  handleTextareaKeyDown: (event: { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; preventDefault?: () => void }) => void;
  submit: (event?: { preventDefault?: () => void }) => Promise<void>;
}

export function useChatComposer({ disabled = false, onSubmit }: UseChatComposerOptions): UseChatComposerResult {
  const [value, setValue] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSubmit = useMemo(() => {
    return !disabled && !isSubmitting && value.trim().length > 0;
  }, [disabled, isSubmitting, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 144), 320);
    textarea.style.height = `${nextHeight}px`;
  }, [value]);

  const submit = useCallback(async (event?: { preventDefault?: () => void }) => {
    event?.preventDefault?.();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    const nextMessage = value.trim();

    try {
      await onSubmit(nextMessage);
      setValue('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '发送失败');
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, onSubmit, value]);

  const handleTextareaKeyDown = useCallback((event: { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; preventDefault?: () => void }) => {
    const isSubmitShortcut = (event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.shiftKey;
    if (!isSubmitShortcut) {
      return;
    }

    event.preventDefault?.();
    void submit();
  }, [submit]);

  return {
    value,
    setValue,
    errorMessage,
    isSubmitting,
    canSubmit,
    textareaRef,
    handleTextareaKeyDown,
    submit
  };
}
