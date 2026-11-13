import type { AnySteelAiTool } from './types'
import {
  zapBroadcastCreateDraftTool,
  zapBroadcastGetTool,
  zapBroadcastsListTool,
} from './whatsapp/broadcasts'
import {
  zapConnectionsStatusTool,
  zapGroupsListTool,
  zapTemplatesListTool,
} from './whatsapp/catalog'
import {
  zapContactCreateTool,
  zapContactDeleteTool,
  zapContactGetTool,
  zapContactsSearchTool,
  zapContactUpdateTool,
} from './whatsapp/contacts'
import {
  zapConversationAssignTool,
  zapConversationCloseTool,
  zapConversationGetTool,
  zapConversationReopenTool,
  zapConversationSetAiTool,
  zapConversationSummaryContextTool,
  zapConversationsListTool,
  zapConversationUnassignTool,
} from './whatsapp/conversations'
import { zapDashboardTool } from './whatsapp/dashboard'
import { zapMessageSendTextTool, zapTemplateSendTool } from './whatsapp/messages'
import {
  zapQuickRepliesListTool,
  zapQuickReplyCreateTool,
  zapQuickReplyDeleteTool,
  zapQuickReplyUpdateTool,
} from './whatsapp/quick-replies'

/**
 * Steel AI tools for Comunicação (WhatsApp). Every tool calls the domain
 * services with the caller's id, so module access and RBAC still apply.
 * Customer-facing sends are ACTIONs and refuse opted-out contacts and
 * closed 24 h windows; broadcasts are only ever created as drafts.
 */
export const WHATSAPP_AI_TOOLS: AnySteelAiTool[] = [
  // Reads
  zapConversationsListTool,
  zapConversationGetTool,
  zapConversationSummaryContextTool,
  zapContactsSearchTool,
  zapContactGetTool,
  zapGroupsListTool,
  zapTemplatesListTool,
  zapQuickRepliesListTool,
  zapBroadcastsListTool,
  zapBroadcastGetTool,
  zapConnectionsStatusTool,
  zapDashboardTool,
  // Writes (always confirmed by a human)
  zapConversationAssignTool,
  zapConversationUnassignTool,
  zapConversationCloseTool,
  zapConversationReopenTool,
  zapConversationSetAiTool,
  zapContactCreateTool,
  zapContactUpdateTool,
  zapContactDeleteTool,
  zapQuickReplyCreateTool,
  zapQuickReplyUpdateTool,
  zapQuickReplyDeleteTool,
  zapBroadcastCreateDraftTool,
  zapMessageSendTextTool,
  zapTemplateSendTool,
]
