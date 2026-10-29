import type { INodeProperties } from 'n8n-workflow'

const TICKET_TYPES = [
  { name: 'Incident', value: 'INCIDENT' },
  { name: 'Service Request', value: 'SERVICE_REQUEST' },
  { name: 'Change', value: 'CHANGE' },
  { name: 'Problem', value: 'PROBLEM' },
]

const TICKET_STATUS = [
  { name: 'New', value: 'NEW' },
  { name: 'In Progress', value: 'IN_PROGRESS' },
  { name: 'Waiting', value: 'WAITING' },
  { name: 'Resolved', value: 'RESOLVED' },
  { name: 'Closed', value: 'CLOSED' },
  { name: 'Canceled', value: 'CANCELED' },
]

const LEAD_STAGES = [
  { name: 'Received', value: 'RECEIVED' },
  { name: 'In Contact', value: 'IN_CONTACT' },
  { name: 'Qualified', value: 'QUALIFIED' },
  { name: 'Opportunity', value: 'OPPORTUNITY' },
  { name: 'Proposal', value: 'PROPOSAL' },
  { name: 'Closed', value: 'CLOSED' },
]

/** `returnAll` + `limit` for the list operations of one resource. */
function paging(resource: string, operation: string): INodeProperties[] {
  const show = { resource: [resource], operation: [operation] }
  return [
    {
      displayName: 'Return All',
      name: 'returnAll',
      type: 'boolean',
      default: false,
      description: 'Whether to return all results or only up to a given limit',
      displayOptions: { show },
    },
    {
      displayName: 'Limit',
      name: 'limit',
      type: 'number',
      default: 50,
      typeOptions: { minValue: 1 },
      description: 'Max number of results to return',
      displayOptions: { show: { ...show, returnAll: [false] } },
    },
  ]
}

export const resourceProperty: INodeProperties = {
  displayName: 'Resource',
  name: 'resource',
  type: 'options',
  noDataExpression: true,
  default: 'ticket',
  options: [
    { name: 'Custom API Call', value: 'apiCall' },
    { name: 'Lead (CRM)', value: 'lead' },
    { name: 'Opportunity (CRM)', value: 'opportunity' },
    { name: 'Ticket (ServiceDesk)', value: 'ticket' },
    { name: 'WhatsApp Conversation', value: 'conversation' },
    { name: 'WhatsApp Template', value: 'template' },
  ],
}

/* --------------------------------- ticket --------------------------------- */

const ticketOperations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  default: 'create',
  displayOptions: { show: { resource: ['ticket'] } },
  options: [
    {
      name: 'Add Comment',
      value: 'comment',
      action: 'Add a comment to a ticket',
      description: 'Add a public reply or an internal note',
    },
    {
      name: 'Change Phase',
      value: 'changePhase',
      action: 'Move a ticket to another phase',
      description: 'Follows the transitions configured for the ticket type',
    },
    {
      name: 'Create',
      value: 'create',
      action: 'Create a ticket',
    },
    {
      name: 'Get',
      value: 'get',
      action: 'Get a ticket',
    },
    {
      name: 'Get Many',
      value: 'getAll',
      action: 'Get many tickets',
    },
  ],
}

const ticketIdProperty: INodeProperties = {
  displayName: 'Ticket ID or Number',
  name: 'ticketId',
  type: 'string',
  required: true,
  default: '',
  placeholder: 'INC-000123 or 123',
  description: 'The ticket id, or its number',
  displayOptions: {
    show: {
      resource: ['ticket'],
      operation: ['get', 'comment', 'changePhase'],
    },
  },
}

const ticketProperties: INodeProperties[] = [
  ticketOperations,
  {
    displayName: 'Type',
    name: 'ticketType',
    type: 'options',
    required: true,
    default: 'INCIDENT',
    options: TICKET_TYPES,
    displayOptions: { show: { resource: ['ticket'], operation: ['create'] } },
  },
  {
    displayName: 'Title',
    name: 'title',
    type: 'string',
    required: true,
    default: '',
    description: 'Up to 200 characters',
    displayOptions: { show: { resource: ['ticket'], operation: ['create'] } },
  },
  {
    displayName: 'Description',
    name: 'description',
    type: 'string',
    typeOptions: { rows: 4 },
    default: '',
    displayOptions: { show: { resource: ['ticket'], operation: ['create'] } },
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: ['ticket'], operation: ['create'] } },
    options: [
      {
        displayName: 'Assignee ID',
        name: 'assigneeId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Category ID',
        name: 'categoryId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Company ID',
        name: 'companyId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Contact ID',
        name: 'contactId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Customer ID',
        name: 'customerId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Impact ID',
        name: 'impactId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Phase Name or ID',
        name: 'phaseId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getPhases' },
        default: '',
        description:
          'Starting phase. Leave empty for the initial phase of the type. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Priority ID',
        name: 'priorityId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Requester ID',
        name: 'requesterId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Service ID',
        name: 'serviceId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Tags',
        name: 'tags',
        type: 'string',
        default: '',
        description: 'Comma-separated list of tags',
      },
      {
        displayName: 'Template ID',
        name: 'templateId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Urgency ID',
        name: 'urgencyId',
        type: 'string',
        default: '',
      },
    ],
  },
  ticketIdProperty,
  {
    displayName: 'Comment',
    name: 'commentBody',
    type: 'string',
    typeOptions: { rows: 4 },
    required: true,
    default: '',
    description: 'Up to 10,000 characters',
    displayOptions: { show: { resource: ['ticket'], operation: ['comment'] } },
  },
  {
    displayName: 'Visibility',
    name: 'visibility',
    type: 'options',
    default: 'PUBLIC',
    description: 'Public replies are visible to the requester',
    options: [
      { name: 'Public Reply', value: 'PUBLIC' },
      { name: 'Internal Note', value: 'INTERNAL' },
    ],
    displayOptions: { show: { resource: ['ticket'], operation: ['comment'] } },
  },
  {
    displayName: 'Phase Name or ID',
    name: 'phaseId',
    type: 'options',
    typeOptions: { loadOptionsMethod: 'getPhases' },
    required: true,
    default: '',
    description:
      'Destination phase. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    displayOptions: {
      show: { resource: ['ticket'], operation: ['changePhase'] },
    },
  },
  {
    displayName: 'Options',
    name: 'phaseOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: {
      show: { resource: ['ticket'], operation: ['changePhase'] },
    },
    options: [
      {
        displayName: 'Comment',
        name: 'comment',
        type: 'string',
        default: '',
        description: 'Up to 2,000 characters',
      },
      {
        displayName: 'Solution',
        name: 'solution',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        description: 'Required by phases that resolve the ticket',
      },
      {
        displayName: 'Solution Classification ID',
        name: 'solutionClassificationId',
        type: 'string',
        default: '',
      },
    ],
  },
  ...paging('ticket', 'getAll'),
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: ['ticket'], operation: ['getAll'] } },
    options: [
      {
        displayName: 'Assignee',
        name: 'assigneeId',
        type: 'string',
        default: '',
        description:
          'Comma-separated user ids, <code>me</code> or <code>unassigned</code>',
      },
      {
        displayName: 'Phase IDs',
        name: 'phaseId',
        type: 'string',
        default: '',
        description: 'Comma-separated phase ids',
      },
      {
        displayName: 'Priority IDs',
        name: 'priorityId',
        type: 'string',
        default: '',
        description: 'Comma-separated priority ids',
      },
      {
        displayName: 'Search',
        name: 'q',
        type: 'string',
        default: '',
        description: 'Text in the title, the description or the code',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'multiOptions',
        default: [],
        options: TICKET_STATUS,
        description: 'Phase categories. Empty returns only the open ones.',
      },
      {
        displayName: 'Type',
        name: 'type',
        type: 'multiOptions',
        default: [],
        options: TICKET_TYPES,
      },
    ],
  },
]

/* ---------------------------------- lead ---------------------------------- */

const leadProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    default: 'create',
    displayOptions: { show: { resource: ['lead'] } },
    options: [
      { name: 'Create', value: 'create', action: 'Create a lead' },
      { name: 'Get Many', value: 'getAll', action: 'Get many leads' },
    ],
  },
  {
    displayName: 'Name',
    name: 'name',
    type: 'string',
    required: true,
    default: '',
    displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
  },
  {
    displayName: 'Source',
    name: 'source',
    type: 'string',
    required: true,
    default: 'n8n',
    description: 'Where the lead came from, for the reports',
    displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
    options: [
      { displayName: 'Channel', name: 'channel', type: 'string', default: '' },
      { displayName: 'City', name: 'city', type: 'string', default: '' },
      { displayName: 'Company', name: 'company', type: 'string', default: '' },
      {
        displayName: 'Emails',
        name: 'emails',
        type: 'string',
        default: '',
        description: 'Comma-separated list of e-mail addresses',
      },
      {
        displayName: 'Job Title',
        name: 'jobTitle',
        type: 'string',
        default: '',
      },
      {
        displayName: 'LinkedIn',
        name: 'linkedin',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Phones',
        name: 'phones',
        type: 'string',
        default: '',
        description: 'Comma-separated list of phone numbers (E.164)',
      },
    ],
  },
  ...paging('lead', 'getAll'),
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: ['lead'], operation: ['getAll'] } },
    options: [
      {
        displayName: 'Stage',
        name: 'stage',
        type: 'options',
        default: 'RECEIVED',
        options: LEAD_STAGES,
      },
    ],
  },
]

/* ------------------------------- opportunity ------------------------------ */

const opportunityProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    default: 'getAll',
    displayOptions: { show: { resource: ['opportunity'] } },
    options: [
      { name: 'Get Many', value: 'getAll', action: 'Get many opportunities' },
      {
        name: 'Move to Stage',
        value: 'moveStage',
        action: 'Move an opportunity to a stage',
      },
    ],
  },
  ...paging('opportunity', 'getAll'),
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: {
      show: { resource: ['opportunity'], operation: ['getAll'] },
    },
    options: [
      {
        displayName: 'Pipeline Name or ID',
        name: 'pipelineId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getPipelines' },
        default: '',
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Stage ID',
        name: 'stageId',
        type: 'string',
        default: '',
      },
    ],
  },
  {
    displayName: 'Opportunity ID',
    name: 'opportunityId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: { resource: ['opportunity'], operation: ['moveStage'] },
    },
  },
  {
    displayName: 'Pipeline Name or ID',
    name: 'pipelineId',
    type: 'options',
    typeOptions: { loadOptionsMethod: 'getPipelines' },
    default: '',
    description:
      'Pipeline of the destination stage. Leave empty to stay in the current one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    displayOptions: {
      show: { resource: ['opportunity'], operation: ['moveStage'] },
    },
  },
  {
    displayName: 'Stage Name or ID',
    name: 'stageId',
    type: 'options',
    typeOptions: {
      loadOptionsMethod: 'getStages',
      loadOptionsDependsOn: ['pipelineId'],
    },
    required: true,
    default: '',
    description:
      'Destination stage. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    displayOptions: {
      show: { resource: ['opportunity'], operation: ['moveStage'] },
    },
  },
]

/* --------------------------------- whatsapp -------------------------------- */

const templateProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    default: 'send',
    displayOptions: { show: { resource: ['template'] } },
    options: [
      { name: 'Get Many', value: 'getAll', action: 'Get many templates' },
      { name: 'Send', value: 'send', action: 'Send a template message' },
    ],
  },
  ...paging('template', 'getAll'),
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: ['template'], operation: ['getAll'] } },
    options: [
      {
        displayName: 'Connection ID',
        name: 'connectionId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        default: 'APPROVED',
        options: [
          { name: 'Approved', value: 'APPROVED' },
          { name: 'Pending', value: 'PENDING' },
          { name: 'Rejected', value: 'REJECTED' },
          { name: 'Paused', value: 'PAUSED' },
          { name: 'Disabled', value: 'DISABLED' },
        ],
      },
    ],
  },
  {
    displayName: 'Recipient',
    name: 'recipientType',
    type: 'options',
    default: 'to',
    description: 'How the conversation is found',
    options: [
      {
        name: 'Phone Number',
        value: 'to',
        description: 'Finds or creates the contact and the conversation',
      },
      { name: 'Conversation ID', value: 'conversationId' },
      { name: 'Contact ID', value: 'contactId' },
    ],
    displayOptions: { show: { resource: ['template'], operation: ['send'] } },
  },
  {
    displayName: 'Phone Number',
    name: 'to',
    type: 'string',
    required: true,
    default: '',
    placeholder: '+5511999990000',
    description: 'E.164 format',
    displayOptions: {
      show: {
        resource: ['template'],
        operation: ['send'],
        recipientType: ['to'],
      },
    },
  },
  {
    displayName: 'Conversation ID',
    name: 'conversationId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['template'],
        operation: ['send'],
        recipientType: ['conversationId'],
      },
    },
  },
  {
    displayName: 'Contact ID',
    name: 'contactId',
    type: 'string',
    required: true,
    default: '',
    description: 'Needs a Connection ID too',
    displayOptions: {
      show: {
        resource: ['template'],
        operation: ['send'],
        recipientType: ['contactId'],
      },
    },
  },
  {
    displayName: 'Template Name',
    name: 'templateName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'lembrete_consulta',
    displayOptions: { show: { resource: ['template'], operation: ['send'] } },
  },
  {
    displayName: 'Language',
    name: 'language',
    type: 'string',
    required: true,
    default: 'pt_BR',
    displayOptions: { show: { resource: ['template'], operation: ['send'] } },
  },
  {
    displayName: 'Additional Fields',
    name: 'sendOptions',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: ['template'], operation: ['send'] } },
    options: [
      {
        displayName: 'Components (JSON)',
        name: 'components',
        type: 'json',
        default: '[]',
        description:
          'Cloud API components with the body and header variables, as an array',
      },
      {
        displayName: 'Connection ID',
        name: 'connectionId',
        type: 'string',
        default: '',
        description:
          'Sending connection. Optional when the workspace has only one.',
      },
    ],
  },
]

const conversationProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    default: 'getWaiting',
    displayOptions: { show: { resource: ['conversation'] } },
    options: [
      {
        name: 'Get Waiting',
        value: 'getWaiting',
        action: 'Get conversations waiting in the queue',
        description: 'Open conversations with no assignee, oldest first',
      },
    ],
  },
  ...paging('conversation', 'getWaiting'),
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: {
      show: { resource: ['conversation'], operation: ['getWaiting'] },
    },
    options: [
      {
        displayName: 'Connection ID',
        name: 'connectionId',
        type: 'string',
        default: '',
      },
      { displayName: 'Team ID', name: 'teamId', type: 'string', default: '' },
    ],
  },
]

/* -------------------------------- custom call ------------------------------ */

const apiCallProperties: INodeProperties[] = [
  {
    displayName: 'Method',
    name: 'method',
    type: 'options',
    default: 'GET',
    options: [
      { name: 'DELETE', value: 'DELETE' },
      { name: 'GET', value: 'GET' },
      { name: 'PATCH', value: 'PATCH' },
      { name: 'POST', value: 'POST' },
      { name: 'PUT', value: 'PUT' },
    ],
    displayOptions: { show: { resource: ['apiCall'] } },
  },
  {
    displayName: 'Path',
    name: 'path',
    type: 'string',
    required: true,
    default: '/api/v1/me',
    placeholder: '/api/v1/crm/pipelines',
    description: 'Any route of the Steel API v1, starting with /api/v1/',
    displayOptions: { show: { resource: ['apiCall'] } },
  },
  {
    displayName: 'Query (JSON)',
    name: 'query',
    type: 'json',
    default: '{}',
    description: 'Query string parameters as an object',
    displayOptions: { show: { resource: ['apiCall'] } },
  },
  {
    displayName: 'Body (JSON)',
    name: 'body',
    type: 'json',
    default: '{}',
    displayOptions: {
      show: { resource: ['apiCall'], method: ['POST', 'PUT', 'PATCH'] },
    },
  },
]

export const operationProperties: INodeProperties[] = [
  resourceProperty,
  ...ticketProperties,
  ...leadProperties,
  ...opportunityProperties,
  ...templateProperties,
  ...conversationProperties,
  ...apiCallProperties,
]
