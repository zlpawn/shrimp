/**
 * Dream Skin error class with structured code and details.
 */
export class DreamSkinError extends Error {
  constructor(code, message, { details = [], cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "DreamSkinError";
    this.code = code;
    this.details = details;
  }
}