import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-content-muted mb-4">404</h1>
        <p className="text-xl text-content-secondary mb-6">Page not found</p>
        <Link to="/" className="btn-primary inline-flex items-center gap-2">
          <Home size={16} /> Go Home
        </Link>
      </div>
    </div>
  );
}
