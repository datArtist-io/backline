// Typed errors so callers can decide what to show the user and what to retry.

export class EngineError extends Error {
  constructor(
    message: string,
    /** Safe to show to end users. */
    public readonly userMessage: string = message
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** An external API (Qloo, LLM provider, web search) failed. */
export class UpstreamError extends EngineError {
  constructor(
    public readonly service: "qloo" | "llm" | "web" | "email" | "calls" | "maps" | "hotels" | "flights" | "documents",
    public readonly status: number | null,
    message: string,
    userMessage = "A data source didn't respond. Try again in a moment."
  ) {
    super(message, userMessage);
    this.name = "UpstreamError";
  }

  /** Worth retrying: network failure, timeout, rate limit, or server error. */
  get retryable(): boolean {
    return this.status === null || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** Input from the user was invalid. Never retried. */
export class InputError extends EngineError {
  constructor(message: string) {
    super(message, message);
    this.name = "InputError";
  }
}

/** The thing asked for doesn't exist in the data (e.g. an unknown artist). */
export class NotFoundError extends EngineError {
  constructor(message: string) {
    super(message, message);
    this.name = "NotFoundError";
  }
}

/** Model output couldn't be validated even after a repair attempt. */
export class OutputError extends EngineError {
  constructor(message: string) {
    super(message, "The agent produced an unusable answer for this step. Try again.");
    this.name = "OutputError";
  }
}

export class TimeoutError extends EngineError {
  constructor(message: string) {
    super(message, "This step took too long and was stopped.");
    this.name = "TimeoutError";
  }
}
