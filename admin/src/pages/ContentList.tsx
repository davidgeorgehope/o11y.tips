import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, Content, Niche } from '../api/client';

export default function ContentList() {
  const [searchParams] = useSearchParams();
  const [content, setContent] = useState<Content[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    nicheId: searchParams.get('nicheId') || '',
    status: searchParams.get('status') || '',
    search: '',
  });

  useEffect(() => {
    loadNiches();
  }, []);

  useEffect(() => {
    loadContent();
  }, [filters]);

  const loadNiches = async () => {
    try {
      const data = await api.getNiches();
      setNiches(data);
    } catch (err) {
      console.error('Failed to load niches', err);
    }
  };

  const loadContent = async () => {
    setLoading(true);
    try {
      const data = await api.getContent({
        nicheId: filters.nicheId || undefined,
        status: filters.status || undefined,
        search: filters.search || undefined,
        limit: 50,
      });
      setContent(data.content);
    } catch (err) {
      setError('Failed to load content');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await api.approveContent(id);
      loadContent();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      const result = await api.publishContent(id);
      if (result.url) {
        alert(`Published at: ${result.url}`);
      }
      loadContent();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    }
  };

  const handleUnpublish = async (id: string) => {
    if (!confirm('Unpublish this content?')) return;
    try {
      await api.unpublishContent(id);
      loadContent();
    } catch (err) {
      setError('Failed to unpublish');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this content? This cannot be undone.')) return;
    try {
      await api.deleteContent(id);
      loadContent();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700';
      case 'review': return 'bg-yellow-100 text-yellow-700';
      case 'approved': return 'bg-blue-100 text-blue-700';
      case 'published': return 'bg-green-100 text-green-700';
      case 'archived': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getNicheName = (nicheId: string) => {
    return niches.find(n => n.id === nicheId)?.name || 'Unknown';
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Content</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Niche</label>
            <select
              value={filters.nicheId}
              onChange={(e) => setFilters({ ...filters, nicheId: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">All Niches</option>
              {niches.map(niche => (
                <option key={niche.id} value={niche.id}>{niche.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="review">Review</option>
              <option value="approved">Approved</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="Search titles..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Content Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Niche
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Quality
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {content.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/content/${item.id}`} className="text-blue-600 hover:underline font-medium">
                      {item.title}
                    </Link>
                    {item.description && (
                      <p className="text-sm text-gray-500 truncate max-w-md">{item.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {getNicheName(item.nicheId)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(item.status)}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">
                      {item.seoScore !== undefined && item.seoScore !== null && (
                        <span className={`mr-2 ${item.seoScore >= 70 ? 'text-green-600' : 'text-yellow-600'}`}>
                          SEO: {item.seoScore.toFixed(0)}
                        </span>
                      )}
                      {item.slopScore !== undefined && item.slopScore !== null && (
                        <span className={item.slopScore <= 5 ? 'text-green-600' : 'text-yellow-600'}>
                          Slop: {item.slopScore.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link
                        to={`/content/${item.id}`}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Review
                      </Link>
                      {item.status === 'review' && (
                        <button
                          onClick={() => handleApprove(item.id)}
                          className="text-sm text-green-600 hover:underline"
                        >
                          Approve
                        </button>
                      )}
                      {item.status === 'approved' && (
                        <button
                          onClick={() => handlePublish(item.id)}
                          className="text-sm text-green-600 hover:underline"
                        >
                          Publish
                        </button>
                      )}
                      {item.status === 'published' && (
                        <>
                          {item.publishedUrl && (
                            <a
                              href={item.publishedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:underline"
                            >
                              View
                            </a>
                          )}
                          <button
                            onClick={() => handleUnpublish(item.id)}
                            className="text-sm text-red-600 hover:underline"
                          >
                            Unpublish
                          </button>
                        </>
                      )}
                      {item.status !== 'published' && (
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {content.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No content found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
