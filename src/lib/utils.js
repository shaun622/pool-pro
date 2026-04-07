import { format, parseISO, differenceInDays, addDays, addWeeks } from 'date-fns'

export function formatDate(date) {
  if (!date) return ''
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd/MM/yyyy')
}

export function formatDateTime(date) {
  if (!date) return ''
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd/MM/yyyy HH:mm')
}

export function daysOverdue(nextDueAt) {
  if (!nextDueAt) return 0
  const due = typeof nextDueAt === 'string' ? parseISO(nextDueAt) : nextDueAt
  return Math.max(0, differenceInDays(new Date(), due))
}

export function getOverdueStatus(nextDueAt) {
  const days = daysOverdue(nextDueAt)
  if (days >= 3) return 'red'
  if (days >= 1) return 'amber'
  return 'green'
}

export function calculateNextDue(lastServicedAt, frequency) {
  const last = typeof lastServicedAt === 'string' ? parseISO(lastServicedAt) : lastServicedAt
  switch (frequency) {
    case 'weekly': return addWeeks(last, 1)
    case 'fortnightly': return addWeeks(last, 2)
    case 'monthly': return addDays(last, 30)
    default: return addWeeks(last, 1)
  }
}

export function getChemicalStatus(value, range) {
  if (value == null || !range) return 'neutral'
  const [min, max] = range
  if (value < min * 0.9 || value > max * 1.1) return 'red'
  if (value < min || value > max) return 'amber'
  return 'green'
}

export function statusColor(status) {
  switch (status) {
    case 'green': return 'text-green-600 bg-green-50 border-green-200'
    case 'amber': return 'text-amber-600 bg-amber-50 border-amber-200'
    case 'red': return 'text-red-600 bg-red-50 border-red-200'
    default: return 'text-gray-600 bg-gray-50 border-gray-200'
  }
}

export function statusDot(status) {
  switch (status) {
    case 'green': return 'bg-green-500'
    case 'amber': return 'bg-amber-500'
    case 'red': return 'bg-red-500'
    default: return 'bg-gray-300'
  }
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(amount || 0)
}

export function calculateGST(subtotal) {
  return Math.round(subtotal * 0.1 * 100) / 100
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

export const POOL_TYPES = ['chlorine', 'salt', 'mineral', 'freshwater']
export const POOL_SHAPES = ['freeform', 'rectangular', 'lap']
export const SCHEDULE_FREQUENCIES = ['weekly', 'fortnightly', 'monthly']
export const PHOTO_TAGS = ['before', 'during', 'after', 'equipment', 'issue']
export const CHEMICAL_UNITS = ['L', 'kg', 'g', 'tabs']

export const DEFAULT_TARGET_RANGES = {
  ph: [7.2, 7.6],
  free_cl: [1, 3],
  total_cl: [1, 5],
  alk: [80, 120],
  stabiliser: [30, 50],
  calcium: [200, 400],
  salt: [3000, 6000],
}

export const DEFAULT_TASKS = [
  'Vacuumed floor',
  'Vacuumed walls',
  'Brushed tiles',
  'Emptied skimmer basket',
  'Emptied pump basket',
  'Backwashed filter',
  'Checked equipment operation',
  'Checked water level',
  'Cleaned waterline',
]

export const CHEMICAL_LABELS = {
  ph: { label: 'pH', unit: '' },
  free_chlorine: { label: 'Free Chlorine', unit: 'ppm' },
  total_chlorine: { label: 'Total Chlorine', unit: 'ppm' },
  alkalinity: { label: 'Total Alkalinity', unit: 'ppm' },
  stabiliser: { label: 'Stabiliser / CYA', unit: 'ppm' },
  calcium_hardness: { label: 'Calcium Hardness', unit: 'ppm' },
  salt: { label: 'Salt', unit: 'ppm' },
  water_temp: { label: 'Water Temp', unit: '°C' },
}
