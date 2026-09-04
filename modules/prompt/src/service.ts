import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import { PromptMiddlewareRunner } from './core.js'
import type {
  DeclarativeRelatesProvider,
  PromptMiddlewareConfig,
  PromptMiddlewareProvider,
  PromptMiddlewareProviderView,
  PromptMiddlewareRunOptions,
  PromptMiddlewareRunResult,
} from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptMiddleware: PromptMiddlewareService
  }
}

export interface Config extends PromptMiddlewareConfig {}

export const ConfigSchema: z<Config> = z.object({
  providerTimeoutMs: z.number().default(2_000),
  totalTimeoutMs: z.number().default(5_000),
  renderBudgetChars: z.number().default(4_000),
  disabledProviders: z.array(z.string()),
})

export class PromptMiddlewareService extends Service {
  static Config = ConfigSchema

  private readonly runner: PromptMiddlewareRunner

  /**
   * Provider names the user switched off, mirrored from the browser's
   * localStorage by the Settings → Plugins → Prompt Middleware tab. In-memory
   * by design: the browser owns persistence, the host only enforces the filter.
   */
  private disabled = new Set<string>()

  /**
   * Provider names disabled via plugin config (`disabledProviders`) — the
   * deployment-owned entry, reachable headless via profile patch. Kept a
   * separate set from `disabled`: `setDisabled()` replaces the browser mirror
   * wholesale and must not be able to clobber the deployer's list.
   */
  private readonly configDisabled = new Set<string>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'promptMiddleware')
    this.runner = new PromptMiddlewareRunner(config)
    for (const name of config.disabledProviders ?? []) this.configDisabled.add(name)
  }

  register(provider: PromptMiddlewareProvider): () => void {
    return this.runner.register(provider)
  }

  registerRelates(provider: DeclarativeRelatesProvider): () => void {
    return this.runner.registerRelates(provider)
  }

  list(): PromptMiddlewareProvider[] {
    return this.runner.list()
  }

  /** Provider names the user switched off (empty until the browser pushes its stored list). */
  disabledIds(): string[] {
    return [...this.disabled]
  }

  /** Replace the user-disabled name list — the browser-owned state, mirrored for enforcement. */
  setDisabled(names: readonly string[]): void {
    this.disabled = new Set(names)
  }

  /**
   * The settings tab's flat provider list with each provider's enabled state.
   * `enabled` reflects only the user switch (the browser mirror) — a provider
   * disabled via config stays `enabled: true` here while never running; that
   * display semantics is frozen in the contract's dual-entry section.
   */
  listViews(): PromptMiddlewareProviderView[] {
    return this.runner.listEntries().map(({ provider, kind }) => ({
      name: provider.name,
      ...kind !== undefined ? { kind } : {},
      ...provider.priority !== undefined ? { priority: provider.priority } : {},
      ...provider.timeoutMs !== undefined ? { timeoutMs: provider.timeoutMs } : {},
      mode: provider.mode ?? 'always',
      source: kind === undefined ? 'imperative' : 'declarative',
      enabled: !this.disabled.has(provider.name),
    }))
  }

  clearSession(sessionId: string): void {
    this.runner.clearSession(sessionId)
  }

  run(options: PromptMiddlewareRunOptions): Promise<PromptMiddlewareRunResult> {
    // Union each surface's set independently: whichever surface says "off"
    // wins (config = deployer's will, browser mirror = user's will), and the
    // config-owned names keep their own channel so the runner can attribute
    // the skip in trace (`disabled by config` vs `disabled by user`).
    return this.runner.run({
      ...options,
      disabled: new Set([...this.disabled, ...(options.disabled ?? [])]),
      configDisabled: new Set([...this.configDisabled, ...(options.configDisabled ?? [])]),
    })
  }
}
