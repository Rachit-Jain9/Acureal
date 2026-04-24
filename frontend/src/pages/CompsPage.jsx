import { useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Building2,
} from 'lucide-react';
import { useComps, useCreateComp, useDeleteComp } from '../hooks/useComps';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import { formatINR } from '../utils/format';

const PROJECT_TYPES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mixed_use', label: 'Mixed Use' },
];

const EMPTY_COMP = {
  projectName: '',
  developer: '',
  city: '',
  locality: '',
  projectType: 'residential',
  bhkConfig: '',
  carpetAreaSqft: '',
  superBuiltupAreaSqft: '',
  ratePerSqft: '',
  totalUnits: '',
  launchYear: '',
  possessionYear: '',
  reraNumber: '',
  source: '',
};

function AddCompModal({ isOpen, onClose, onSubmit, isLoading }) {
  const [form, setForm] = useState(EMPTY_COMP);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    onSubmit({
      ...form,
      carpetAreaSqft: form.carpetAreaSqft ? Number(form.carpetAreaSqft) : undefined,
      superBuiltupAreaSqft: form.superBuiltupAreaSqft ? Number(form.superBuiltupAreaSqft) : undefined,
      ratePerSqft: form.ratePerSqft ? Number(form.ratePerSqft) : undefined,
      totalUnits: form.totalUnits ? Number(form.totalUnits) : undefined,
      launchYear: form.launchYear ? Number(form.launchYear) : undefined,
      possessionYear: form.possessionYear ? Number(form.possessionYear) : undefined,
      developer: form.developer || undefined,
      locality: form.locality || undefined,
      bhkConfig: form.bhkConfig || undefined,
      reraNumber: form.reraNumber || undefined,
      source: form.source || undefined,
    });
    setForm(EMPTY_COMP);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-content-primary">Add Comparable</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-secondary text-content-muted hover:text-content-secondary transition"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Project Name *</label>
              <input
                name="projectName"
                required
                value={form.projectName}
                onChange={handleChange}
                placeholder="e.g. Lodha Palava"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Developer</label>
              <input
                name="developer"
                value={form.developer}
                onChange={handleChange}
                placeholder="e.g. Lodha Group"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">City *</label>
              <input
                name="city"
                required
                value={form.city}
                onChange={handleChange}
                placeholder="e.g. Mumbai"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Locality</label>
              <input
                name="locality"
                value={form.locality}
                onChange={handleChange}
                placeholder="e.g. Dombivli"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Type</label>
              <select
                name="projectType"
                value={form.projectType}
                onChange={handleChange}
                className="input"
              >
                {PROJECT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">BHK Config</label>
              <input
                name="bhkConfig"
                value={form.bhkConfig}
                onChange={handleChange}
                placeholder="e.g. 2BHK, 3BHK"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Carpet Area (sqft)</label>
              <input
                name="carpetAreaSqft"
                type="number"
                value={form.carpetAreaSqft}
                onChange={handleChange}
                placeholder="e.g. 650"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Super Built-Up (sqft)</label>
              <input
                name="superBuiltupAreaSqft"
                type="number"
                value={form.superBuiltupAreaSqft}
                onChange={handleChange}
                placeholder="e.g. 900"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Rate per sqft *</label>
              <input
                name="ratePerSqft"
                type="number"
                required
                value={form.ratePerSqft}
                onChange={handleChange}
                placeholder="e.g. 8500"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Total Units</label>
              <input
                name="totalUnits"
                type="number"
                value={form.totalUnits}
                onChange={handleChange}
                placeholder="e.g. 500"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Launch Year</label>
              <input
                name="launchYear"
                type="number"
                value={form.launchYear}
                onChange={handleChange}
                placeholder="e.g. 2024"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Possession Year</label>
              <input
                name="possessionYear"
                type="number"
                value={form.possessionYear}
                onChange={handleChange}
                placeholder="e.g. 2027"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">RERA Number</label>
              <input
                name="reraNumber"
                value={form.reraNumber}
                onChange={handleChange}
                placeholder="e.g. P52100012345"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Source</label>
              <input
                name="source"
                value={form.source}
                onChange={handleChange}
                placeholder="e.g. Broker, Broker report"
                className="input"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={isLoading} className="btn btn-primary">
              {isLoading ? 'Adding...' : 'Add Comparable'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CompsPage() {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    city: '',
    projectType: '',
    minRate: '',
    maxRate: '',
  });
  const [page, setPage] = useState(1);

  const pageSize = 15;

  const queryParams = useMemo(() => {
    const params = { page, limit: pageSize };
    if (search) params.search = search;
    if (filters.city) params.city = filters.city;
    if (filters.projectType) params.projectType = filters.projectType;
    if (filters.minRate) params.minRate = Number(filters.minRate);
    if (filters.maxRate) params.maxRate = Number(filters.maxRate);
    return params;
  }, [filters.city, filters.maxRate, filters.minRate, filters.projectType, page, search]);

  const { data, isLoading } = useComps(queryParams);
  const createMutation = useCreateComp();
  const deleteMutation = useDeleteComp();

  const comps = data?.data || [];
  const totalPages = data?.pagination?.totalPages || 1;
  const totalCount = data?.pagination?.total || comps.length;

  const handleCreate = (compData) => {
    createMutation.mutate(compData, {
      onSuccess: () => setShowModal(false),
    });
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this comparable? This cannot be undone.')) {
      return;
    }
    deleteMutation.mutate(id);
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({
      city: '',
      projectType: '',
      minRate: '',
      maxRate: '',
    });
    setSearch('');
    setPage(1);
  };

  const hasActiveFilters =
    search || filters.city || filters.projectType || filters.minRate || filters.maxRate;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comparables"
        description={`${totalCount} comparable${totalCount !== 1 ? 's' : ''} in the database`}
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="btn btn-primary"
          >
            <Plus size={16} />
            Add Comp
          </button>
        }
      />

      <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-content-secondary mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search projects, developers..."
                className="input pl-9"
              />
            </div>
          </div>

          <div className="w-40">
            <label className="block text-xs font-medium text-content-secondary mb-1">City</label>
            <input
              name="city"
              value={filters.city}
              onChange={handleFilterChange}
              placeholder="Any city"
              className="input"
            />
          </div>

          <div className="w-40">
            <label className="block text-xs font-medium text-content-secondary mb-1">Project Type</label>
            <select
              name="projectType"
              value={filters.projectType}
              onChange={handleFilterChange}
              className="input"
            >
              <option value="">All types</option>
              {PROJECT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-32">
            <label className="block text-xs font-medium text-content-secondary mb-1">Min Rate</label>
            <input
              name="minRate"
              type="number"
              value={filters.minRate}
              onChange={handleFilterChange}
              placeholder="Min"
              className="input"
            />
          </div>

          <div className="w-32">
            <label className="block text-xs font-medium text-content-secondary mb-1">Max Rate</label>
            <input
              name="maxRate"
              type="number"
              value={filters.maxRate}
              onChange={handleFilterChange}
              placeholder="Max"
              className="input"
            />
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-content-secondary hover:text-content-secondary hover:bg-bg-secondary rounded-lg transition"
            >
              <X size={14} />
              Clear
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : comps.length === 0 ? (
        <EmptyState
          title="No comparables found"
          description={
            hasActiveFilters
              ? 'Try adjusting your filters or search terms.'
              : 'Add your first comparable to get started.'
          }
          icon={Building2}
          action={
            !hasActiveFilters && (
              <button onClick={() => setShowModal(true)} className="btn btn-primary">
                <Plus size={16} />
                Add Comparable
              </button>
            )
          }
        />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-hairline-strong overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-secondary border-b border-hairline-strong">
                  <th className="px-4 py-3 text-left font-medium text-content-secondary">Project</th>
                  <th className="px-4 py-3 text-left font-medium text-content-secondary">Developer</th>
                  <th className="px-4 py-3 text-left font-medium text-content-secondary">City</th>
                  <th className="px-4 py-3 text-left font-medium text-content-secondary">Locality</th>
                  <th className="px-4 py-3 text-left font-medium text-content-secondary">Type</th>
                  <th className="px-4 py-3 text-right font-medium text-content-secondary">Rate/sqft</th>
                  <th className="px-4 py-3 text-right font-medium text-content-secondary">Units</th>
                  <th className="px-4 py-3 text-center font-medium text-content-secondary">Launch</th>
                  <th className="px-4 py-3 text-left font-medium text-content-secondary">RERA</th>
                  <th className="px-4 py-3 text-center font-medium text-content-secondary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {comps.map((comp) => (
                  <tr key={comp.id} className="hover:bg-bg-secondary transition">
                    <td className="px-4 py-3 font-medium text-content-primary whitespace-nowrap">
                      {comp.project_name}
                    </td>
                    <td className="px-4 py-3 text-content-secondary whitespace-nowrap">{comp.developer || '-'}</td>
                    <td className="px-4 py-3 text-content-secondary">{comp.city}</td>
                    <td className="px-4 py-3 text-content-secondary">{comp.locality || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">
                        {comp.project_type?.replace(/_/g, ' ') || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-content-primary">
                      {comp.rate_per_sqft ? formatINR(comp.rate_per_sqft, 0) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-content-secondary">
                      {comp.total_units?.toLocaleString('en-IN') || '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-content-secondary">{comp.launch_year || '-'}</td>
                    <td className="px-4 py-3 text-content-secondary text-xs">{comp.rera_number || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(comp.id)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 rounded-lg text-content-muted hover:text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                        title="Delete comparable"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-hairline-strong bg-bg-secondary">
              <p className="text-sm text-content-secondary">
                Page {page} of {totalPages} ({totalCount} total)
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-hairline-strong text-content-secondary hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg border border-hairline-strong text-content-secondary hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <AddCompModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSubmit={handleCreate}
        isLoading={createMutation.isPending}
      />
    </div>
  );
}
