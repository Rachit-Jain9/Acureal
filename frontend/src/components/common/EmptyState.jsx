import { Inbox } from 'lucide-react';

export default function EmptyState({ title = 'No data', description = '', icon: Icon = Inbox, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="text-content-muted mb-4" size={48} />
      <h3 className="text-lg font-medium text-content-primary mb-1">{title}</h3>
      {description && <p className="text-sm text-content-secondary mb-4 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
