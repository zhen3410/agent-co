import { useCallback, useMemo, useState } from 'react';

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
  submit: (event?: { preventDefault?: () => void }) => Promise<void>;
}

export function useChatComposer({ disabled = false, onSubmit }: UseChatComposerOptions): UseChatComposerResult {
  const [value, setValue] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    return !disabled && !isSubmitting && value.trim().length > 0;
  }, [disabled, isSubmitting, value]);

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

  return {
    value,
    setValue,
    errorMessage,
    isSubmitting,
    canSubmit,
    submit
  };
}
