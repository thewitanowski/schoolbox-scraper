import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('SCRAPER_API_KEY', 'test-key')
vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
vi.stubEnv('SCHOOLBOX_URL', 'https://mytyndale.tyndale.edu.au/')
vi.stubEnv('SCHOOLBOX_USERNAME', 'test@example.com')
vi.stubEnv('SCHOOLBOX_PASSWORD', 'test-password')
vi.stubEnv('DATA_DIR', '/tmp/test-scraper')

const { LoginService } = await import('../src/scraper/login.js')
const { LoginError } = await import('../src/scraper/errors.js')

function createMockPage(overrides: Record<string, unknown> = {}) {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://sso.tyndale.edu.au/login'),
    getByText: vi.fn().mockReturnValue({
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined)
    }),
    getByRole: vi.fn().mockReturnValue({
      click: vi.fn().mockResolvedValue(undefined)
    }),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({
      fill: vi.fn().mockResolvedValue(undefined),
      textContent: vi.fn().mockResolvedValue('')
    }),
    ...overrides
  }
  return mockPage
}

describe('LoginService', () => {
  let loginService: InstanceType<typeof LoginService>

  beforeEach(() => {
    loginService = new LoginService({
      url: 'https://mytyndale.tyndale.edu.au/',
      username: 'test@example.com',
      password: 'test-password'
    })
  })

  describe('login', () => {
    it('performs the full login flow in correct order', async () => {
      const mockPage = createMockPage()
      const callOrder: string[] = []

      mockPage.goto.mockImplementation(async () => { callOrder.push('goto') })
      mockPage.getByText.mockReturnValue({
        waitFor: vi.fn().mockImplementation(async () => { callOrder.push('waitForParentBtn') }),
        click: vi.fn().mockImplementation(async () => { callOrder.push('clickParentSignIn') })
      })
      mockPage.waitForSelector.mockImplementation(async () => { callOrder.push('waitForForm') })
      mockPage.locator.mockReturnValue({
        fill: vi.fn().mockImplementation(async () => { callOrder.push('fill') })
      })
      mockPage.getByRole.mockReturnValue({
        click: vi.fn().mockImplementation(async () => { callOrder.push('clickSignIn') })
      })
      mockPage.waitForURL.mockImplementation(async () => { callOrder.push('waitForRedirect') })

      await loginService.login(mockPage as never)

      expect(callOrder).toEqual([
        'goto',
        'waitForParentBtn',
        'clickParentSignIn',
        'waitForForm',
        'fill', // username
        'fill', // password
        'clickSignIn',
        'waitForRedirect'
      ])
    })

    it('fills username and password fields', async () => {
      const fillCalls: string[] = []
      const mockPage = createMockPage({
        locator: vi.fn().mockImplementation((selector: string) => ({
          fill: vi.fn().mockImplementation(async (value: string) => {
            fillCalls.push(`${selector}=${value}`)
          }),
          textContent: vi.fn().mockResolvedValue('')
        }))
      })

      await loginService.login(mockPage as never)

      expect(fillCalls).toContain('#signInName=test@example.com')
      expect(fillCalls).toContain('#password=test-password')
    })

    it('throws LoginError with INVALID_CREDENTIALS when credentials are empty', async () => {
      const service = new LoginService({
        url: 'https://mytyndale.tyndale.edu.au/',
        username: '',
        password: ''
      })

      await expect(service.login(createMockPage() as never)).rejects.toThrow(LoginError)
      await expect(service.login(createMockPage() as never)).rejects.toThrow('Missing Schoolbox credentials')
    })

    it('throws LoginError with TIMEOUT on navigation failure', async () => {
      const mockPage = createMockPage({
        goto: vi.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))
      })

      await expect(loginService.login(mockPage as never)).rejects.toThrow(LoginError)
      try {
        await loginService.login(mockPage as never)
      } catch (err) {
        expect((err as InstanceType<typeof LoginError>).code).toBe('TIMEOUT')
      }
    })

    it('throws LoginError with SSO_CHANGED when parent sign in button not found', async () => {
      const mockPage = createMockPage({
        getByText: vi.fn().mockReturnValue({
          waitFor: vi.fn().mockRejectedValue(new Error('Timeout')),
          click: vi.fn()
        })
      })

      await expect(loginService.login(mockPage as never)).rejects.toThrow(LoginError)
      try {
        await loginService.login(mockPage as never)
      } catch (err) {
        expect((err as InstanceType<typeof LoginError>).code).toBe('SSO_CHANGED')
      }
    })

    it('clicks exact "Sign in" button to avoid social buttons', async () => {
      const mockPage = createMockPage()

      await loginService.login(mockPage as never)

      expect(mockPage.getByRole).toHaveBeenCalledWith('button', {
        name: 'Sign in',
        exact: true
      })
    })
  })
})
