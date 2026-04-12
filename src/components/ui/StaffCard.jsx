import { cn } from '../../lib/utils'

const ROLE_LABELS = {
  tech: 'Technician',
  technician: 'Technician',
  admin: 'Admin',
  senior_tech: 'Senior Technician',
  manager: 'Manager',
  owner: 'Owner',
}

function Initials({ name, className }) {
  const initials = name
    ?.split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'
  return (
    <div className={cn(
      'flex items-center justify-center bg-pool-100 text-pool-600 font-bold rounded-full',
      className
    )}>
      {initials}
    </div>
  )
}

export default function StaffCard({ staff, variant = 'default', brandColor }) {
  const roleLabel = ROLE_LABELS[staff.role] || staff.role

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-3">
        {staff.photo_url ? (
          <img
            src={staff.photo_url}
            alt={staff.name}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <Initials name={staff.name} className="w-10 h-10 text-sm" />
        )}
        <div>
          <p className="text-sm font-medium text-gray-900">{staff.name}</p>
          <p className="text-xs text-gray-500">{roleLabel}</p>
        </div>
      </div>
    )
  }

  // Full card variant — used in portal and emails
  const accentColor = brandColor || '#0EA5E9'

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="h-2" style={{ backgroundColor: accentColor }} />
      <div className="p-4 flex items-center gap-4">
        {staff.photo_url ? (
          <img
            src={staff.photo_url}
            alt={staff.name}
            className="w-16 h-16 rounded-full object-cover ring-2 ring-white shadow"
          />
        ) : (
          <Initials name={staff.name} className="w-16 h-16 text-xl ring-2 ring-white shadow" />
        )}
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-gray-900">{staff.name}</h4>
          <p className="text-sm text-gray-500">{roleLabel}</p>
          {staff.phone && (
            <a href={`tel:${staff.phone}`} className="text-sm text-pool-600 hover:underline block mt-1">
              {staff.phone}
            </a>
          )}
          {staff.email && (
            <a href={`mailto:${staff.email}`} className="text-sm text-pool-600 hover:underline block">
              {staff.email}
            </a>
          )}
        </div>
      </div>
      {staff.bio && (
        <div className="px-4 pb-4">
          <p className="text-sm text-gray-600 leading-relaxed">{staff.bio}</p>
        </div>
      )}
    </div>
  )
}

export { ROLE_LABELS }
