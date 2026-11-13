/** An expected, user-facing failure. `code` is an i18n key (e.g. "errors.forbidden"). */
export class DomainError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
