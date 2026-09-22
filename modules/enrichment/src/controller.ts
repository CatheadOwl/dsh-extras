/**
 * Enrichment Typert Remote surface backing the Settings → Plugins →
 * Enrichment tab: the flat provider list with per-provider enabled
 * state, and the switch write path. Providers are global (all plugin-level
 * registrations), so unlike the gates tab there is no workspace scoping; the
 * `workspace` field is accepted for wire parity and ignored.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { EnrichmentService } from './service.js'
import type { EnrichmentIntrospection, EnrichmentProviderView } from './types.js'

/** List request; `workspace` is accepted for parity with the gates tab and unused. */
export interface EnrichmentListRequest {
  workspace?: string
}

/** Switch write request: the browser-owned disabled-name list, mirrored for enforcement. */
export interface EnrichmentSetDisabledRequest {
  /** Provider names disabled for pre-step injection. */
  ids: string[]
  workspace?: string
}

/** Host owner of the `enrichment` Remote namespace. */
export class EnrichmentController extends TypertRemoteService {
  private readonly service: EnrichmentService

  /**
   * @param ctx - Host context carrying the gateway.
   * @param service - the plugin's `enrichment` service (mounted before this controller).
   */
  constructor(ctx: Context, service: EnrichmentService) {
    super(ctx, 'enrichmentController', { namespace: 'enrichment' })
    this.service = service
  }

  /** The flat provider list with current enabled state. `request` is accepted for wire parity and ignored. */
  @Remote
  list(request?: EnrichmentListRequest): EnrichmentProviderView[] {
    return this.service.listViews()
  }

  /**
   * Read-only introspection snapshot: descriptors, signal sources, and the
   * effective disable state across both entries (browser mirror + config).
   * `request` is accepted for wire parity and ignored.
   */
  @Remote
  introspect(request?: EnrichmentListRequest): EnrichmentIntrospection[] {
    return this.service.introspect()
  }

  /**
   * Mirror the browser's persisted switch list into host memory (the
   * enforcement truth) and answer the refreshed list. Names of providers that
   * no longer exist are harmless — they simply match nothing.
   */
  @Remote
  setDisabled(request: EnrichmentSetDisabledRequest): EnrichmentProviderView[] {
    if (
      request === undefined || typeof request !== 'object' || Array.isArray(request)
      || !Array.isArray(request.ids) || request.ids.some(id => typeof id !== 'string')
      || (request.workspace !== undefined && typeof request.workspace !== 'string')
    ) {
      throw new RemoteError(
        'gateway/bad-request',
        'enrichment.setDisabled requires an ids string list (workspace, when given, must be a string)',
        {},
      )
    }
    this.service.setDisabled(request.ids)
    return this.service.listViews()
  }
}
