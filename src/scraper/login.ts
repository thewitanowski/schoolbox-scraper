import { Page, BrowserContext } from 'playwright'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { config } from '../config.js'
import { LoginError } from './errors.js'

const STORAGE_STATE_PATH = join(config.dataDir, '.auth', 'storage-state.json')

export class LoginService {
  private schoolboxUrl: string
  private username: string
  private password: string

  constructor(opts?: { url?: string; username?: string; password?: string }) {
    this.schoolboxUrl = opts?.url ?? config.schoolbox.url
    this.username = opts?.username ?? config.schoolbox.username
    this.password = opts?.password ?? config.schoolbox.password
  }

  /**
   * Attempt to restore a previous session from saved cookies.
   * Returns true if session is still valid.
   */
  async tryRestoreSession(context: BrowserContext, page: Page): Promise<boolean> {
    try {
      if (!existsSync(STORAGE_STATE_PATH)) return false

      const state = JSON.parse(readFileSync(STORAGE_STATE_PATH, 'utf-8'))
      await context.addCookies(state.cookies || [])

      // Test if session is still valid by navigating to the portal
      await page.goto(this.schoolboxUrl, { waitUntil: 'networkidle', timeout: 15000 })
      const url = page.url()

      // If we're on the portal (not redirected to SSO), session is valid
      if (url.includes('mytyndale.tyndale.edu.au') && !url.includes('sso.tyndale')) {
        console.log('Session restored from saved cookies')
        return true
      }

      return false
    } catch {
      return false
    }
  }

  /**
   * Full login flow: SSO → Azure B2C → Schoolbox
   */
  async login(page: Page): Promise<void> {
    if (!this.username || !this.password) {
      throw new LoginError(
        'Missing Schoolbox credentials',
        'INVALID_CREDENTIALS'
      )
    }

    try {
      // Navigate to portal — triggers SSO redirect
      await page.goto(this.schoolboxUrl, { waitUntil: 'networkidle', timeout: 30000 })
    } catch {
      throw new LoginError(
        'Failed to load Schoolbox portal — network error or timeout',
        'TIMEOUT'
      )
    }

    // Click "Parent sign in"
    try {
      const parentSignIn = page.getByText('Parent sign in', { exact: true })
      await parentSignIn.waitFor({ state: 'visible', timeout: 10000 })
      await parentSignIn.click()
    } catch {
      throw new LoginError(
        'Could not find "Parent sign in" button — SSO page may have changed',
        'SSO_CHANGED'
      )
    }

    // Wait for Azure B2C login form
    try {
      await page.waitForSelector('#signInName', { state: 'visible', timeout: 15000 })
    } catch {
      throw new LoginError(
        'Azure B2C login form did not appear',
        'SSO_CHANGED'
      )
    }

    // Fill credentials
    await page.locator('#signInName').fill(this.username)
    await page.locator('#password').fill(this.password)

    // Click sign in (exact match to avoid social sign-in buttons)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Wait for redirect back to Schoolbox
    try {
      await page.waitForURL(/mytyndale/, { timeout: 30000 })
    } catch {
      // Check if credentials were wrong (Azure B2C shows error on same page)
      const pageText = await page.locator('body').textContent() || ''
      if (pageText.includes('Invalid username or password') || pageText.includes('incorrect')) {
        throw new LoginError('Invalid Schoolbox credentials', 'INVALID_CREDENTIALS')
      }
      throw new LoginError(
        'Login redirect timed out — credentials may be wrong or SSO changed',
        'TIMEOUT'
      )
    }

    console.log('Logged in to Schoolbox')
  }

  /**
   * Save current session cookies for reuse
   */
  async saveSession(context: BrowserContext): Promise<void> {
    try {
      const dir = dirname(STORAGE_STATE_PATH)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

      const state = await context.storageState()
      writeFileSync(STORAGE_STATE_PATH, JSON.stringify(state))
      console.log('Session saved')
    } catch (err) {
      console.warn('Failed to save session:', err)
    }
  }

  /**
   * Login with session restore attempt first
   */
  async loginWithSessionRestore(context: BrowserContext, page: Page): Promise<void> {
    const restored = await this.tryRestoreSession(context, page)
    if (restored) return

    await this.login(page)
    await this.saveSession(context)
  }
}
