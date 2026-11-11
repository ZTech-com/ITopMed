/** Shape returned by every server action that backs a form. Messages are i18n keys. */
export interface FormState {
  ok?: boolean;
  message?: string;
  messageValues?: Record<string, string | number>;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  /** Changes on every submission so success banners re-render. */
  nonce?: number;
  /** Structured result for specialised UI (e.g. duplicate candidates). Never secrets. */
  data?: Record<string, unknown>;
}

export const initialFormState: FormState = {};
