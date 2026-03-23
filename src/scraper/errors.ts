export class ScraperError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'ScraperError'
  }
}

export class LoginError extends ScraperError {
  constructor(message: string, code: 'INVALID_CREDENTIALS' | 'TIMEOUT' | 'SSO_CHANGED' | 'UNKNOWN') {
    super(message, code)
    this.name = 'LoginError'
  }
}

export class ScrapeModuleError extends ScraperError {
  constructor(
    message: string,
    public readonly module: string
  ) {
    super(message, `MODULE_${module.toUpperCase()}_FAILED`)
    this.name = 'ScrapeModuleError'
  }
}
