'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/lib/types';

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

// A form wired to a server action. What the action returns is shown under the
// fields: an error stays until the next attempt, a success clears the form
// when `resetOnOk` is set (Add player, so the next one can be typed straight in).
export function ActionForm({ action, children, className, resetOnOk }: {
  action: Action; children: ReactNode; className?: string; resetOnOk?: boolean;
}) {
  const [state, run] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);
  return (
    <form ref={ref} action={run} className={className}>
      {children}
      {state.error && <p role="alert" className="note note-bad">{state.error}</p>}
      {state.ok && <p role="status" className="note note-good">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, className = 'btn btn-primary', busy }: {
  children: ReactNode; className?: string; busy?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && busy ? busy : children}
    </button>
  );
}

// A select that saves the moment it changes: a role is one choice, not a form
// to fill in and submit.
export function AutoSelect({ name, value, options, label }: {
  name: string; value: string; options: { value: string; label: string }[]; label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <select name={name} defaultValue={value} aria-label={label} disabled={pending} className="select select-chip"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
