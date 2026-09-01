/**
 * Gates Typert Remote surface backing the Settings → Plugins → Gates tab: the
 * flat gate list with per-trigger enabled state, and the switch write path.
 * Reads ride the service's workspace-scoped definitions; writes mirror the
 * browser-owned per-trigger disabled lists into host memory (the browser owns
 * persistence, the host only enforces).
 */
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { GatesService } from './service.js'
import type { GateLevel, GateTrigger } from './types.js'

/** One row of the settings tab's flat gate list. */
export interface GatesGateView {
  id: string
  description: string
  level: GateLevel
  on: GateTrigger[]
  /** Registration form: plugin-registered or repo-declared (the workspace's gates.yml). */
  source: 'plugin' | 'project'
  /** User-enabled state per trigger: turn-stop (fixed) and manual (agent-chosen). */
  stopEnabled: boolean
  manualEnabled: boolean
}

/** List request; the browser passes the current workspace so project gates resolve correctly. */
export interface GatesListRequest {
  workspace?: string
}

/** Switch write request: the browser-owned per-trigger disabled-id lists, mirrored for enforcement. */
export interface GatesSetDisabledRequest {
  /** Gate ids disabled for the turn-stop trigger. */
  stop: string[]
  /** Gate ids disabled for the manual trigger. */
  manual: string[]
  workspace?: string
}

/** Host owner of the `gates` Remote namespace. */
export class GatesController extends TypertRemoteService {
  private readonly service: GatesService

  /**
   * @param ctx - Host context carrying the gateway.
   * @param service - the plugin's `gates` service (mounted before this controller).
   */
  constructor(ctx: Context, service: GatesService) {
    super(ctx, 'gatesController', { namespace: 'gates' })
    this.service = service
  }

  /** The workspace-scoped flat gate list with current per-trigger enabled state. */
  @Remote
  list(request?: GatesListRequest): GatesGateView[] {
    const root = resolve(request?.workspace ?? '.')
    const disabled = this.service.disabledTriggers()
    const stopDisabled = new Set(disabled.stop)
    const manualDisabled = new Set(disabled.manual)
    const pluginIds = new Set(this.service.list().map(definition => definition.id))
    return this.service.definitions(root).map((definition) => ({
      id: definition.id,
      description: definition.description,
      level: definition.level,
      on: [...definition.on],
      source: pluginIds.has(definition.id) ? 'plugin' : 'project',
      stopEnabled: !stopDisabled.has(definition.id),
      manualEnabled: !manualDisabled.has(definition.id),
    }))
  }

  /**
   * Mirror the browser's persisted per-trigger switch lists into host memory
   * (the enforcement truth) and answer the refreshed list. Ids of gates that
   * no longer exist anywhere are harmless — they simply match nothing.
   */
  @Remote
  setDisabled(request: GatesSetDisabledRequest): GatesGateView[] {
    if (
      request === undefined || typeof request !== 'object' || Array.isArray(request)
      || !Array.isArray(request.stop) || request.stop.some(id => typeof id !== 'string')
      || !Array.isArray(request.manual) || request.manual.some(id => typeof id !== 'string')
      || (request.workspace !== undefined && typeof request.workspace !== 'string')
    ) {
      throw new RemoteError(
        'gateway/bad-request',
        'gates.setDisabled requires stop and manual gate id string lists (workspace, when given, must be a string)',
        {},
      )
    }
    this.service.setDisabledTriggers({ stop: request.stop, manual: request.manual })
    return this.list(request)
  }
}
