import { ErrorCodes, TransportableError } from "./error";

/**
 * Factory that auto-generates serialize()/deserialize() boilerplate
 * for TransportableError subclasses.
 *
 * Usage:
 *   class MyError extends defineError<{ url: string }>("MY_CODE", "default message") {
 *     constructor(url: string) { super(url); }
 *   }
 *
 * Fields declared in TFields are exposed as direct properties on the error
 * instance (e.g. `error.url`), and are automatically included in
 * serialize()/deserialize().
 */
export function defineError<TFields extends Record<string, unknown>>(
  code: ErrorCodes,
  defaultMessage: string,
) {
  return class extends TransportableError {
    constructor(...args: unknown[]) {
      // Last arg is optional message override; everything else is field values
      // in declaration order. Subclasses pass them positionally to super().
      const message =
        typeof args[args.length - 1] === "string"
          ? (args.pop() as string | undefined)
          : undefined;
      super(code, message ?? defaultMessage);
    }

    serialize() {
      // Merge known field values + base serialization
      const fields: Record<string, unknown> = {};
      // Subclasses expose fields as own properties; collect them
      for (const key of Object.keys(this)) {
        if (key === "code") continue;
        fields[key] = (this as Record<string, unknown>)[key];
      }
      return { ...super.serialize(), ...fields };
    }

    static deserialize(
      _code: ErrorCodes,
      data: Record<string, unknown>,
    ): InstanceType<typeof this> {
      const { stack, message, cause, ...fields } = data;
      const ctor = this as new (...args: unknown[]) => InstanceType<typeof this>;
      // Reconstruct: pass field values then optional message
      const fieldValues = Object.values(fields);
      const err = new ctor(...fieldValues, message as string);
      err.cause = cause;
      err.stack = stack as string;
      return err;
    }
  };
}
