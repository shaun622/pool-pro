/**
 * Template Engine for communication templates
 * Replaces placeholders like {client_name} with actual values
 */

// All available placeholders with descriptions
export const PLACEHOLDERS = [
  { key: '{client_name}', label: 'Client Name', example: 'John Smith' },
  { key: '{client_first_name}', label: 'Client First Name', example: 'John' },
  { key: '{client_email}', label: 'Client Email', example: 'john@example.com' },
  { key: '{client_phone}', label: 'Client Phone', example: '0412 345 678' },
  { key: '{pool_address}', label: 'Pool Address', example: '123 Main St, Sydney' },
  { key: '{pool_type}', label: 'Pool Type', example: 'Concrete' },
  { key: '{job_date}', label: 'Job Date', example: 'Wednesday 15 April 2026' },
  { key: '{job_time}', label: 'Job Time', example: '9:00 AM' },
  { key: '{job_type}', label: 'Job Type', example: 'Regular Maintenance' },
  { key: '{technician_name}', label: 'Technician Name', example: 'Mike Wilson' },
  { key: '{business_name}', label: 'Business Name', example: 'Crystal Clear Pools' },
  { key: '{business_phone}', label: 'Business Phone', example: '1300 123 456' },
  { key: '{business_email}', label: 'Business Email', example: 'info@poolco.com.au' },
  { key: '{portal_link}', label: 'Customer Portal Link', example: 'https://poolmateapp.online/portal/abc123' },
  { key: '{survey_link}', label: 'Survey Link', example: 'https://poolmateapp.online/survey/abc123' },
  { key: '{next_service_date}', label: 'Next Service Date', example: 'Wednesday 22 April 2026' },
  { key: '{invoice_number}', label: 'Invoice Number', example: 'INV-001' },
  { key: '{invoice_total}', label: 'Invoice Total', example: '$150.00' },
  { key: '{quote_total}', label: 'Quote Total', example: '$250.00' },
  { key: '{eta_minutes}', label: 'ETA (minutes)', example: '15' },
]

/**
 * Replace all placeholders in a template string with actual values
 * @param {string} template - Template string with {placeholder} syntax
 * @param {Record<string, string>} variables - Key-value pairs for replacement
 * @returns {string} Rendered string
 */
export function renderTemplate(template, variables = {}) {
  if (!template) return ''
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match
  })
}

/**
 * Build variables object from service/job context data
 */
export function buildTemplateVariables({ client, pool, job, staff, business, survey, invoice, quote } = {}) {
  const vars = {}

  if (client) {
    vars.client_name = client.name || ''
    vars.client_first_name = (client.name || '').split(' ')[0]
    vars.client_email = client.email || ''
    vars.client_phone = client.phone || ''
  }

  if (pool) {
    vars.pool_address = pool.address || ''
    vars.pool_type = pool.type || ''
    if (pool.portal_token) {
      vars.portal_link = `https://poolmateapp.online/portal/${pool.portal_token}`
    }
    if (pool.next_due_at) {
      vars.next_service_date = new Date(pool.next_due_at).toLocaleDateString('en-AU', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      })
    }
  }

  if (job) {
    vars.job_date = job.scheduled_date
      ? new Date(job.scheduled_date).toLocaleDateString('en-AU', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        })
      : ''
    vars.job_time = job.scheduled_time || ''
    vars.job_type = job.title || ''
  }

  if (staff) {
    vars.technician_name = staff.name || ''
  }

  if (business) {
    vars.business_name = business.name || ''
    vars.business_phone = business.phone || ''
    vars.business_email = business.email || ''
  }

  if (survey?.token) {
    vars.survey_link = `https://poolmateapp.online/survey/${survey.token}`
  }

  if (invoice) {
    vars.invoice_number = invoice.invoice_number || ''
    vars.invoice_total = invoice.total != null ? `$${Number(invoice.total).toFixed(2)}` : ''
  }

  if (quote) {
    vars.quote_total = quote.total != null ? `$${Number(quote.total).toFixed(2)}` : ''
  }

  return vars
}

/**
 * Get the default templates seeded for new businesses
 */
export const DEFAULT_TEMPLATES = [
  {
    name: 'Service Reminder',
    type: 'email',
    trigger_type: 'service_reminder',
    subject: 'Pool Service Tomorrow — {pool_address}',
    body: `Hi {client_name},

Just a friendly reminder that your pool service is scheduled for tomorrow at {pool_address}.

Your technician {technician_name} will be there to take care of everything.

If you need to reschedule, please contact us at {business_phone}.

Thanks,
{business_name}`,
  },
  {
    name: 'Service Reminder SMS',
    type: 'sms',
    trigger_type: 'service_reminder',
    subject: '',
    body: `Hi {client_first_name}, reminder: your pool service at {pool_address} is scheduled for tomorrow. {business_name}`,
  },
  {
    name: 'Running Late',
    type: 'sms',
    trigger_type: 'running_late',
    subject: '',
    body: `Hi {client_first_name}, our technician {technician_name} is running about {eta_minutes} mins behind schedule for your pool service today. Sorry for any inconvenience! - {business_name}`,
  },
  {
    name: 'Running Late Email',
    type: 'email',
    trigger_type: 'running_late',
    subject: 'Running Late — {pool_address}',
    body: `Hi {client_name},

Our technician {technician_name} is running approximately {eta_minutes} minutes behind schedule for your pool service today at {pool_address}.

We apologise for any inconvenience and will be there as soon as possible.

Thanks for your patience,
{business_name}`,
  },
  {
    name: 'Follow Up',
    type: 'email',
    trigger_type: 'follow_up',
    subject: 'How was your service? — {business_name}',
    body: `Hi {client_name},

We hope you're happy with the recent pool service at {pool_address}.

If you have any questions or concerns about the work done, please don't hesitate to reach out at {business_phone} or {business_email}.

You can view your full service history anytime through your customer portal:
{portal_link}

Thanks for choosing {business_name}!`,
  },
  {
    name: 'Survey Request',
    type: 'email',
    trigger_type: 'survey',
    subject: 'Quick feedback? — {business_name}',
    body: `Hi {client_name},

We'd love to hear how your recent pool service went at {pool_address}.

It only takes 30 seconds — just tap below to leave a quick rating:
{survey_link}

Your feedback helps us improve and deliver the best service possible.

Thanks,
{business_name}`,
  },
  {
    name: 'Survey Request SMS',
    type: 'sms',
    trigger_type: 'survey',
    subject: '',
    body: `Hi {client_first_name}, how was your pool service? We'd love your feedback (30 sec): {survey_link} — {business_name}`,
  },
]
