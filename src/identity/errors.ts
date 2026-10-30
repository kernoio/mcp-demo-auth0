export class RequestError extends Error {
  readonly status: number;
  readonly error: string;
  readonly kind: "oauth" | "management";

  constructor(status: number, error: string, message: string, kind: "oauth" | "management") {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.error = error;
    this.kind = kind;
  }
}
