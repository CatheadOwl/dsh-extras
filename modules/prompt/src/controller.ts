/**
 * Prompt Middleware Typert Remote surface backing the Settings → Plugins →
 * Prompt Middleware tab: the flat provider list with per-provider enabled
 * state, and the switch write path. Providers are global (all plugin-level
 * registrations), so unlike the gates tab there is no workspace scoping; the
 * `workspace` field is accepted for wire parity and ignored.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { PromptMiddlewareService } from './service.js'
import type { PromptMiddlewareProviderView } from './types.js'

/** List request; `workspace` is accepted for parity with the gates tab and unused. */
export interface PromptMiddlewareListRequest {
  workspace?: string
}

/** Switch write request: the browser-owned disabled-name list, mirrored for enforcement. */
export interface PromptMiddlewareSetDisabledRequest {
  /** Provider names disabled for pre-step injection. */
  ids: string[]
  workspace?: string
}

/** Host owner of the `promptMiddleware` Remote namespace. */
export class PromptMiddlewareController extends TypertRemoteService {
  private readonly service: PromptMiddlewareService

  /**
   * @param ctx - Host context carrying the gateway.
   * @param service - the plugin's `promptMiddleware` service (mounted before this controller).
   */
  constructor(ctx: Context, service: PromptMiddlewareService) {
    super(ctx, 'promptMiddlewareController', { namespace: 'promptMiddleware' })
    this.service = service
  }

  /** The flat provider list with current enabled state. `request` is accepted for wire parity and ignored. */
  @Remote
  list(request?: PromptMiddlewareListRequest): PromptMiddlewareProviderView[] {
    return this.service.listViews()
  }

  /**
   * Mirror the browser's persisted switch list into host memory (the
   * enforcement truth) and answer the refreshed list. Names of providers that
   * no longer exist are harmless — they simply match nothing.
   */
  @Remote
  setDisabled(request: PromptMiddlewareSetDisabledRequest): PromptMiddlewareProviderView[] {
    if (
      request === undefined || typeof request !== 'object' || Array.isArray(request)
      || !Array.isArray(request.ids) || request.ids.some(id => typeof id !== 'string')
      || (request.workspace !== undefined && typeof request.workspace !== 'string')
    ) {
      throw new RemoteError(
        'gateway/bad-request',
        'promptMiddleware.setDisabled requires an ids string list (workspace, when given, must be a string)',
        {},
      )
    }
    this.service.setDisabled(request.ids)
    return this.service.listViews()
  }
}
